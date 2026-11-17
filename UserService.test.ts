import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import UserService, { type ConfigUsers, UserServiceError } from "./UserService.ts";

let dir: string;
let file: string;
let reports: string[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tr-users-"));
  file = path.join(dir, "users.json");
  reports = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function service(options: { configUsers?: ConfigUsers; now?: () => number; filePath?: string | undefined } = {}) {
  const svc = new UserService({
    filePath: "filePath" in options ? options.filePath : file,
    configUsers: () => options.configUsers ?? { root: { password: "rootpass1", role: "admin" } },
    now: options.now,
    report: message => reports.push(message),
    sessionDays: 7,
  });
  await svc.load();
  return svc;
}

const rejects = async (promise: Promise<unknown>, code?: string) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(UserServiceError);
    if (code) expect(String((error as UserServiceError).code)).toBe(code);
    return;
  }
  throw new Error("expected a rejection");
};

describe("managed users", () => {
  it("stores only an argon2id hash, never the password, in a 0600 file", async () => {
    const svc = await service();
    await svc.createUser({ username: "Alice", role: "member", password: "correct horse", createdBy: "root" });

    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toContain("correct horse");
    expect(JSON.parse(raw).users[0].passwordHash).toStartWith("$argon2id$");
    expect(JSON.parse(raw).users[0].username).toBe("alice");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir).filter(name => name.endsWith(".tmp"))).toEqual([]);
  });

  it("authenticates by password, case-insensitively for managed names, and records last login", async () => {
    const svc = await service();
    await svc.createUser({ username: "alice", role: "member", password: "correct horse", createdBy: "root" });

    expect((await svc.authenticate("ALICE", "correct horse"))?.username).toBe("alice");
    expect(await svc.authenticate("alice", "wrong")).toBeNull();
    expect(await svc.authenticate("nobody", "correct horse")).toBeNull();
    expect(svc.listUsers().find(user => user.username === "alice")?.lastLoginAt).not.toBeNull();
  });

  it("does not let a user without a password sign in with an empty one", async () => {
    const svc = await service();
    await svc.createUser({ username: "linkonly", role: "member", link: { ttlMinutes: 60 }, createdBy: "root" });
    expect(await svc.authenticate("linkonly", "")).toBeNull();
    expect(await svc.authenticate("linkonly", "anything")).toBeNull();
  });

  it("rejects bad names, names clashing with config users, and duplicates in any case", async () => {
    const svc = await service();
    await rejects(svc.createUser({ username: "__proto__", role: "member", password: "longenough", createdBy: null }), "invalid");
    await rejects(svc.createUser({ username: "constructor", role: "member", password: "longenough", createdBy: null }), "invalid");
    await rejects(svc.createUser({ username: "../x", role: "member", password: "longenough", createdBy: null }), "invalid");
    await rejects(svc.createUser({ username: "ROOT", role: "member", password: "longenough", createdBy: null }), "exists");
    await svc.createUser({ username: "bob", role: "member", password: "longenough", createdBy: null });
    await rejects(svc.createUser({ username: "BOB", role: "member", password: "longenough", createdBy: null }), "exists");
    await rejects(svc.createUser({ username: "short", role: "member", password: "short", createdBy: null }), "invalid");
  });

  it("keeps config users read-only", async () => {
    const svc = await service();
    await rejects(svc.setPassword("root", "newpassword1"), "readOnly");
    await rejects(svc.setRole("root", "member"), "readOnly");
    await rejects(svc.removeUser("root"), "readOnly");
    expect(svc.listUsers().find(user => user.username === "root")?.source).toBe("config");
  });

  it("refuses to remove or demote the last administrator, counting config admins", async () => {
    const svc = await service({ configUsers: {} });
    await svc.createUser({ username: "boss", role: "admin", password: "longenough", createdBy: null });
    await rejects(svc.removeUser("boss"), "forbidden");
    await rejects(svc.setRole("boss", "member"), "forbidden");

    await svc.createUser({ username: "second", role: "admin", password: "longenough", createdBy: null });
    await svc.setRole("boss", "member");
    await rejects(svc.removeUser("second"), "forbidden");
  });

  it("a config admin counts as an administrator for the last-admin rule", async () => {
    const svc = await service();
    await svc.createUser({ username: "boss", role: "admin", password: "longenough", createdBy: null });
    await svc.removeUser("boss");
    expect(svc.listUsers().some(user => user.username === "boss")).toBe(false);
  });

  it("disables a managed account whose name later collides with a config user", async () => {
    const first = await service({ configUsers: {} });
    await first.createUser({ username: "sam", role: "member", password: "longenough", createdBy: null });

    const second = await service({ configUsers: { sam: { password: "configpass" } } });
    expect(await second.authenticate("sam", "longenough")).toBeNull();
    expect((await second.authenticate("sam", "configpass"))?.source).toBe("config");
    expect(reports.join(" ")).toContain("sam");
  });
});

