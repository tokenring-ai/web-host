import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { UserRole } from "./schema.ts";
import { canonicalUsername, usernameProblem } from "./usernames.ts";
import { passwordMatches } from "./util/authSecurity.ts";

/** Link tokens are 32 random bytes, base64url encoded: always exactly this long. */
export const ACCESS_TOKEN_LENGTH = 43;
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const MIN_LINK_MINUTES = 15;
export const MAX_LINK_MINUTES = 7 * 24 * 60;
export const DEFAULT_LINK_MINUTES = 24 * 60;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

const MAX_SESSIONS_PER_USER = 25;
const FLUSH_DELAY_MS = 30_000;
const USED_LINK_RETENTION_MS = 24 * 60 * 60 * 1000;

/** A failure whose message is safe to show to the administrator who caused it (it never contains a secret). */
export class UserServiceError extends Error {
  constructor(
    readonly code: "invalid" | "exists" | "notFound" | "forbidden" | "unavailable" | "readOnly",
    message: string,
  ) {
    super(message);
    this.name = "UserServiceError";
  }
}

const storedUserSchema = z.object({
  username: z.string(),
  role: z.enum(["admin", "member"]),
  passwordHash: z.string().optional(),
  createdAt: z.number(),
  createdBy: z.string().nullable(),
  lastLoginAt: z.number().nullable(),
});
const storedLinkSchema = z.object({
  id: z.string(),
  username: z.string(),
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.number(),
  expiresAt: z.number(),
  createdBy: z.string().nullable(),
  usedAt: z.number().optional(),
});
const storedSessionSchema = z.object({
  sessionIdHash: z.string().regex(/^[0-9a-f]{64}$/),
  username: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  lastSeenAt: z.number(),
  userAgent: z.string().optional(),
});
const storeFileSchema = z.object({
  version: z.literal(1),
  users: z.array(storedUserSchema),
  accessLinks: z.array(storedLinkSchema),
  sessions: z.array(storedSessionSchema),
});

type StoredUser = z.infer<typeof storedUserSchema>;
type StoredLink = z.infer<typeof storedLinkSchema>;
type StoredSession = z.infer<typeof storedSessionSchema>;
type StoreState = { users: StoredUser[]; accessLinks: StoredLink[]; sessions: StoredSession[] };

export type ConfigUsers = Record<string, { password: string; role?: UserRole | undefined }>;

export type AuthenticatedUser = {
  username: string;
  role: UserRole;
  source: "config" | "managed";
  /** Config users: the stored credential, rechecked per call so a changed password ends the sign-in. */
  credential?: string;
  /** Managed users: changes whenever their password/role changes or they are signed out. */
  stamp?: string;
};

export type RedeemedLink = {
  username: string;
  role: UserRole;
  source: "config" | "managed";
  /** Config users: their stored credential, which the in-memory session is bound to. */
  credential?: string;
  /** Managed users: the new persistent session's id (shown only to the redeemer, as a cookie). */
  sessionId?: string;
};

export type UserSummary = {
  username: string;
  role: UserRole;
  source: "config" | "managed";
  hasPassword: boolean;
  createdAt: number | null;
  createdBy: string | null;
  lastLoginAt: number | null;
  activeSessions: number;
  pendingAccessLinks: number;
};

export type AccessLinkSummary = {
  id: string;
  username: string;
  createdAt: number;
  expiresAt: number;
  createdBy: string | null;
};

export type UserServiceOptions = {
  /** Where managed state lives (mode 0600). Without it the state is memory-only. */
  filePath?: string | undefined;
  sessionDays?: number | undefined;
  configUsers?: (() => ConfigUsers) | undefined;
  now?: (() => number) | undefined;
  /** Tells the operator about a problem; messages never contain secrets. */
  report?: ((message: string) => void) | undefined;
  /** Config-user sign-ins live in the web host's in-memory store; this counts them for the user list. */
  configSessionCount?: ((username: string) => number) | undefined;
};

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Accounts created through the app (as opposed to the config file), their one-time access links, and
 * their persistent sign-ins.
 *
 * State is held in memory and written through to a 0600 JSON file after every change (temp file +
 * rename, serialized), so it works while the vault is locked and survives restarts. Only hashes are
 * stored: argon2id for passwords, sha256 for link tokens and session ids (those are 256-bit random,
 * so a fast hash is enough). A file that cannot be read is never overwritten or partly used: the
 * managed side is refused and the reason reported, while config-defined users keep working.
 */
