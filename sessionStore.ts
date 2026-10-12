import type { ParsedWebHostAuthConfig } from "./schema.ts";
import { passwordMatches } from "./util/authSecurity.ts";

/** Cookie carrying the RPC session. HttpOnly, so page scripts can never read it. */
export const SESSION_COOKIE = "tokenring_session";

/** How long a session stays valid without use. Refreshed on every successful resolve. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Session = { username: string; expiresAt: number };

/**
 * In-memory store of logged-in sessions, keyed by an opaque random id that is
 * handed to the browser in an HttpOnly cookie.
 *
 * The point of this indirection is that the browser never has to keep the
 * user's password: it holds a revocable, expiring id that page scripts cannot
 * read, and the server maps that id back to a username. Sessions live only in
 * this process, so a server restart signs everyone out.
 */
export default class SessionStore {
  private readonly sessions = new Map<string, Session>();

  /** Issues a session id for an already-authenticated username. */
  create(username: string): string {
    this.purgeExpired();
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, { username, expiresAt: Date.now() + SESSION_TTL_MS });
    return sessionId;
  }

  /** Returns the username behind a session id, extending its life. Null when unknown or expired. */
  resolve(sessionId: string | undefined): string | null {
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    // Sliding expiration: an active tab keeps its session alive.
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return session.username;
  }

  revoke(sessionId: string | undefined): void {
    if (sessionId) this.sessions.delete(sessionId);
  }

  /** Drops every session for a user, e.g. when their password changes. */
  revokeUser(username: string): void {
    for (const [id, session] of this.sessions) {
      if (session.username === username) this.sessions.delete(id);
    }
  }

  get size(): number {
    return this.sessions.size;
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }
}

/** Reads one cookie out of a `Cookie` header. */
export function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return rest.join("=");
  }
  return undefined;
}

export function parseBasicCredentials(header: string | null): { username: string; password: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice("Basic ".length).trim());
    const colon = decoded.indexOf(":");
    if (colon < 0) return null;
    return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
  } catch {
    return null;
  }
}

export function credentialsValid(auth: ParsedWebHostAuthConfig, username: string, password: string): boolean {
  const stored = auth.users[username]?.password;
  return stored !== undefined && passwordMatches(password, stored);
}

/**
 * `SameSite=Lax` keeps the cookie off cross-site requests, including the
 * WebSocket handshake, so another origin cannot ride on the session. `Secure`
 * is added over TLS; it must stay off for plain-http localhost or the browser
 * drops the cookie entirely.
 */
export function sessionCookieHeader(sessionId: string, maxAgeSeconds: number, secure: boolean): string {
  const attributes = [`${SESSION_COOKIE}=${sessionId}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

/** Expiry-dated cookie that clears the session on the client. */
export function clearedSessionCookieHeader(secure: boolean): string {
  return sessionCookieHeader("", 0, secure);
}

/** True when the request arrived over TLS, directly or via a terminating proxy. */
export function isSecureRequest(request: Request): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}