describe("persistence", () => {
  it("reloads users, hashes and sessions after a restart", async () => {
    const first = await service();
    await first.createUser({ username: "alice", role: "member", password: "correct horse", createdBy: "root" });
    const sessionId = await first.createSession("alice", "TestAgent/1");

    const second = await service();
    expect(second.resolveSession(sessionId)).toBe("alice");
    expect((await second.authenticate("alice", "correct horse"))?.username).toBe("alice");
  });

  it("stores only a hash of the session id", async () => {
    const svc = await service();
    await svc.createUser({ username: "alice", role: "member", password: "correct horse", createdBy: "root" });
    const sessionId = await svc.createSession("alice");
    expect(fs.readFileSync(file, "utf8")).not.toContain(sessionId);
  });

  it("expires sessions and slides expiry on use", async () => {
    let now = 1_000_000;
    const svc = await service({ now: () => now });
    await svc.createUser({ username: "alice", role: "member", password: "correct horse", createdBy: "root" });
    const sessionId = await svc.createSession("alice");
    const day = 24 * 3600 * 1000;

    now += 6 * day;
    expect(svc.resolveSession(sessionId)).toBe("alice");
    now += 6 * day; // 12 days after creation, 6 after last use: still alive thanks to sliding expiry
    expect(svc.resolveSession(sessionId)).toBe("alice");
    now += 8 * day;
    expect(svc.resolveSession(sessionId)).toBeNull();
  });

  it("leaves a corrupt file untouched, disables managed accounts, and keeps config users working", async () => {
    fs.writeFileSync(file, "{ this is not json", { mode: 0o600 });
    const svc = await service();

    expect(svc.unavailableReason).toContain("left untouched");
    expect(reports.length).toBe(1);
    expect(await svc.authenticate("root", "rootpass1")).not.toBeNull();
    await rejects(svc.createUser({ username: "bob", role: "member", password: "longenough", createdBy: null }), "unavailable");
    expect(fs.readFileSync(file, "utf8")).toBe("{ this is not json");
    expect(svc.listUsers().map(user => user.username)).toEqual(["root"]);
  });

  it("treats a structurally wrong or newer-version file as corrupt rather than dropping accounts", async () => {
    for (const body of [
      JSON.stringify({ version: 2, users: [], accessLinks: [], sessions: [] }),
      JSON.stringify({ version: 1, users: [{ username: "x" }] }),
      JSON.stringify({
        version: 1,
        users: [{ username: "__proto__", role: "member", createdAt: 1, createdBy: null, lastLoginAt: null }],
        accessLinks: [],
        sessions: [],
      }),
    ]) {
      fs.writeFileSync(file, body);
      const svc = await service();
      expect(svc.unavailableReason).not.toBeNull();
      expect(fs.readFileSync(file, "utf8")).toBe(body);
    }
  });

  it("rolls back and reports when the file cannot be written", async () => {
    const svc = await service({ filePath: path.join(dir, "missing-parent", "x", "users.json") });
    // Make the parent a file so mkdir fails.
    fs.writeFileSync(path.join(dir, "missing-parent"), "blocker");
    await rejects(svc.createUser({ username: "bob", role: "member", password: "longenough", createdBy: null }), "unavailable");
    expect(svc.listUsers().some(user => user.username === "bob")).toBe(false);
  });

  it("works in memory when no file is configured", async () => {
    const svc = await service({ filePath: undefined });
    await svc.createUser({ username: "bob", role: "member", password: "longenough", createdBy: null });
    expect(svc.persistent).toBe(false);
    expect((await svc.authenticate("bob", "longenough"))?.username).toBe("bob");
  });

  it("serializes concurrent writes so none is lost", async () => {
    const svc = await service();
    await Promise.all(Array.from({ length: 12 }, (_, i) => svc.createUser({ username: `user${i}`, role: "member", password: "longenough", createdBy: null })));
    const reloaded = await service();
    expect(reloaded.listUsers().filter(user => user.source === "managed")).toHaveLength(12);
  });
});

