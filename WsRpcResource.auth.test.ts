import { beforeEach, describe, expect, it } from "bun:test";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import { RpcService } from "@tokenring-ai/rpc";
import type { BunWebSocket } from "./types.ts";
import { hashPassword } from "./util/authSecurity.ts";
import WsRpcResource from "./WsRpcResource.ts";

/**
 * The socket accepts two ways in: a username and password, or nothing at all
 * when the handshake already resolved a session cookie. The second path is
 * what keeps a page reload from prompting for a password.
 */

const authConfig = { users: { mark: { password: "s3cret" } } };

type Sent = Record<string, any>;

/** Minimal socket double whose `data` is the shared per-connection context. */
function makeSocket(sessionUsername: string | null): { ws: BunWebSocket; sent: Sent[] } {
  const sent: Sent[] = [];
  const ws: BunWebSocket = {
    data: { path: "/rpc:ws", abortController: new AbortController(), sessionUsername },
    send: (payload: string | object) => {
      sent.push(typeof payload === "string" ? JSON.parse(payload) : (payload as Sent));
    },
    close: () => undefined,
  };
  return { ws, sent };
}

describe("WsRpcResource authentication", () => {
  let app: TokenRingApp;

  beforeEach(() => {
    app = createTestingApp();
    app.addService(RpcService, new RpcService());
  });

  function handler() {
    return new WsRpcResource(app, "/rpc:ws", authConfig).handler();
  }

  async function auth(ws: BunWebSocket, params: Record<string, string> | undefined) {
    const message = { jsonrpc: "2.0", id: 1, method: "auth", ...(params ? { params } : {}) };
    await handlerFor(ws).message?.(ws, JSON.stringify(message));
  }

  // The same handler instance must be used for open + message on one socket.
  const handlers = new WeakMap<BunWebSocket, ReturnType<typeof handler>>();
  function handlerFor(ws: BunWebSocket) {
    let existing = handlers.get(ws);
    if (!existing) {
      existing = handler();
      handlers.set(ws, existing);
    }
    return existing;
  }

  function open(sessionUsername: string | null) {
    const socket = makeSocket(sessionUsername);
    handlerFor(socket.ws).open?.(socket.ws);
    return socket;
  }

  it("signs in with a correct username and password", async () => {
    const { ws, sent } = open(null);
    await auth(ws, { username: "mark", password: "s3cret" });

    expect(sent[0]?.result).toEqual({ authenticated: true, username: "mark", role: "admin" });
    expect((ws.data as { authenticated: boolean }).authenticated).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const { ws, sent } = open(null);
    await auth(ws, { username: "mark", password: "nope" });

    expect(sent[0]?.error?.code).toBe(-32001);
    expect((ws.data as { authenticated: boolean }).authenticated).toBe(false);
  });

  it("treats a socket whose handshake carried a session as already signed in", () => {
    const { ws } = open("mark");

    expect((ws.data as { authenticated: boolean; username: string | null }).authenticated).toBe(true);
    expect((ws.data as { username: string | null }).username).toBe("mark");
  });

  it("accepts a credential-free auth call on a session-authenticated socket, and reports who", async () => {
    const { ws, sent } = open("mark");
    await auth(ws, undefined);

    expect(sent[0]?.result).toEqual({ authenticated: true, username: "mark", role: "admin" });
  });

  it("refuses a credential-free auth call without a session, so the client shows the login prompt", async () => {
    const { ws, sent } = open(null);
    await auth(ws, undefined);

    expect(sent[0]?.error?.code).toBe(-32001);
    expect(sent[0]?.error?.message).toContain("Sign in");
  });

  it("rejects ordinary calls until the socket is authenticated", async () => {
    const { ws, sent } = open(null);
    await handlerFor(ws).message?.(ws, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "somethingElse", params: {} }));

    expect(sent[0]?.error?.code).toBe(-32001);
  });

  it("lets a session-authenticated socket straight through to method dispatch", async () => {
    const { ws, sent } = open("mark");
    await handlerFor(ws).message?.(ws, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "noSuchMethod", params: {} }));

    // Past the auth gate: the failure is now "no such method", not "unauthorized".
    expect(sent[0]?.error?.code).toBe(-32601);
  });
});

