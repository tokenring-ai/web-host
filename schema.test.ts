import { describe, expect, it } from "bun:test";
import { WebHostConfigSchema } from "./schema.ts";

const base = { host: "127.0.0.1", port: 0, auth: { users: { mark: { password: "pw" } } } };

describe("web host auth config", () => {
  it("defaults config users to administrators and sessions to 7 days, so existing configs keep working", () => {
    const parsed = WebHostConfigSchema.parse(base);
    expect(parsed.auth.users.mark?.role).toBe("admin");
    expect(parsed.auth.sessionDays).toBe(7);
    expect(parsed.printAccessLink).toBe(false);
    expect(parsed.publicUrl).toBeUndefined();
  });

  it("bounds sessionDays to 1..90", () => {
    for (const days of [0, 91, 1.5, -1]) expect(() => WebHostConfigSchema.parse({ ...base, auth: { ...base.auth, sessionDays: days } })).toThrow();
    expect(WebHostConfigSchema.parse({ ...base, auth: { ...base.auth, sessionDays: 90 } }).auth.sessionDays).toBe(90);
  });

  it("accepts only member or admin roles", () => {
    expect(() => WebHostConfigSchema.parse({ ...base, auth: { users: { x: { password: "pw", role: "root" } } } })).toThrow();
    expect(WebHostConfigSchema.parse({ ...base, auth: { users: { x: { password: "pw", role: "member" } } } }).auth.users.x?.role).toBe("member");
  });

  it("validates the public URL", () => {
    for (const bad of ["tokenring.example.com", "ftp://x.test", "https://u:p@x.test", "https://x.test/?a=1", "https://x.test/#frag", ""]) {
      expect(() => WebHostConfigSchema.parse({ ...base, publicUrl: bad }), bad).toThrow();
    }
    expect(WebHostConfigSchema.parse({ ...base, publicUrl: "https://x.test/tokenring" }).publicUrl).toBe("https://x.test/tokenring");
  });
});