describe("revocation", () => {
  async function withSession() {
    const svc = await service();
    await svc.createUser({ username: "alice", role: "member", password: "correct horse", createdBy: "root" });
    const sessionId = await svc.createSession("alice");
    const stamp = svc.stampOf("alice");
    return { svc, sessionId, stamp };
  }

  it("removing a user ends their sessions and links immediately", async () => {
    const { svc, sessionId } = await withSession();
    const link = await svc.createAccessLink({ username: "alice", ttlMinutes: 60, createdBy: "root" });
    await svc.removeUser("alice");
    expect(svc.resolveSession(sessionId)).toBeNull();
    expect(await svc.redeemAccessLink(link.token)).toBeNull();
  });

  it("changing the password ends sessions and changes the stamp", async () => {
    const { svc, sessionId, stamp } = await withSession();
    await svc.setPassword("alice", "another password");
    expect(svc.resolveSession(sessionId)).toBeNull();
    expect(svc.stampOf("alice")).not.toBe(stamp);
    expect(await svc.authenticate("alice", "correct horse")).toBeNull();
    expect(await svc.authenticate("alice", "another password")).not.toBeNull();
  });

  it("changing the role ends sessions and changes the stamp", async () => {
    const { svc, sessionId, stamp } = await withSession();
    await svc.setRole("alice", "admin");
    expect(svc.resolveSession(sessionId)).toBeNull();
    expect(svc.stampOf("alice")).not.toBe(stamp);
  });

  it("sign out everywhere ends sessions but keeps the account", async () => {
    const { svc, sessionId } = await withSession();
    await svc.signOutUser("alice");
    expect(svc.resolveSession(sessionId)).toBeNull();
    expect(svc.roleOf("alice")).toBe("member");
  });

  it("a persisted session of a removed user does not survive a restart", async () => {
    const { svc, sessionId } = await withSession();
    await svc.removeUser("alice");
    const reloaded = await service();
    expect(reloaded.resolveSession(sessionId)).toBeNull();
  });
});

