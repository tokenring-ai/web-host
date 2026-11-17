import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import WebHostService from "../WebHostService.ts";
import usersRpc from "./users.ts";

let dir: string;
let app: TokenRingApp;
let service: WebHostService;

const ctx = (username: string | null, requestOrigin?: string) => ({ username, ...(requestOrigin ? { requestOrigin } : {}) });
const call = async (name: keyof typeof usersRpc.methods, args: unknown, context: ReturnType<typeof ctx>) =>
  (usersRpc.methods[name].execute as (a: unknown, app: TokenRingApp, c: unknown) => unknown)(args, app, context);

async function start(extra: Record<string, unknown> = {}) {
  spyOn(Bun, "serve").mockImplementation((() => ({ hostname: "127.0.0.1", port: 3000, stop: mock(), reload: mock() })) as unknown as typeof Bun.serve);
  service = new WebHostService(app, {
    host: "127.0.0.1",
    port: 3000,
    auth: {
      users: { root: { password: "rootpass1", role: "admin" }, guest: { password: "guestpass1", role: "member" } },
      usersFile: path.join(dir, "users.json"),
    },
    ...extra,
  } as never);
  app.addService(WebHostService, service);
  await service.listen();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tr-rpc-users-"));
  app = createTestingApp();
});
afterEach(() => {
  mock.restore();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("users RPC", () => {
  it("creates a user with an access link whose URL keeps the token in the fragment", async () => {
    await start();
    const result = (await call("createUser", { username: "Pat", role: "member", method: "accessLink" }, ctx("root", "http://192.168.1.5:3000"))) as any;

    expect(result.user).toMatchObject({ username: "pat", role: "member", source: "managed", hasPassword: false, createdBy: "root" });
    const url = new URL(result.link.url);
    expect(url.origin).toBe("http://192.168.1.5:3000");
    expect(url.search).toBe("");
    expect(url.pathname).toBe("/");
    expect(url.hash).toMatch(/^#access=[A-Za-z0-9_-]{43}$/);
    expect(result.link.expiresAt - Date.now()).toBeGreaterThan(23.9 * 3600 * 1000);
    // Not retrievable again.
    expect(JSON.stringify(await call("listUsers", {}, ctx("root")))).not.toContain(url.hash.slice(8));
    expect(JSON.stringify(await call("listAccessLinks", {}, ctx("root")))).not.toContain(url.hash.slice(8));
  });

  it("generates a strong password when none is supplied, and uses the supplied one otherwise", async () => {
    await start();
    const generated = (await call("createUser", { username: "gen", role: "member", method: "password" }, ctx("root"))) as any;
    expect(generated.generatedPassword.length).toBeGreaterThanOrEqual(24);
    expect((await service.users.authenticate("gen", generated.generatedPassword))?.username).toBe("gen");

    const chosen = (await call("createUser", { username: "own", role: "member", method: "password", password: "my own password" }, ctx("root"))) as any;
    expect(chosen.generatedPassword).toBeUndefined();
    expect(JSON.stringify(chosen)).not.toContain("my own password");
    expect(await service.users.authenticate("own", "my own password")).not.toBeNull();
  });

  it("prefers the configured public URL over the request's address", async () => {
    await start({ publicUrl: "https://tokenring.example.com/" });
    const info = (await call("getRemoteAccessInfo", {}, ctx("root", "http://localhost:3000"))) as any;
    expect(info).toMatchObject({ baseUrl: "https://tokenring.example.com", baseUrlSource: "configured", isLoopback: false, isHttps: true });
  });

  it("flags a localhost request address as unreachable from a phone", async () => {
    await start();
    const info = (await call("getRemoteAccessInfo", {}, ctx("root", "http://localhost:3000"))) as any;
    expect(info).toMatchObject({ baseUrl: "http://localhost:3000", baseUrlSource: "request", isLoopback: true, isHttps: false });
    expect(info.warnings.join(" ")).toContain("only works on this computer");
  });

  it("refuses every admin method for a member, and for an anonymous caller", async () => {
    await start();
    const adminMethods = [
      "getRemoteAccessInfo",
      "listUsers",
      "listAccessLinks",
      "createUser",
      "createAccessLink",
      "setPassword",
      "setRole",
      "signOutUser",
      "removeUser",
      "revokeAccessLink",
    ] as const;
    for (const who of ["guest", null]) {
      for (const name of adminMethods) {
        await expect(call(name, {}, ctx(who)), `${who}/${name}`).rejects.toThrow("Administrator access required");
      }
    }
    await expect(call("getMe", {}, ctx(null))).rejects.toThrow();
  });

  it("lets any signed-in user mint a short link to sign in another device as themselves", async () => {
    await start();
    const link = (await call("createMyAccessLink", {}, ctx("guest", "http://192.168.1.5:3000"))) as any;
    const token = new URL(link.url).hash.slice("#access=".length);
    expect(link.expiresAt - Date.now()).toBeLessThan(16 * 60_000);
    expect((await service.users.redeemAccessLink(token))?.username).toBe("guest");
    expect(await call("getMe", {}, ctx("guest"))).toEqual({ username: "guest", role: "member", source: "config" });
  });

  it("keeps config accounts read-only", async () => {
    await start();
    for (const [name, args] of [
      ["setRole", { username: "guest", role: "admin" }],
      ["removeUser", { username: "guest" }],
      ["setPassword", { username: "guest", password: "newpassword1" }],
    ] as const) {
      await expect(call(name, args, ctx("root"))).rejects.toThrow("configuration file");
    }
  });

  it("cannot demote or remove the last admin, even oneself, but can once another exists", async () => {
    await start({ auth: { users: { helper: { password: "helperpass", role: "member" } }, usersFile: path.join(dir, "users.json") } });
    await service.users.createUser({ username: "solo", role: "admin", password: "longenough", createdBy: null });
    await expect(call("removeUser", { username: "solo" }, ctx("solo"))).rejects.toThrow("last administrator");
    await expect(call("setRole", { username: "solo", role: "member" }, ctx("solo"))).rejects.toThrow("last administrator");
    await service.users.createUser({ username: "duo", role: "admin", password: "longenough", createdBy: null });
    await call("removeUser", { username: "solo" }, ctx("solo"));
    expect(service.users.roleOf("solo")).toBeNull();
  });

  it("applies password, role, sign-out and removal to sessions immediately", async () => {
    await start();
    await call("createUser", { username: "pat", role: "member", method: "password", password: "longenough" }, ctx("root"));
    const login = async () => service.users.createSession("pat");

    let id = await login();
    await call("setPassword", { username: "pat", password: "another pass" }, ctx("root"));
    expect(service.users.resolveSession(id)).toBeNull();

    id = await login();
    await call("setRole", { username: "pat", role: "admin" }, ctx("root"));
    expect(service.users.resolveSession(id)).toBeNull();
    expect(service.users.roleOf("pat")).toBe("admin");

    id = await login();
    await call("signOutUser", { username: "pat" }, ctx("root"));
    expect(service.users.resolveSession(id)).toBeNull();

    id = await login();
    await call("removeUser", { username: "pat" }, ctx("root"));
    expect(service.users.resolveSession(id)).toBeNull();
  });

  it("revokes a link before it is used", async () => {
    await start();
    const link = (await call("createAccessLink", { username: "root", expiresInMinutes: 30 }, ctx("root", "http://h:1"))) as any;
    const [pending] = ((await call("listAccessLinks", {}, ctx("root"))) as any).links;
    expect(pending.id).toBe(link.id);
    expect(await call("revokeAccessLink", { id: link.id }, ctx("root"))).toEqual({ revoked: true });
    expect(await service.users.redeemAccessLink(new URL(link.url).hash.slice(8))).toBeNull();
  });

  it("lists config and managed users with counts and no secrets", async () => {
    await start();
    await call("createUser", { username: "pat", role: "member", method: "accessLink" }, ctx("root", "http://h:1"));
    const { users } = (await call("listUsers", {}, ctx("root"))) as any;
    expect(users.map((user: any) => [user.username, user.source])).toEqual([
      ["root", "config"],
      ["guest", "config"],
      ["pat", "managed"],
    ]);
    expect(users.find((user: any) => user.username === "pat").pendingAccessLinks).toBe(1);
    expect(JSON.stringify(users)).not.toMatch(/argon2|passwordHash|tokenHash|rootpass1/);
  });
});
