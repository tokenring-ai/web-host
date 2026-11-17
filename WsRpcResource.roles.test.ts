import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import { RpcService } from "@tokenring-ai/rpc";
import { z } from "zod";
import { ADMIN_ONLY_METHODS, isAdminOnlyMethod } from "./adminOnlyMethods.ts";
import type { BunWebSocket } from "./types.ts";
import UserService, { type ConfigUsers } from "./UserService.ts";
import { loginRateLimiter } from "./util/authSecurity.ts";
import WsRpcResource from "./WsRpcResource.ts";

type Sent = Record<string, any>;

let dir: string;
let app: TokenRingApp;
let config: ConfigUsers;
let users: UserService;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tr-roles-"));
  loginRateLimiter.reset();
  config = { root: { password: "rootpass1", role: "admin" }, guest: { password: "guestpass1", role: "member" } };
  users = new UserService({ filePath: path.join(dir, "users.json"), configUsers: () => config });
  await users.load();
  app = createTestingApp();
  const rpc = new RpcService();
  rpc.registerEndpoint({
    name: "Open",
    path: "/rpc/open",
    methods: { ping: { type: "query", inputSchema: z.object({}), resultSchema: z.object({ pong: z.boolean() }), execute: () => ({ pong: true }) } },
  });
  app.addService(RpcService, rpc);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function connect(sessionUsername: string | null = null, sessionValid?: () => boolean) {
  const sent: Sent[] = [];
  const ws: BunWebSocket = {
    data: { path: "/rpc:ws", abortController: new AbortController(), sessionUsername, ...(sessionValid ? { sessionValid } : {}) },
    send: payload => void sent.push(typeof payload === "string" ? JSON.parse(payload) : (payload as Sent)),
    close: () => undefined,
  };
  const handler = new WsRpcResource(app, "/rpc:ws", () => ({ users: config }), users).handler();
  handler.open(ws);
  let id = 0;
  const call = async (method: string, params: unknown = {}) => {
    await handler.message(ws, JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }));
    return sent[sent.length - 1] as Sent;
  };
  return { ws, call, sent };
}

describe("admin-only methods", () => {
  it("lists each method once, as `<path>.<name>`", () => {
    expect(new Set(ADMIN_ONLY_METHODS).size).toBe(ADMIN_ONLY_METHODS.length);
    for (const id of ADMIN_ONLY_METHODS) expect(id).toMatch(/^\/rpc\/[a-z-]+\.[A-Za-z]+$/);
    expect(isAdminOnlyMethod("/rpc/users.listUsers")).toBe(true);
    expect(isAdminOnlyMethod("/rpc/users.createMyAccessLink")).toBe(false);
    expect(isAdminOnlyMethod("/rpc/users.getMe")).toBe(false);
    expect(isAdminOnlyMethod("/rpc/open.ping")).toBe(false);
  });

  it("refuses a config member on every listed method, before the method is even looked up", async () => {
    const { call } = connect();
    await call("auth", { username: "guest", password: "guestpass1" });
    for (const id of ADMIN_ONLY_METHODS) {
      const reply = await call(id, {});
      expect(reply.error?.code, id).toBe(-32003);
    }
  });

  it("refuses a managed member on every listed method, and lets an admin through the gate", async () => {
    await users.createUser({ username: "mem", role: "member", password: "longenough", createdBy: null });
    await users.createUser({ username: "adm", role: "admin", password: "longenough", createdBy: null });
    const member = connect();
    await member.call("auth", { username: "mem", password: "longenough" });
    const admin = connect();
    await admin.call("auth", { username: "adm", password: "longenough" });

    for (const id of ADMIN_ONLY_METHODS) {
      expect((await member.call(id, {})).error?.code, id).toBe(-32003);
      // Past the gate: the only failure left is "no such method", since this test registers none of them.
      expect((await admin.call(id, {})).error?.code, id).toBe(-32601);
    }
  });

  it("lets a member use ordinary methods", async () => {
    const { call } = connect();
    await call("auth", { username: "guest", password: "guestpass1" });
    expect((await call("/rpc/open.ping")).result).toEqual({ pong: true });
  });

  it("applies the gate to a socket authenticated by session cookie, using the live role", async () => {
    const { call } = connect("guest");
    expect((await call("/rpc/vault.getItem", {})).error?.code).toBe(-32003);
    config = { ...config, guest: { password: "guestpass1", role: "admin" } };
    expect((await call("/rpc/vault.getItem", {})).error?.code).toBe(-32601);
  });

  it("reports the role in the auth result", async () => {
    const { call } = connect();
    expect((await call("auth", { username: "guest", password: "guestpass1" })).result).toEqual({ authenticated: true, username: "guest", role: "member" });
  });
});

describe("revocation on open sockets", () => {
  it("cuts off a password socket when the user is removed", async () => {
    await users.createUser({ username: "mem", role: "member", password: "longenough", createdBy: null });
    await users.createUser({ username: "adm", role: "admin", password: "longenough", createdBy: null });
    const { call } = connect();
    await call("auth", { username: "mem", password: "longenough" });
    expect((await call("/rpc/open.ping")).result).toEqual({ pong: true });

    await users.removeUser("mem");

    expect((await call("/rpc/open.ping")).error?.code).toBe(-32001);
  });

  const endsOn: Array<[string, () => Promise<void>]> = [
    ["password change", () => users.setPassword("mem", "different pw 1")],
    ["role change", () => users.setRole("mem", "admin")],
    ["sign out everywhere", () => users.signOutUser("mem")],
  ];
  for (const [label, change] of endsOn) {
    it(`cuts off a password socket on ${label}`, async () => {
      await users.createUser({ username: "mem", role: "member", password: "longenough", createdBy: null });
      const { call } = connect();
      await call("auth", { username: "mem", password: "longenough" });
      expect((await call("/rpc/open.ping")).result).toEqual({ pong: true });

      await change();

      expect((await call("/rpc/open.ping")).error?.code).toBe(-32001);
    });
  }

  it("cuts off a cookie socket when its session stops being valid", async () => {
    let valid = true;
    const { call } = connect("guest", () => valid);
    expect((await call("/rpc/open.ping")).result).toEqual({ pong: true });
    valid = false;
    expect((await call("/rpc/open.ping")).error?.code).toBe(-32001);
  });

  it("rate limits wrong passwords for managed users over the socket", async () => {
    await users.createUser({ username: "mem", role: "member", password: "longenough", createdBy: null });
    const { call } = connect();
    for (let i = 0; i < 10; i++) expect((await call("auth", { username: "mem", password: "wrong" })).error?.message).toBe("Invalid username or password");
    expect((await call("auth", { username: "mem", password: "longenough" })).error?.message).toContain("Too many failed");
  });
});