describe("access links", () => {
  it("returns the token once and stores only its sha256", async () => {
    const svc = await service();
    await svc.createUser({ username: "alice", role: "member", createdBy: "root" });
    const link = await svc.createAccessLink({ username: "alice", ttlMinutes: 60, createdBy: "root" });

    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toContain(link.token);
    expect(JSON.parse(raw).accessLinks[0].tokenHash).toBe(new Bun.CryptoHasher("sha256").update(link.token).digest("hex"));
    expect(JSON.stringify(svc.listAccessLinks())).not.toContain(link.token);
    expect(JSON.stringify(svc.listUsers())).not.toContain(link.token);
  });

  it("uses 256 bits of randomness per token", async () => {
    const svc = await service();
    const tokens = new Set<string>();
    for (let i = 0; i < 50; i++) tokens.add((await svc.createAccessLink({ username: "root", ttlMinutes: 15, createdBy: null })).token);
    expect(tokens.size).toBe(50);
    expect(Buffer.from([...tokens][0] as string, "base64url").length).toBe(32);
  });

  it("redeems once, then looks exactly like an unknown token", async () => {
    const svc = await service();
    await svc.createUser({ username: "alice", role: "member", createdBy: "root" });
    const link = await svc.createAccessLink({ username: "alice", ttlMinutes: 60, createdBy: "root" });

    const first = await svc.redeemAccessLink(link.token, "Phone/1");
    expect(first?.username).toBe("alice");
    expect(svc.resolveSession(first?.sessionId)).toBe("alice");
    expect(await svc.redeemAccessLink(link.token)).toBeNull();
    expect(await svc.redeemAccessLink("A".repeat(43))).toBeNull();
    expect(await svc.redeemAccessLink("short")).toBeNull();
  });

  it("lets exactly one of many simultaneous redemptions win", async () => {
    const svc = await service();
    await svc.createUser({ username: "alice", role: "member", createdBy: "root" });
    const link = await svc.createAccessLink({ username: "alice", ttlMinutes: 60, createdBy: "root" });

    const results = await Promise.all(Array.from({ length: 10 }, () => svc.redeemAccessLink(link.token)));
    expect(results.filter(result => result !== null)).toHaveLength(1);
    expect(svc.listUsers().find(user => user.username === "alice")?.activeSessions).toBe(1);
  });

  it("the used mark survives a restart, so a replay after restart fails", async () => {
    const svc = await service();
    await svc.createUser({ username: "alice", role: "member", createdBy: "root" });
    const link = await svc.createAccessLink({ username: "alice", ttlMinutes: 60, createdBy: "root" });
    expect(await svc.redeemAccessLink(link.token)).not.toBeNull();

    const reloaded = await service();
    expect(await reloaded.redeemAccessLink(link.token)).toBeNull();
  });

  it("expires, and prunes expired and spent links from the file", async () => {
    let now = 5_000_000;
    const svc = await service({ now: () => now });
    await svc.createUser({ username: "alice", role: "member", createdBy: "root" });
    const link = await svc.createAccessLink({ username: "alice", ttlMinutes: 15, createdBy: "root" });
    now += 16 * 60_000;

    expect(await svc.redeemAccessLink(link.token)).toBeNull();
    await svc.createAccessLink({ username: "alice", ttlMinutes: 15, createdBy: "root" });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).accessLinks).toHaveLength(1);
  });

  it("can be revoked before use", async () => {
    const svc = await service();
    const link = await svc.createAccessLink({ username: "root", ttlMinutes: 60, createdBy: null });
    expect(await svc.revokeAccessLink(link.id)).toBe(true);
    expect(await svc.redeemAccessLink(link.token)).toBeNull();
  });

  it("signs a config user in with an in-memory credential-bound result and no persistent session", async () => {
    const svc = await service();
    const link = await svc.createAccessLink({ username: "root", ttlMinutes: 10, createdBy: "startup" });
    const redeemed = await svc.redeemAccessLink(link.token);
    expect(redeemed).toMatchObject({ username: "root", role: "admin", source: "config", credential: "rootpass1" });
    expect(redeemed?.sessionId).toBeUndefined();
  });

  it("refuses link lifetimes outside 15 minutes to 7 days", async () => {
    const svc = await service();
    expect(() => svc.clampLinkMinutes(5)).toThrow();
    expect(() => svc.clampLinkMinutes(7 * 24 * 60 + 1)).toThrow();
    expect(svc.clampLinkMinutes(undefined)).toBe(1440);
  });

  it("refuses links for unknown users and ends a link when a config user is removed", async () => {
    let config: ConfigUsers = { root: { password: "rootpass1" } };
    const svc = new UserService({ filePath: file, configUsers: () => config });
    await svc.load();
    await rejects(svc.createAccessLink({ username: "ghost", ttlMinutes: 15, createdBy: null }), "notFound");
    const link = await svc.createAccessLink({ username: "root", ttlMinutes: 15, createdBy: null });
    config = {};
    expect(await svc.redeemAccessLink(link.token)).toBeNull();
  });
});
