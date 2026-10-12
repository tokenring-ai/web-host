import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import createWsRPCClient, { getRpcConnectionState, resetWsRPCConnections, setWsRPCAuthHandler } from "./createWsRPCClient.ts";

/** Minimal in-process WebSocket double: opens on the next tick and answers JSON-RPC. */
class FakeSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  /** Usernames the fake server accepts without a password (a live session cookie). */
  static sessionUser: string | null = "mark";

  readyState = FakeSocket.CONNECTING;
  onmessage: ((event: { data: string }) => void) | null = null;
  authRequests = 0;

  constructor(readonly url: URL) {
    super();
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(raw: string) {
    const message = JSON.parse(raw) as { id: number; method: string; params: { username?: string; password?: string } };
    const reply = (body: object) => queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: message.id, ...body }) }));
    if (message.method === "auth") {
      this.authRequests += 1;
      const user = message.params.password ? message.params.username : FakeSocket.sessionUser;
      if (user) reply({ result: { authenticated: true, username: user } });
      else reply({ error: { code: -32001, message: "Authentication required" } });
      return;
    }
    reply({ result: { ok: true } });
  }

  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    queueMicrotask(() => this.dispatchEvent(new Event("close")));
  }
}

const realWebSocket = globalThis.WebSocket;
const schema = { name: "Test", path: "/rpc/test", methods: { ping: { type: "query", input: {}, result: {} } } } as never;

describe("resetWsRPCConnections", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    FakeSocket.sessionUser = "mark";
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    resetWsRPCConnections();
    setWsRPCAuthHandler(null);
    globalThis.WebSocket = realWebSocket;
  });

  it("closes the authenticated socket so the next call must authenticate again", async () => {
    const client = createWsRPCClient(new URL("ws://localhost/rpc-reset-1"), schema, { username: "", password: "" }) as unknown as {
      ping: (params: object) => Promise<unknown>;
    };
    await client.ping({});
    expect(FakeSocket.instances).toHaveLength(1);
    const first = FakeSocket.instances[0]!;

    // Sign out: the server session is gone, so a fresh socket is refused.
    FakeSocket.sessionUser = null;
    resetWsRPCConnections();
    expect(first.readyState).toBe(FakeSocket.CLOSED);
    expect(getRpcConnectionState()).toBe("disconnected");

    let authRequired = 0;
    setWsRPCAuthHandler({
      onAuthRequired: () => {
        authRequired += 1;
        return Promise.reject(new Error("signed out"));
      },
    });
    await expect(client.ping({})).rejects.toThrow("signed out");
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1]!.authRequests).toBe(1);
    expect(authRequired).toBe(1);
  });

  it("does not let the old socket's late close evict the replacement", async () => {
    const client = createWsRPCClient(new URL("ws://localhost/rpc-reset-2"), schema, { username: "", password: "" }) as unknown as {
      ping: (params: object) => Promise<unknown>;
    };
    await client.ping({});
    resetWsRPCConnections();
    // Re-open before the old socket's close event is delivered.
    const pending = client.ping({});
    await pending;
    await client.ping({});
    // Still one replacement socket, and the state reflects it rather than the stale close.
    expect(FakeSocket.instances).toHaveLength(2);
    expect(getRpcConnectionState()).toBe("connected");
  });
});
