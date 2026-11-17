import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import { SESSION_COOKIE } from "./sessionStore.ts";
import { loginRateLimiter } from "./util/authSecurity.ts";
import WebHostService from "./WebHostService.ts";

type ServeArgs = {
  routes: Record<string, (request: Request) => Promise<Response> | Response>;
  fetch: (request: Request, server: unknown) => Promise<Response | undefined>;
};

const REDEEM = "/api/auth/redeem";
const SESSION = "/api/auth/session";
const WS_ROUTE = "/rpc:ws";
const HOST = "http://phone.test:3000";
const mockServer = { hostname: "127.0.0.1", port: 3000, stop: mock(), reload: mock() };

let dir: string;
let app: TokenRingApp;
let serve: ServeArgs;
let service: WebHostService;
const logged: string[] = [];

function configWith(extra: Record<string, unknown> = {}) {
  return {
    host: "127.0.0.1",
    port: 3000,
    auth: { users: { root: { password: "rootpass1", role: "admin" } }, usersFile: path.join(dir, "users.json") },
    ...extra,
  };
}

async function start(extra: Record<string, unknown> = {}) {
  service = new WebHostService(app, configWith(extra) as never);
  service.registerResource("ws", { wsRoutes: { [WS_ROUTE]: { open: () => undefined } } });
  await service.listen();
  return service;
}

function redeem(body: unknown, headers: Record<string, string> = {}, method = "POST") {
  const init: RequestInit = {
    method,
    headers: { Origin: HOST, "Content-Type": "application/json", ...headers },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  };
  return serve.routes[REDEEM]!(new Request(`${HOST}${REDEEM}`, init));
}

function cookieOf(response: Response): string {
  return new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(response.headers.get("Set-Cookie") ?? "")?.[1] ?? "";
}