export default class UserService {
  private state: StoreState = { users: [], accessLinks: [], sessions: [] };
  private corrupt: string | null = null;
  private loaded = false;
  private filePath: string | undefined;
  private sessionTtlMs: number;
  private readonly configUsers: () => ConfigUsers;
  private readonly now: () => number;
  private readonly report: (message: string) => void;
  private readonly configSessionCount: (username: string) => number;
  private queue: Promise<unknown> = Promise.resolve();
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly stamps = new Map<string, string>();
  private dummyHash: Promise<string> | null = null;

  constructor(options: UserServiceOptions = {}) {
    this.filePath = options.filePath;
    this.sessionTtlMs = (options.sessionDays ?? 7) * 24 * 60 * 60 * 1000;
    this.configUsers = options.configUsers ?? (() => ({}));
    this.now = options.now ?? (() => Date.now());
    this.report = options.report ?? (() => undefined);
    this.configSessionCount = options.configSessionCount ?? (() => 0);
  }

  /** Applies new settings from a config reload. A different file path reloads from that file. */
  async configure(options: { filePath?: string | undefined; sessionDays?: number | undefined }): Promise<void> {
    if (options.sessionDays !== undefined) this.sessionTtlMs = options.sessionDays * 24 * 60 * 60 * 1000;
    if (options.filePath !== this.filePath || !this.loaded) {
      await this.flush();
      this.filePath = options.filePath;
      await this.load();
    }
  }

  get persistent(): boolean {
    return this.filePath !== undefined;
  }

  /** Why managed accounts are unavailable, or null when the store is healthy. */
  get unavailableReason(): string | null {
    return this.corrupt;
  }

  async load(): Promise<void> {
    this.loaded = true;
    this.corrupt = null;
    this.state = { users: [], accessLinks: [], sessions: [] };
    this.stamps.clear();
    if (!this.filePath) return;
    let raw: string;
    try {
      raw = await fs.promises.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      this.markCorrupt(`cannot be read (${(error as NodeJS.ErrnoException).code ?? "error"})`);
      return;
    }
    try {
      const parsed = storeFileSchema.parse(JSON.parse(raw));
      const names = new Set<string>();
      for (const user of parsed.users) {
        const problem = usernameProblem(user.username);
        if (problem || names.has(user.username)) throw new Error("invalid or duplicate username");
        names.add(user.username);
      }
      this.state = { users: parsed.users, accessLinks: parsed.accessLinks, sessions: parsed.sessions };
    } catch {
      this.markCorrupt("is not valid (it may be damaged or written by a newer version)");
      return;
    }
    try {
      await fs.promises.chmod(this.filePath, 0o600);
    } catch {
      // Best effort: the file is created 0600 anyway.
    }
    if (this.prune()) this.dirty = true;
    const clash = this.state.users.filter(user => this.isConfigUser(user.username));
    if (clash.length > 0) {
      this.report(`These managed accounts share a name with a configured account and are disabled: ${clash.map(user => user.username).join(", ")}`);
    }
  }

  private markCorrupt(why: string): void {
    this.corrupt = `The user store ${this.filePath} ${why}. Managed accounts, access links and saved sign-ins are disabled and the file is left untouched; accounts from the configuration still work. Fix or move the file, then restart.`;
    this.report(this.corrupt);
  }

  // ---- lookups ---------------------------------------------------------------------------------

  private findConfigUser(username: string): { key: string; password: string; role: UserRole } | null {
    const users = this.configUsers();
    if (!Object.hasOwn(users, username)) return null;
    const entry = users[username];
    if (!entry) return null;
    return { key: username, password: entry.password, role: entry.role ?? "admin" };
  }

  private isConfigUser(username: string): boolean {
    const lowered = username.toLowerCase();
    return Object.keys(this.configUsers()).some(key => key.toLowerCase() === lowered);
  }

