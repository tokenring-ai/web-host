import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for credentials. Both sides are hashed
 * first so the comparison never leaks the stored password's length, only
 * whether the two inputs are equal.
 */
export function timingSafeStringsEqual(attempted: string, stored: string): boolean {
  const attemptedDigest = createHash("sha256").update(attempted).digest();
  const storedDigest = createHash("sha256").update(stored).digest();
  return timingSafeEqual(attemptedDigest, storedDigest);
}

/**
 * True when `attempted` matches `stored`. Stored passwords may be plaintext
 * (back-compat) or a `sha256:<hex digest>` digest produced with `hashPassword`,
 * which keeps the raw password out of the config file.
 */
export function passwordMatches(attempted: string, stored: string): boolean {
  if (stored.startsWith("sha256:")) {
    const expected = stored.slice("sha256:".length).trim().toLowerCase();
    const actual = createHash("sha256").update(attempted).digest("hex");
    return actual.length === expected.length && timingSafeStringsEqual(actual, expected);
  }
  return timingSafeStringsEqual(attempted, stored);
}

/** Formats a plaintext password as a `sha256:<hex digest>` for storage in config. */
export function hashPassword(password: string): string {
  return `sha256:${createHash("sha256").update(password).digest("hex")}`;
}

const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_WINDOW = 10;

type FailureRecord = {
  count: number;
  firstFailureAt: number;
  /** 0 while not blocked; otherwise the epoch ms until which the key is locked out. */
  blockedUntil: number;
};

let peerAddressOf: (request: Request) => string | undefined = () => undefined;

/** Set by the web host once it listens: how to read a request's socket peer address. */
export function setPeerAddressResolver(resolver: (request: Request) => string | undefined): void {
  peerAddressOf = resolver;
}

function isLoopback(address: string): boolean {
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}

/**
 * In-memory login throttle shared by every password check (web-host session
 * route, the WS RPC `auth` method, the filesystem HTTP resource). Keys pair a
 * client identity with the attempted username; after too many failures inside
 * the window the key is locked out until the window expires. Successful
 * logins clear the record.
 */
export class LoginRateLimiter {
  private readonly failures = new Map<string, FailureRecord>();

  /** Seconds remaining in an active lockout for `key`, or 0 when not blocked. */
  isBlocked(key: string): number {
    const record = this.failures.get(key);
    if (!record) return 0;
    if (record.blockedUntil > Date.now()) {
      return Math.ceil((record.blockedUntil - Date.now()) / 1000);
    }
    if (record.blockedUntil > 0) {
      this.failures.delete(key);
    }
    return 0;
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const record = this.failures.get(key);
    if (!record || (record.blockedUntil > 0 && record.blockedUntil <= now) || now - record.firstFailureAt > FAILURE_WINDOW_MS) {
      this.failures.set(key, { count: 1, firstFailureAt: now, blockedUntil: 0 });
      this.purge();
      return;
    }
    record.count += 1;
    if (record.count >= MAX_FAILURES_PER_WINDOW) {
      record.blockedUntil = now + FAILURE_WINDOW_MS;
    }
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }

  /** Clears all failure state (used by tests and administrative unlock). */
  reset(): void {
    this.failures.clear();
  }

  /** Throttle key combining the client identity with the attempted username. */
  static keyFor(clientIp: string | undefined, username: string): string {
    return `${clientIp ?? "unknown"}|${username.toLowerCase()}`;
  }

  /**
   * The client's address for throttling: the socket's peer address. X-Forwarded-For is only
   * believed when the peer is loopback, i.e. a reverse proxy on this machine; from anyone else it
   * is a header the client chose, and trusting it would let them pick a fresh throttle key per try.
   */
  static clientIpFromRequest(request: Request): string | undefined {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
    const peer = peerAddressOf(request);
    if (peer === undefined) return forwarded;
    return isLoopback(peer) && forwarded ? forwarded : peer;
  }

  private purge(): void {
    if (this.failures.size < 5000) return;
    const now = Date.now();
    for (const [key, record] of this.failures) {
      // Expired lockouts, and failures too old to count towards one.
      if (record.blockedUntil <= now && (record.blockedUntil > 0 || now - record.firstFailureAt > FAILURE_WINDOW_MS)) this.failures.delete(key);
    }
  }
}

/** Process-wide limiter so lockouts apply across all auth surfaces at once. */
export const loginRateLimiter = new LoginRateLimiter();