async function newManagedLink(username = "alice", role: "admin" | "member" = "member") {
  await service.users.createUser({ username, role, createdBy: "root" });
  return service.users.createAccessLink({ username, ttlMinutes: 60, createdBy: "root" });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tr-redeem-"));
  logged.length = 0;
  mock.clearAllMocks();
  loginRateLimiter.reset();
  spyOn(Bun, "serve").mockImplementation(((args: ServeArgs) => {
    serve = args;
    return mockServer;
  }) as unknown as typeof Bun.serve);
  app = createTestingApp();
  spyOn(app, "serviceOutput").mockImplementation((...args: unknown[]) => void logged.push(JSON.stringify(args)));
  spyOn(app, "serviceError").mockImplementation((...args: unknown[]) => void logged.push(JSON.stringify(args)));
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(JSON.stringify(args)));
  }
});
afterEach(() => {
  mock.restore();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/auth/redeem", () => {
  it("trades a link for an HttpOnly session cookie and uses it up", async () => {
    await start();
    const link = await newManagedLink();

    const response = await redeem({ token: link.token });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, username: "alice", role: "member" });
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${7 * 24 * 3600}`);
    expect(cookie).not.toContain("Secure");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(service.resolveSessionUsername(new Request(HOST, { headers: { Cookie: `${SESSION_COOKIE}=${cookieOf(response)}` } }))).toBe("alice");

    const replay = await redeem({ token: link.token });
    expect(replay.status).toBe(401);
    expect(replay.headers.get("Set-Cookie")).toBeNull();
  });

  it("adds Secure behind an https proxy", async () => {
    await start();
    const link = await newManagedLink();
    const response = await redeem({ token: link.token }, { "X-Forwarded-Proto": "https" });
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
  });

  it("signs in a config user from a link with an in-memory session", async () => {
    await start();
    const link = await service.users.createAccessLink({ username: "root", ttlMinutes: 10, createdBy: "startup" });
    const response = await redeem({ token: link.token });
    expect(await response.json()).toEqual({ ok: true, username: "root", role: "admin" });
    expect(service.resolveSessionUsername(new Request(HOST, { headers: { Cookie: `${SESSION_COOKIE}=${cookieOf(response)}` } }))).toBe("root");
  });

  it("gives unknown, malformed, expired and used tokens the same answer", async () => {
    await start();
    const used = await newManagedLink("bob");
    await redeem({ token: used.token });
    const expiring = await service.users.createAccessLink({ username: "bob", ttlMinutes: 15, createdBy: "root" });
    const realNow = Date.now;
    Date.now = () => realNow() + 16 * 60_000;
    try {
      const bodies = await Promise.all(
        [{ token: used.token }, { token: expiring.token }, { token: "A".repeat(43) }, { token: "x" }, { token: 5 }, {}, "not json"].map(async body => {
          const response = await redeem(body);
          return { status: response.status, text: await response.text(), cookie: response.headers.get("Set-Cookie") };
        }),
      );
      for (const outcome of bodies) expect(outcome).toEqual(bodies[0] as never);
      expect(bodies[0]?.status).toBe(401);
      expect(bodies[0]?.cookie).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it("rejects cross-origin, origin-less and non-JSON requests without consuming the token", async () => {
    await start();
    const link = await newManagedLink();

    expect((await redeem({ token: link.token }, { Origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = await serve.routes[REDEEM]!(
      new Request(`${HOST}${REDEEM}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: link.token }) }),
    );
    expect(noOrigin.status).toBe(403);
    expect((await redeem({ token: link.token }, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect((await redeem({ token: link.token }, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await redeem({ token: link.token }, {}, "GET")).status).toBe(405);

    expect((await redeem({ token: link.token })).status).toBe(200);
  });

  it("rejects oversized bodies", async () => {
    await start();
    expect((await redeem("x".repeat(5000))).status).toBe(413);
  });

  it("rate limits failures per client and keeps limiting even a valid link", async () => {
    await start();
    const link = await newManagedLink();
    for (let i = 0; i < 10; i++) expect((await redeem({ token: "B".repeat(43) }, { "X-Forwarded-For": "9.9.9.9" })).status).toBe(401);

    const blocked = await redeem({ token: link.token }, { "X-Forwarded-For": "9.9.9.9" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).not.toBeNull();
    // A different client is unaffected, and the token was not consumed by the blocked attempt.
    expect((await redeem({ token: link.token }, { "X-Forwarded-For": "8.8.8.8" })).status).toBe(200);
  });

  it("a successful redemption does not reset the failure budget", async () => {
    await start();
    for (let i = 0; i < 9; i++) await redeem({ token: "B".repeat(43) });
    const link = await newManagedLink();
    expect((await redeem({ token: link.token })).status).toBe(200);
    await redeem({ token: "C".repeat(43) });
    expect((await redeem({ token: "D".repeat(43) })).status).toBe(429);
  });

  it("lets exactly one of two simultaneous redemptions in", async () => {
    await start();
    const link = await newManagedLink();
    const [a, b] = await Promise.all([redeem({ token: link.token }), redeem({ token: link.token })]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 401]);
  });

  it("survives a restart: the session persists, the used link stays used", async () => {
    await start();
    const link = await newManagedLink();
    const response = await redeem({ token: link.token });
    const cookie = `${SESSION_COOKIE}=${cookieOf(response)}`;
    await service.stop();

    const restarted = await start();
    expect(restarted.resolveSessionUsername(new Request(HOST, { headers: { Cookie: cookie } }))).toBe("alice");
    expect((await redeem({ token: link.token })).status).toBe(401);
  });

  it("an admin link and a member link carry different roles", async () => {
    await start();
    const admin = await newManagedLink("carol", "admin");
    expect(((await (await redeem({ token: admin.token })).json()) as { role: string }).role).toBe("admin");
  });
});

