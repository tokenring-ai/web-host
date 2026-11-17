import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import { SESSION_COOKIE } from "./sessionStore.ts";
import WebHostService from "./WebHostService.ts";

/**
 * Covers the session cookie that lets a reloaded page re-authenticate its RPC
 * socket without the user retyping a password.
 */

type ServeArgs = {
  routes: Record<string, (request: Request) => Promise<Response> | Response>;
  fetch: (request: Request, server: unknown) => Promise<Response | undefined>;
};

const AUTH_ROUTE = "/api/auth/session";
const WS_ROUTE = "/rpc:ws";

const mockServer = { hostname: "127.0.0.1", port: 3000, stop: mock(), reload: mock() };

function configWith(users: Record<string, { password: string }>) {
  return { host: "127.0.0.1", port: 3000, auth: { users }, resources: {} };
}

function basic(username: string, password: string): Record<string, string> {
  return { Authorization: `Basic ${btoa(`${username}:${password}`)}` };
}

/** Reads the session id out of a Set-Cookie header. */
function sessionIdFrom(response: Response): string {
  const cookie = response.headers.get("Set-Cookie") ?? "";
  const match = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(cookie);
  return match?.[1] ?? "";
}

describe("auth session endpoint", () => {
  let app: TokenRingApp;
  let serve: ServeArgs;

  async function startWith(users: Record<string, { password: string }>) {
    const service = new WebHostService(app, configWith(users));
    // The RPC socket route has to exist for the upgrade path to be exercised.
    service.registerResource("ws", { wsRoutes: { [WS_ROUTE]: { open: () => undefined } } });
    await service.listen();
    return service;
  }

  beforeEach(() => {
    mock.clearAllMocks();
    spyOn(Bun, "serve").mockImplementation(((args: ServeArgs) => {
      serve = args;
      return mockServer;
    }) as unknown as typeof Bun.serve);
    app = createTestingApp();
    spyOn(app, "serviceOutput");
  });

  afterEach(() => mock.restore());

  it("issues an HttpOnly session cookie for valid credentials", async () => {
    await startWith({ mark: { password: "s3cret" } });

    const response = await serve.routes[AUTH_ROUTE]!(new Request(`http://localhost${AUTH_ROUTE}`, { method: "POST", headers: basic("mark", "s3cret") }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, username: "mark", role: "admin" });
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(sessionIdFrom(response)).not.toHaveLength(0);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects a wrong password and an unknown user without setting a cookie", async () => {
    await startWith({ mark: { password: "s3cret" } });

    for (const header of [basic("mark", "wrong"), basic("ghost", "s3cret"), {}]) {
      const response = await serve.routes[AUTH_ROUTE]!(new Request(`http://localhost${AUTH_ROUTE}`, { method: "POST", headers: header }));
      expect(response.status).toBe(401);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("refuses to hand out sessions when no users are configured", async () => {
    await startWith({});

    const response = await serve.routes[AUTH_ROUTE]!(new Request(`http://localhost${AUTH_ROUTE}`, { method: "POST", headers: basic("mark", "s3cret") }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects methods other than POST and DELETE", async () => {
    await startWith({ mark: { password: "s3cret" } });

    const response = await serve.routes[AUTH_ROUTE]!(new Request(`http://localhost${AUTH_ROUTE}`, { method: "GET" }));

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST, DELETE");
  });

  it("revokes the session on DELETE and clears the cookie", async () => {
    await startWith({ mark: { password: "s3cret" } });
    const created = await serve.routes[AUTH_ROUTE]!(new Request(`http://localhost${AUTH_ROUTE}`, { method: "POST", headers: basic("mark", "s3cret") }));
    const sessionId = sessionIdFrom(created);

    const deleted = await serve.routes[AUTH_ROUTE]!(
      new Request(`http://localhost${AUTH_ROUTE}`, { method: "DELETE", headers: { Cookie: `${SESSION_COOKIE}=${sessionId}` } }),
    );

    expect(deleted.status).toBe(204);
    expect(deleted.headers.get("Set-Cookie")).toContain("Max-Age=0");

    // The revoked id no longer authenticates a socket.
    expect(await upgradeWith(`${SESSION_COOKIE}=${sessionId}`)).toBeNull();
  });

  /** Runs the WebSocket upgrade and reports the username the handshake resolved. */
  async function upgradeWith(cookie: string | null): Promise<string | null> {
    let seen: { sessionUsername?: string | null } | undefined;
    const fakeServer = {
      upgrade: (_request: Request, options: { data: { sessionUsername?: string | null } }) => {
        seen = options.data;
        return true;
      },
    };
    const headers: Record<string, string> = { upgrade: "websocket" };
    if (cookie) headers.Cookie = cookie;
    await serve.fetch(new Request(`http://localhost${WS_ROUTE}`, { headers }), fakeServer);
    return seen?.sessionUsername ?? null;
  }

  it("authenticates the websocket handshake from the session cookie", async () => {
    await startWith({ mark: { password: "s3cret" } });
    const created = await serve.routes[AUTH_ROUTE]!(new Request(`http://localhost${AUTH_ROUTE}`, { method: "POST", headers: basic("mark", "s3cret") }));

    expect(await upgradeWith(`${SESSION_COOKIE}=${sessionIdFrom(created)}`)).toBe("mark");
  });

  it("leaves the handshake anonymous without a cookie, or with a bogus one", async () => {
    await startWith({ mark: { password: "s3cret" } });

    expect(await upgradeWith(null)).toBeNull();
    expect(await upgradeWith(`${SESSION_COOKIE}=not-a-real-session`)).toBeNull();
  });
});
