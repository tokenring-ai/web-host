import { describe, expect, it } from "bun:test";
import SessionStore, {
  clearedSessionCookieHeader,
  credentialsValid,
  isSecureRequest,
  parseBasicCredentials,
  parseCookie,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionCookieHeader,
} from "./sessionStore.ts";

const authConfig = { users: { mark: { password: "correct horse" } } };

describe("SessionStore", () => {
  it("resolves a created session back to its username", () => {
    const store = new SessionStore();
    const id = store.create("mark");
    expect(id).not.toHaveLength(0);
    expect(store.resolve(id)).toBe("mark");
  });

  it("issues a distinct id per session", () => {
    const store = new SessionStore();
    expect(store.create("mark")).not.toBe(store.create("mark"));
  });

  it("returns null for unknown, empty, and revoked ids", () => {
    const store = new SessionStore();
    const id = store.create("mark");
    expect(store.resolve("nope")).toBeNull();
    expect(store.resolve(undefined)).toBeNull();
    store.revoke(id);
    expect(store.resolve(id)).toBeNull();
  });

  it("expires a session once its lifetime has passed, and forgets it", () => {
    const store = new SessionStore();
    const realNow = Date.now;
    const id = store.create("mark");
    try {
      Date.now = () => realNow() + SESSION_TTL_MS + 1;
      expect(store.resolve(id)).toBeNull();
    } finally {
      Date.now = realNow;
    }
    expect(store.size).toBe(0);
  });

  it("slides the expiry forward on each use, so an active tab stays signed in", () => {
    const store = new SessionStore();
    const realNow = Date.now;
    const id = store.create("mark");
    try {
      // Just before expiry: still valid, and the clock restarts.
      Date.now = () => realNow() + SESSION_TTL_MS - 1000;
      expect(store.resolve(id)).toBe("mark");
      // Beyond the ORIGINAL deadline, but within a fresh one.
      Date.now = () => realNow() + SESSION_TTL_MS + 1000;
      expect(store.resolve(id)).toBe("mark");
    } finally {
      Date.now = realNow;
    }
  });

  it("revokes every session belonging to one user and leaves others alone", () => {
    const store = new SessionStore();
    const markA = store.create("mark");
    const markB = store.create("mark");
    const other = store.create("someone-else");

    store.revokeUser("mark");

    expect(store.resolve(markA)).toBeNull();
    expect(store.resolve(markB)).toBeNull();
    expect(store.resolve(other)).toBe("someone-else");
  });
});

describe("cookie helpers", () => {
  it("marks the cookie HttpOnly and SameSite=Lax so scripts and other origins cannot use it", () => {
    const header = sessionCookieHeader("abc", 60, false);
    expect(header).toContain(`${SESSION_COOKIE}=abc`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=60");
    expect(header).toContain("Path=/");
  });

  it("omits Secure on plain http, because the browser would drop the cookie on localhost", () => {
    expect(sessionCookieHeader("abc", 60, false)).not.toContain("Secure");
    expect(sessionCookieHeader("abc", 60, true)).toContain("Secure");
  });

  it("clears the cookie with an immediate expiry", () => {
    expect(clearedSessionCookieHeader(false)).toContain("Max-Age=0");
  });

  it("reads one cookie out of a header containing several", () => {
    expect(parseCookie(`other=1; ${SESSION_COOKIE}=wanted; third=3`, SESSION_COOKIE)).toBe("wanted");
    expect(parseCookie("other=1", SESSION_COOKIE)).toBeUndefined();
    expect(parseCookie(null, SESSION_COOKIE)).toBeUndefined();
  });

  it("keeps base64 padding in a cookie value intact", () => {
    expect(parseCookie(`${SESSION_COOKIE}=YWJjZA==`, SESSION_COOKIE)).toBe("YWJjZA==");
  });
});

describe("basic credentials", () => {
  it("decodes a well-formed header", () => {
    const header = `Basic ${btoa("mark:correct horse")}`;
    expect(parseBasicCredentials(header)).toEqual({ username: "mark", password: "correct horse" });
  });

  it("keeps colons that belong to the password", () => {
    const header = `Basic ${btoa("mark:a:b:c")}`;
    expect(parseBasicCredentials(header)?.password).toBe("a:b:c");
  });

  it("rejects missing, non-basic, and malformed headers", () => {
    expect(parseBasicCredentials(null)).toBeNull();
    expect(parseBasicCredentials("Bearer token")).toBeNull();
    expect(parseBasicCredentials("Basic !!!not base64!!!")).toBeNull();
    expect(parseBasicCredentials(`Basic ${btoa("no-colon")}`)).toBeNull();
  });

  it("validates against the configured users only", () => {
    expect(credentialsValid(authConfig, "mark", "correct horse")).toBe(true);
    expect(credentialsValid(authConfig, "mark", "wrong")).toBe(false);
    expect(credentialsValid(authConfig, "ghost", "correct horse")).toBe(false);
  });
});

describe("isSecureRequest", () => {
  it("detects https directly and behind a terminating proxy", () => {
    expect(isSecureRequest(new Request("https://example.com/x"))).toBe(true);
    expect(isSecureRequest(new Request("http://example.com/x"))).toBe(false);
    expect(isSecureRequest(new Request("http://example.com/x", { headers: { "x-forwarded-proto": "https" } }))).toBe(true);
    expect(isSecureRequest(new Request("http://example.com/x", { headers: { "x-forwarded-proto": "https, http" } }))).toBe(true);
    expect(isSecureRequest(new Request("http://example.com/x", { headers: { "x-forwarded-proto": "http" } }))).toBe(false);
  });
});