describe("managed password sign-in over HTTP", () => {
  it("signs in a managed user with Basic credentials and persists the session", async () => {
    await start();
    await service.users.createUser({ username: "dave", role: "member", password: "correct horse", createdBy: "root" });
    const response = await serve.routes[SESSION]!(
      new Request(`${HOST}${SESSION}`, { method: "POST", headers: { Authorization: `Basic ${btoa("dave:correct horse")}` } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, username: "dave", role: "member" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(service.users.resolveSession(cookieOf(response))).toBe("dave");

    const bad = await serve.routes[SESSION]!(new Request(`${HOST}${SESSION}`, { method: "POST", headers: { Authorization: `Basic ${btoa("dave:nope")}` } }));
    expect(bad.status).toBe(401);
  });

  it("throttles repeated wrong passwords for a managed user", async () => {
    await start();
    await service.users.createUser({ username: "dave", role: "member", password: "correct horse", createdBy: "root" });
    const attempt = (password: string) =>
      serve.routes[SESSION]!(new Request(`${HOST}${SESSION}`, { method: "POST", headers: { Authorization: `Basic ${btoa(`dave:${password}`)}` } }));
    for (let i = 0; i < 10; i++) expect((await attempt("wrong")).status).toBe(401);
    expect((await attempt("correct horse")).status).toBe(429);
  });

  it("DELETE ends a managed session", async () => {
    await start();
    await service.users.createUser({ username: "dave", role: "member", password: "correct horse", createdBy: "root" });
    const created = await serve.routes[SESSION]!(
      new Request(`${HOST}${SESSION}`, { method: "POST", headers: { Authorization: `Basic ${btoa("dave:correct horse")}` } }),
    );
    const id = cookieOf(created);
    await serve.routes[SESSION]!(new Request(`${HOST}${SESSION}`, { method: "DELETE", headers: { Cookie: `${SESSION_COOKIE}=${id}` } }));
    expect(service.users.resolveSession(id)).toBeNull();
  });
});

describe("secrets never reach logs", () => {
  it("keeps tokens, passwords and session ids out of every log channel across a redeem, login and failure flow", async () => {
    await start();
    const created = await service.users.createUser({ username: "erin", role: "member", password: "super secret pw", createdBy: "root" });
    expect(created.user.username).toBe("erin");
    const link = await service.users.createAccessLink({ username: "erin", ttlMinutes: 60, createdBy: "root" });
    const writes: string[] = [];
    const stdout = spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as never);

    const ok = await redeem({ token: link.token });
    await redeem({ token: link.token });
    await redeem({ token: "Z".repeat(43) });
    const login = await serve.routes[SESSION]!(
      new Request(`${HOST}${SESSION}`, { method: "POST", headers: { Authorization: `Basic ${btoa("erin:super secret pw")}` } }),
    );
    await serve.routes[SESSION]!(new Request(`${HOST}${SESSION}`, { method: "POST", headers: { Authorization: `Basic ${btoa("erin:wrong pw")}` } }));
    stdout.mockRestore();

    const output = [...logged, ...writes].join("\n");
    for (const secret of [link.token, "super secret pw", "wrong pw", cookieOf(ok), cookieOf(login), "Z".repeat(43)]) {
      expect(output).not.toContain(secret);
    }
  });
});

describe("websocket handshake", () => {
  it("authenticates the socket from a managed session cookie, and the socket check ends when the user is removed", async () => {
    await start();
    const link = await newManagedLink();
    const response = await redeem({ token: link.token });
    let data: { sessionUsername?: string | null; sessionValid?: () => boolean; requestOrigin?: string } | undefined;
    const fakeServer = {
      upgrade: (_request: Request, options: { data: typeof data }) => {
        data = options.data;
        return true;
      },
    };
    await serve.fetch(
      new Request(`${HOST}${WS_ROUTE}`, { headers: { upgrade: "websocket", Cookie: `${SESSION_COOKIE}=${cookieOf(response)}`, host: "phone.test:3000" } }),
      fakeServer,
    );
    expect(data?.sessionUsername).toBe("alice");
    expect(data?.requestOrigin).toBe("http://phone.test:3000");
    expect(data?.sessionValid?.()).toBe(true);

    await service.users.removeUser("alice");
    expect(data?.sessionValid?.()).toBe(false);
  });
});