describe("WsRpcResource password checks", () => {
  function signIn(auth: ConstructorParameters<typeof WsRpcResource>[2], username: string, password: string) {
    const app = createTestingApp();
    app.addService(RpcService, new RpcService());
    const handler = new WsRpcResource(app, "/rpc:ws", auth).handler();
    const { ws, sent } = makeSocket(null);
    handler.open?.(ws);
    return Promise.resolve(handler.message?.(ws, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "auth", params: { username, password } }))).then(
      () => sent[0]!,
    );
  }

  it("accepts a sha256: digest in config, as the HTTP sign-in does", async () => {
    const reply = await signIn({ users: { digest: { password: hashPassword("hunter22") } } }, "digest", "hunter22");
    expect(reply.result).toEqual({ authenticated: true, username: "digest", role: "admin" });
  });

  it("reads the users at sign-in time, so a changed or removed account applies without a restart", async () => {
    const config = { users: { rotating: { password: "old-password" } } as Record<string, { password: string }> };
    const live = () => config;
    expect((await signIn(live, "rotating", "old-password")).result).toEqual({ authenticated: true, username: "rotating", role: "admin" });

    config.users = { rotating: { password: "new-password" } };
    expect((await signIn(live, "rotating", "old-password")).error?.message).toBe("Invalid username or password");
    expect((await signIn(live, "rotating", "new-password")).result).toEqual({ authenticated: true, username: "rotating", role: "admin" });

    config.users = {};
    expect((await signIn(live, "rotating", "new-password")).error?.message).toBe("Invalid username or password");
  });

  it("answers a wrong password with a well-formed JSON-RPC error", async () => {
    const reply = await signIn({ users: { formed: { password: "right" } } }, "formed", "wrong");
    expect(reply.jsonrpc).toBe("2.0");
  });
});

describe("WsRpcResource on an already-open socket", () => {
  function setup(auth: ConstructorParameters<typeof WsRpcResource>[2], sessionValid?: () => boolean) {
    const app = createTestingApp();
    app.addService(RpcService, new RpcService());
    const handler = new WsRpcResource(app, "/rpc:ws", auth).handler();
    const { ws, sent } = makeSocket(sessionValid ? "mark" : null);
    if (sessionValid) Object.assign(ws.data as object, { sessionValid });
    handler.open?.(ws);
    const call = (method: string, params: object = {}) =>
      Promise.resolve(handler.message?.(ws, JSON.stringify({ jsonrpc: "2.0", id: sent.length + 1, method, params }))).then(() => sent.at(-1)!);
    return { call };
  }

  it("ends a password sign-in once the user is removed or their password changes", async () => {
    const config = { users: { mark: { password: "s3cret" } } as Record<string, { password: string }> };
    const { call } = setup(() => config);
    expect((await call("auth", { username: "mark", password: "s3cret" })).result).toEqual({ authenticated: true, username: "mark", role: "admin" });
    expect((await call("noSuchMethod")).error?.code).toBe(-32601);

    config.users.mark = { password: "changed" };
    const reply = await call("noSuchMethod");
    expect(reply.error?.code).toBe(-32001);
    expect(reply.error?.message).toContain("session has ended");
    // And it stays signed out.
    expect((await call("noSuchMethod")).error?.code).toBe(-32001);
  });

  it("ends a cookie session's socket once the session is revoked (sign-out elsewhere, user removed)", async () => {
    let valid = true;
    const { call } = setup(authConfig, () => valid);
    expect((await call("noSuchMethod")).error?.code).toBe(-32601);

    valid = false;
    expect((await call("noSuchMethod")).error?.message).toContain("session has ended");
    expect((await call("auth")).error?.code).toBe(-32001);
  });
});
