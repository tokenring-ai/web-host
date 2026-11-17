import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { LoginRateLimiter, setPeerAddressResolver } from "./util/authSecurity.ts";

const request = (forwardedFor?: string) => new Request("http://host/", forwardedFor ? { headers: { "X-Forwarded-For": forwardedFor } } : {});

afterEach(() => {
  setPeerAddressResolver(() => undefined);
  setSystemTime();
});

describe("LoginRateLimiter.clientIpFromRequest", () => {
  it("throttles a remote client by its socket address, whatever X-Forwarded-For it sends", () => {
    setPeerAddressResolver(() => "192.168.1.50");
    expect(LoginRateLimiter.clientIpFromRequest(request("10.0.0.1"))).toBe("192.168.1.50");
    expect(LoginRateLimiter.clientIpFromRequest(request("10.0.0.2"))).toBe("192.168.1.50");
  });

  it("believes X-Forwarded-For only from a reverse proxy on this machine", () => {
    setPeerAddressResolver(() => "127.0.0.1");
    expect(LoginRateLimiter.clientIpFromRequest(request("203.0.113.9, 127.0.0.1"))).toBe("203.0.113.9");
    expect(LoginRateLimiter.clientIpFromRequest(request())).toBe("127.0.0.1");
    setPeerAddressResolver(() => "::1");
    expect(LoginRateLimiter.clientIpFromRequest(request("203.0.113.9"))).toBe("203.0.113.9");
  });
});

describe("LoginRateLimiter memory", () => {
  it("forgets failures too old to count once the table is large", () => {
    const limiter = new LoginRateLimiter();
    setSystemTime(new Date("2026-01-01T00:00:00Z"));
    for (let index = 0; index < 5000; index++) limiter.recordFailure(`old-${index}|user`);
    setSystemTime(new Date("2026-01-02T00:00:00Z"));
    limiter.recordFailure("new|user");
    expect((limiter as unknown as { failures: Map<string, unknown> }).failures.size).toBe(1);
  });
});
