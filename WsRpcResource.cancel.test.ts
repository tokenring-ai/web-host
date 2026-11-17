import { describe, expect, it } from "bun:test";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import { RpcService } from "@tokenring-ai/rpc";
import { z } from "zod";
import type { BunWebSocket } from "./types.ts";
import WsRpcResource from "./WsRpcResource.ts";

type Sent = Record<string, any>;

/**
 * A stream method that yields once, then waits until its signal aborts. The signals it was
 * given are recorded so tests can see which streams were stopped.
 */
function setup() {
  const app = createTestingApp();
  const rpc = new RpcService();
  app.addService(RpcService, rpc);
  const signals: AbortSignal[] = [];
  rpc.registerEndpoint({
    name: "Test",
    path: "/rpc/test",
    methods: {
      watch: {
        type: "stream",
        inputSchema: z.object({}),
        resultSchema: z.object({ tick: z.number() }),
        async *execute(_args: object, _app: unknown, signal: AbortSignal) {
          signals.push(signal);
          yield { tick: 1 };
          await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
        },
      },
    },
  });
  const handler = new WsRpcResource(app, "/rpc:ws", { users: {} }).handler();
  const sent: Sent[] = [];
  const ws: BunWebSocket = {
    data: { path: "/rpc:ws", abortController: new AbortController(), sessionUsername: "mark" },
    send: (payload: string | object) => {
      sent.push(typeof payload === "string" ? JSON.parse(payload) : (payload as Sent));
    },
    close: () => undefined,
  };
  handler.open?.(ws);
  const message = (body: object) => handler.message?.(ws, JSON.stringify({ jsonrpc: "2.0", ...body }));
  return { handler, ws, sent, signals, message };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe("WsRpcResource stream cancellation", () => {
  it("stops one stream on rpc.cancel, leaving the others running, and sends nothing after", async () => {
    const { sent, signals, message } = setup();
    const first = message({ id: 1, method: "/rpc/test.watch", params: {} });
    const second = message({ id: 2, method: "/rpc/test.watch", params: {} });
    await tick();
    expect(signals).toHaveLength(2);

    await message({ method: "rpc.cancel", params: { id: 1 } });
    await first;
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    // The cancelled stream gets no "end": its reader has gone.
    expect(sent.filter(reply => reply.id === 1).map(reply => reply.result)).toEqual([{ tick: 1 }]);
    // rpc.cancel is a notification, so it gets no reply either.
    expect(sent.some(reply => reply.id === null || reply.id === undefined)).toBe(false);

    void second;
  });

  it("stops every stream when the socket closes", async () => {
    const { handler, ws, signals, message } = setup();
    const running = [message({ id: 1, method: "/rpc/test.watch", params: {} }), message({ id: 2, method: "/rpc/test.watch", params: {} })];
    await tick();
    handler.close?.(ws);
    await Promise.all(running);
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it("ignores a cancel for a stream that is not running", async () => {
    const { sent, message } = setup();
    await message({ method: "rpc.cancel", params: { id: 99 } });
    expect(sent).toEqual([]);
  });
});