  private findManaged(username: string): StoredUser | undefined {
    if (this.corrupt) return undefined;
    const name = canonicalUsername(username);
    if (this.isConfigUser(name)) return undefined;
    return this.state.users.find(user => user.username === name);
  }

  roleOf(username: string | null | undefined): UserRole | null {
    if (!username) return null;
    const config = this.findConfigUser(username);
    if (config) return config.role;
    return this.findManaged(username)?.role ?? null;
  }

  sourceOf(username: string): "config" | "managed" | null {
    if (this.findConfigUser(username)) return "config";
    return this.findManaged(username) ? "managed" : null;
  }

  /** True when there is any account able to sign in. */
  hasAnyUsers(): boolean {
    return Object.keys(this.configUsers()).length > 0 || (!this.corrupt && this.state.users.length > 0);
  }

  stampOf(username: string): string | undefined {
    if (!this.findManaged(username)) return undefined;
    const name = canonicalUsername(username);
    let stamp = this.stamps.get(name);
    if (!stamp) {
      stamp = randomToken();
      this.stamps.set(name, stamp);
    }
    return stamp;
  }

  private bumpStamp(username: string): void {
    this.stamps.set(username, randomToken());
  }

  // ---- authentication --------------------------------------------------------------------------

  /** Checks a password against config users, then managed users. Null when it does not match. */
  async authenticate(username: string, password: string): Promise<AuthenticatedUser | null> {
    const config = this.findConfigUser(username);
    if (config) {
      if (!passwordMatches(password, config.password)) return null;
      return { username: config.key, role: config.role, source: "config", credential: config.password };
    }
    const user = this.findManaged(username);
    // An unknown name verifies against a dummy hash too, so timing does not reveal which names exist.
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    let ok: boolean;
    try {
      ok = await Bun.password.verify(password, hash);
    } catch {
      ok = false;
    }
    if (!user?.passwordHash || !ok) return null;
    user.lastLoginAt = this.now();
    this.markDirty();
    return { username: user.username, role: user.role, source: "managed", stamp: this.stampOf(user.username) as string };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= Bun.password.hash(randomToken(), { algorithm: "argon2id" });
    return this.dummyHash;
  }

  // ---- queue / persistence ---------------------------------------------------------------------

