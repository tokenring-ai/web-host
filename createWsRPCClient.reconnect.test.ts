import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import createWsRPCClient, { isRpcConnectionClosed, resetWsRPCConnections } from "./createWsRPCClient.ts";

type Message = { id?: number; method: string; params?: Record<string, unknown> };

/**
 * In-process WebSocket double. Auth always succeeds (a session cookie); `watch` streams one tick
 * and stays open, `finite` streams one tick and ends. Queries and mutations wait for `answer`,
 * so a test can drop the socket under them.
 */
class FakeSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  onmessage: ((event: { data: string }) => void) | null = null;
  received: Message[] = [];
  held: Message[] = [];

  constructor(readonly url: URL) {
    super();
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  private reply(id: number | undefined, body: object) {
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id, ...body }) }));
  }

  send(raw: string) {
    const message = JSON.parse(raw) as Message;
    this.received.push(message);
    if (message.method === "auth") return this.reply(message.id, { result: { authenticated: true, username: "mark" } });
    if (message.method === "/rpc/test.watch") return this.reply(message.id, { result: { tick: 1 } });
    if (message.method === "/rpc/test.finite") {
      this.reply(message.id, { result: { tick: 1 } });
      return this.reply(message.id, { result: null, stream: "end" });
    }
    if (message.method.startsWith("/rpc/test.")) this.held.push(message);
  }

  answer() {
    for (const message of this.held.splice(0)) this.reply(message.id, { result: { ok: true } });
  }

  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    queueMicrotask(() => this.dispatchEvent(new Event("close")));
  }
}

const realWebSocket = globalThis.WebSocket;
const schema = {
  name: "Test",
  path: "/rpc/test",
  methods: {
    watch: { type: "stream", input: {}, result: {} },
    finite: { type: "stream", input: {}, result: {} },
    read: { type: "query", input: {}, result: {} },
    write: { type: "mutation", input: {}, result: {} },
  },
} as never;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const cancels = (socket: FakeSocket) => socket.received.filter(message => message.method === "rpc.cancel").map(message => message.params);

describe("createWsRPCClient reconnect and cancel", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    resetWsRPCConnections();
    globalThis.WebSocket = realWebSocket;
  });

  function client() {
    return createWsRPCClient(new URL("ws://localhost/rpc"), schema, { username: "mark", password: "" }) as unknown as {
      watch: (params: object, signal: AbortSignal) => AsyncGenerator<unknown>;
      finite: (params: object, signal: AbortSignal) => AsyncGenerator<unknown>;
      read: (params: object) => Promise<unknown>;
      write: (params: object) => Promise<unknown>;
    };
  }

  it("tells the server to stop a stream the client abandons", async () => {
    const controller = new AbortController();
    const stream = client().watch({}, controller.signal);
    expect((await stream.next()).value).toEqual({ tick: 1 });
    const id = FakeSocket.instances[0]!.received.find(message => message.method === "/rpc/test.watch")!.id;

    controller.abort();
    await stream.next();
    expect(cancels(FakeSocket.instances[0]!)).toEqual([{ id }]);
  });

  it("sends no cancel for a stream the server already ended", async () => {
    const values: unknown[] = [];
    for await (const value of client().finite({}, new AbortController().signal)) values.push(value);
    expect(values).toEqual([{ tick: 1 }]);
    expect(cancels(FakeSocket.instances[0]!)).toEqual([]);
  });

  it("fails a stream with a recognisable error when the socket drops", async () => {
    const stream = client().watch({}, new AbortController().signal);
    await stream.next();
    FakeSocket.instances[0]!.close();
    const failure = await stream.next().catch((error: unknown) => error);
    expect(isRpcConnectionClosed(failure)).toBe(true);
  });

  it("retries a query on a fresh socket when the socket drops under it", async () => {
    const rpc = client();
    const pending = rpc.read({});
    await flush();
    FakeSocket.instances[0]!.close();
    await flush();
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1]!.answer();
    expect(await pending).toEqual({ ok: true });
  });

  it("does not repeat a mutation the socket dropped under, since it may have been applied", async () => {
    const pending = client().write({});
    await flush();
    FakeSocket.instances[0]!.close();
    const failure = await pending.catch((error: unknown) => error);
    expect(isRpcConnectionClosed(failure)).toBe(true);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