  /**
   * Runs `fn` alone, with all other mutations waiting, and writes the result to disk before returning.
   * If the write fails the in-memory state is rolled back, so memory and disk never disagree.
   */
  private mutate<T>(fn: () => { value: T; changed: boolean }): Promise<T> {
    const run = async (): Promise<T> => {
      this.requireAvailable();
      const snapshot = structuredClone(this.state);
      const stamps = new Map(this.stamps);
      let outcome: { value: T; changed: boolean };
      try {
        outcome = fn();
      } catch (error) {
        this.state = snapshot;
        throw error;
      }
      this.prune();
      if (outcome.changed || this.dirty) {
        try {
          await this.writeFile();
          this.dirty = false;
        } catch (error) {
          this.state = snapshot;
          this.stamps.clear();
          for (const [key, value] of stamps) this.stamps.set(key, value);
          this.report(`Could not save the user store: ${(error as NodeJS.ErrnoException).code ?? "write error"}`);
          throw new UserServiceError("unavailable", "The change could not be saved to disk, so it was not applied.");
        }
      }
      return outcome.value;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private requireAvailable(): void {
    if (this.corrupt) throw new UserServiceError("unavailable", this.corrupt);
  }

  private async writeFile(): Promise<void> {
    if (!this.filePath) return;
    const target = this.filePath;
    await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    const body = JSON.stringify({ version: 1, ...this.state }, null, 2);
    const handle = await fs.promises.open(temp, "wx", 0o600);
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.promises.rename(temp, target);
    } catch (error) {
      await fs.promises.rm(temp, { force: true });
      throw error;
    }
  }

  /** Marks state changed by something that does not need an immediate write (sliding expiry, last login). */
  private markDirty(): void {
    if (!this.persistent || this.corrupt) return;
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
    this.flushTimer.unref();
  }

  /** Writes pending lazy changes now. */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.dirty || this.corrupt || !this.persistent) return;
    await this.mutate(() => ({ value: undefined, changed: true })).catch(() => undefined);
  }

  /** Drops expired links and sessions. True when anything was removed. */
  private prune(): boolean {
    const now = this.now();
    const before = this.state.accessLinks.length + this.state.sessions.length;
    this.state.accessLinks = this.state.accessLinks.filter(link => (link.usedAt ? link.usedAt + USED_LINK_RETENTION_MS > now : link.expiresAt > now));
    const names = new Set(this.state.users.map(user => user.username));
    this.state.sessions = this.state.sessions.filter(session => session.expiresAt > now && names.has(session.username));
    return this.state.accessLinks.length + this.state.sessions.length !== before;
  }

  // ---- users -----------------------------------------------------------------------------------

  private assertName(raw: string): string {
    const username = canonicalUsername(raw);
    const problem = usernameProblem(username);
    if (problem) throw new UserServiceError("invalid", problem);
    return username;
  }

  private assertPassword(password: string): void {
    if (password.length < MIN_PASSWORD_LENGTH) throw new UserServiceError("invalid", `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password.length > MAX_PASSWORD_LENGTH) throw new UserServiceError("invalid", `Passwords may be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }

  private assertEditable(username: string): StoredUser {
    if (this.isConfigUser(username)) {
      throw new UserServiceError("readOnly", "This account is defined in the configuration file and cannot be changed here.");
    }
    const user = this.state.users.find(candidate => candidate.username === canonicalUsername(username));
    if (!user) throw new UserServiceError("notFound", "No such user.");
    return user;
  }

  private adminCount(): number {
    const config = Object.keys(this.configUsers()).filter(name => this.findConfigUser(name)?.role === "admin").length;
    return config + this.state.users.filter(user => user.role === "admin" && !this.isConfigUser(user.username)).length;
  }

  clampLinkMinutes(minutes: number | undefined): number {
    const value = minutes ?? DEFAULT_LINK_MINUTES;
    if (!Number.isFinite(value) || value < MIN_LINK_MINUTES || value > MAX_LINK_MINUTES) {
      throw new UserServiceError("invalid", `Links must last between ${MIN_LINK_MINUTES} minutes and 7 days.`);
    }
    return Math.floor(value);
  }

  private newLink(username: string, ttlMinutes: number, createdBy: string | null): { link: StoredLink; token: string } {
    const token = randomToken();
    const now = this.now();
    const link: StoredLink = {
      id: randomBytes(9).toString("base64url"),
      username,
      tokenHash: sha256Hex(token),
      createdAt: now,
      expiresAt: now + ttlMinutes * 60_000,
      createdBy,
    };
    this.state.accessLinks.push(link);
    return { link, token };
  }

  async createUser(input: {
    username: string;
    role: UserRole;
    password?: string | undefined;
    link?: { ttlMinutes: number } | undefined;
    createdBy: string | null;
  }): Promise<{ user: UserSummary; link?: { id: string; token: string; expiresAt: number } }> {
    const username = this.assertName(input.username);
    if (input.password !== undefined) this.assertPassword(input.password);
    const passwordHash = input.password === undefined ? undefined : await Bun.password.hash(input.password, { algorithm: "argon2id" });
    return this.mutate(() => {
      if (this.isConfigUser(username) || this.state.users.some(user => user.username === username)) {
        throw new UserServiceError("exists", "That username is already taken.");
      }
      const user: StoredUser = {
        username,
        role: input.role,
        ...(passwordHash ? { passwordHash } : {}),
        createdAt: this.now(),
        createdBy: input.createdBy,
        lastLoginAt: null,
      };
      this.state.users.push(user);
      const created = input.link ? this.newLink(username, input.link.ttlMinutes, input.createdBy) : undefined;
      return {
        value: {
          user: this.summarize(user),
          ...(created ? { link: { id: created.link.id, token: created.token, expiresAt: created.link.expiresAt } } : {}),
        },
        changed: true,
      };
    });
  }

  async setPassword(username: string, password: string): Promise<void> {
    this.assertPassword(password);
    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    await this.mutate(() => {
      const user = this.assertEditable(username);
      user.passwordHash = passwordHash;
      this.dropSessions(user.username);
      this.bumpStamp(user.username);
      return { value: undefined, changed: true };
    });
  }

  async setRole(username: string, role: UserRole): Promise<void> {
    await this.mutate(() => {
      const user = this.assertEditable(username);
      if (user.role === role) return { value: undefined, changed: false };
      if (user.role === "admin" && role !== "admin" && this.adminCount() <= 1) {
        throw new UserServiceError("forbidden", "This is the last administrator. Make someone else an administrator first.");
      }
      user.role = role;
      this.dropSessions(user.username);
      this.bumpStamp(user.username);
      return { value: undefined, changed: true };
    });
  }

  async removeUser(username: string): Promise<void> {
    await this.mutate(() => {
      const user = this.assertEditable(username);
      if (user.role === "admin" && this.adminCount() <= 1) {
        throw new UserServiceError("forbidden", "This is the last administrator and cannot be removed.");
      }
      this.state.users = this.state.users.filter(candidate => candidate !== user);
      this.state.accessLinks = this.state.accessLinks.filter(link => link.username !== user.username);
      this.dropSessions(user.username);
      this.stamps.delete(user.username);
      return { value: undefined, changed: true };
    });
  }

  /** Ends every sign-in of a managed user, open sockets included. Config users are handled by the web host. */
  async signOutUser(username: string): Promise<void> {
    await this.mutate(() => {
      const user = this.state.users.find(candidate => candidate.username === canonicalUsername(username));
      if (!user) return { value: undefined, changed: false };
      this.dropSessions(user.username);
      this.bumpStamp(user.username);
      return { value: undefined, changed: true };
    });
  }

  private dropSessions(username: string): void {
    this.state.sessions = this.state.sessions.filter(session => session.username !== username);
  }

  // ---- listings --------------------------------------------------------------------------------

  private summarize(user: StoredUser): UserSummary {
    return {
      username: user.username,
      role: user.role,
      source: "managed",
      hasPassword: user.passwordHash !== undefined,
      createdAt: user.createdAt,
      createdBy: user.createdBy,
      lastLoginAt: user.lastLoginAt,
      activeSessions: this.state.sessions.filter(session => session.username === user.username && session.expiresAt > this.now()).length,
      pendingAccessLinks: this.pendingLinks(user.username).length,
    };
  }

  private pendingLinks(username: string): StoredLink[] {
    const now = this.now();
    return this.state.accessLinks.filter(link => link.username === username && !link.usedAt && link.expiresAt > now);
  }

  listUsers(): UserSummary[] {
    const config: UserSummary[] = Object.keys(this.configUsers()).flatMap(name => {
      const entry = this.findConfigUser(name);
      if (!entry) return [];
      return [
        {
          username: name,
          role: entry.role,
          source: "config" as const,
          hasPassword: true,
          createdAt: null,
          createdBy: null,
          lastLoginAt: null,
          activeSessions: this.configSessionCount(name),
          pendingAccessLinks: this.pendingLinks(name).length,
        },
      ];
    });
    const managed = this.corrupt ? [] : this.state.users.filter(user => !this.isConfigUser(user.username)).map(user => this.summarize(user));
    return [...config, ...managed];
  }

  listAccessLinks(): AccessLinkSummary[] {
    const names = new Set(this.listUsers().map(user => user.username));
    return this.state.accessLinks
      .filter(link => !link.usedAt && link.expiresAt > this.now() && names.has(link.username))
      .map(({ id, username, createdAt, expiresAt, createdBy }) => ({ id, username, createdAt, expiresAt, createdBy }));
  }

  // ---- access links ----------------------------------------------------------------------------

  /** The token is returned once and only its hash is kept. */
  async createAccessLink(input: {
    username: string;
    ttlMinutes: number;
    createdBy: string | null;
  }): Promise<{ id: string; token: string; expiresAt: number; username: string }> {
    return this.mutate(() => {
      const config = this.findConfigUser(input.username);
      const managed = config ? undefined : this.findManaged(input.username);
      const username = config?.key ?? managed?.username;
      if (!username) throw new UserServiceError("notFound", "No such user.");
      const { link, token } = this.newLink(username, input.ttlMinutes, input.createdBy);
      return { value: { id: link.id, token, expiresAt: link.expiresAt, username }, changed: true };
    });
  }

  async revokeAccessLink(id: string): Promise<boolean> {
    return this.mutate(() => {
      const before = this.state.accessLinks.length;
      this.state.accessLinks = this.state.accessLinks.filter(link => link.id !== id);
      const removed = this.state.accessLinks.length !== before;
      return { value: removed, changed: removed };
    });
  }

  /**
   * Trades a link token for a sign-in. Single use is enforced inside the serialized mutation, so two
   * simultaneous redemptions of one token cannot both succeed. Null for anything wrong (unknown,
   * expired, used, malformed): the caller cannot and must not distinguish them.
   */
  async redeemAccessLink(token: string, userAgent?: string): Promise<RedeemedLink | null> {
    if (typeof token !== "string" || !ACCESS_TOKEN_PATTERN.test(token) || this.corrupt) return null;
    const presented = createHash("sha256").update(token).digest();
    try {
      return await this.mutate<RedeemedLink | null>(() => {
        const now = this.now();
        // Compared against every link, in constant time each, so timing says nothing about which one is close.
        let match: StoredLink | undefined;
        for (const link of this.state.accessLinks) {
          if (timingSafeEqual(presented, Buffer.from(link.tokenHash, "hex"))) match = link;
        }
        if (!match || match.usedAt || match.expiresAt <= now) return { value: null, changed: false };

        const config = this.findConfigUser(match.username);
        const managed = config ? undefined : this.findManaged(match.username);
        if (!config && !managed) return { value: null, changed: false };

        match.usedAt = now;
        if (config) {
          return { value: { username: config.key, role: config.role, source: "config" as const, credential: config.password }, changed: true };
        }
        const user = managed as StoredUser;
        user.lastLoginAt = now;
        const sessionId = this.addSession(user.username, userAgent);
        return { value: { username: user.username, role: user.role, source: "managed" as const, sessionId }, changed: true };
      });
    } catch {
      // A failed write has already rolled the link back to unused; the caller shows a generic failure.
      return null;
    }
  }

  // ---- sessions --------------------------------------------------------------------------------

  private addSession(username: string, userAgent?: string): string {
    const sessionId = randomToken();
    const now = this.now();
    const mine = this.state.sessions.filter(session => session.username === username).sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_SESSIONS_PER_USER + 1))) {
      this.state.sessions = this.state.sessions.filter(session => session !== old);
    }
    this.state.sessions.push({
      sessionIdHash: sha256Hex(sessionId),
      username,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
      lastSeenAt: now,
      ...(userAgent ? { userAgent: userAgent.slice(0, 200) } : {}),
    });
    return sessionId;
  }

  /** Creates a persisted sign-in for a managed user who just proved their password. */
  async createSession(username: string, userAgent?: string): Promise<string> {
    return this.mutate(() => {
      const user = this.findManaged(username);
      if (!user) throw new UserServiceError("notFound", "No such user.");
      return { value: this.addSession(user.username, userAgent), changed: true };
    });
  }

  /** The username behind a session id, extending its life. Null when unknown, expired or revoked. */
  resolveSession(sessionId: string | undefined): string | null {
    if (!sessionId || this.corrupt || sessionId.length > 128) return null;
    const hash = sha256Hex(sessionId);
    const session = this.state.sessions.find(candidate => candidate.sessionIdHash === hash);
    if (!session) return null;
    const now = this.now();
    if (session.expiresAt <= now || !this.findManaged(session.username)) {
      return null;
    }
    // Sliding expiry. Written lazily: losing a few minutes of renewal in a crash is harmless.
    session.lastSeenAt = now;
    session.expiresAt = now + this.sessionTtlMs;
    this.markDirty();
    return session.username;
  }

  async revokeSession(sessionId: string | undefined): Promise<void> {
    if (!sessionId || this.corrupt) return;
    const hash = sha256Hex(sessionId);
    if (!this.state.sessions.some(session => session.sessionIdHash === hash)) return;
    await this.mutate(() => {
      this.state.sessions = this.state.sessions.filter(session => session.sessionIdHash !== hash);
      return { value: undefined, changed: true };
    });
  }

  get sessionCount(): number {
    return this.state.sessions.length;
  }
}
