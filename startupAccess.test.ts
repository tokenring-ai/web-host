import { describe, expect, it } from "bun:test";
import type { InterfaceMap } from "./remoteAccess.ts";
import { isLoopbackHost, isWildcardHost, listenUrls } from "./remoteAccess.ts";
import { buildStartupAccessBanner, printStartupAccessBanner, STARTUP_LINK_MINUTES } from "./startupAccess.ts";
import UserService from "./UserService.ts";

const interfaces = {
  lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  en0: [
    { address: "192.168.1.20", family: "IPv4", internal: false },
    { address: "fe80::1", family: "IPv6", internal: false },
  ],
  utun1: [{ address: "10.8.0.2", family: "IPv4", internal: false }],
} as unknown as InterfaceMap;

async function users() {
  const svc = new UserService({ configUsers: () => ({ root: { password: "rootpass1", role: "admin" }, helper: { password: "helperpass", role: "member" } }) });
  await svc.load();
  return svc;
}

const base = { port: 4321, tls: false, publicUrl: null, isTTY: true, write: () => undefined, interfaces };

describe("remote address helpers", () => {
  it("recognizes loopback and wildcard hosts", () => {
    for (const host of ["127.0.0.1", "localhost", "::1", "[::1]", "127.5.5.5"]) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ["192.168.1.2", "example.com", "0.0.0.0"]) expect(isLoopbackHost(host)).toBe(false);
    for (const host of ["0.0.0.0", "::", ""]) expect(isWildcardHost(host)).toBe(true);
    expect(isWildcardHost("192.168.1.2")).toBe(false);
  });

  it("lists every non-internal IPv4 address with the real port and scheme for a wildcard bind", () => {
    expect(listenUrls({ host: "0.0.0.0", port: 4321, tls: false, interfaces })).toEqual(["http://192.168.1.20:4321", "http://10.8.0.2:4321"]);
    expect(listenUrls({ host: "0.0.0.0", port: 4321, tls: true, interfaces })[0]).toStartWith("https://");
    expect(listenUrls({ host: "192.168.1.9", port: 80, tls: false })).toEqual(["http://192.168.1.9:80"]);
    expect(listenUrls({ host: "::1", port: 80, tls: false })).toEqual(["http://[::1]:80"]);
  });
});

describe("startup access banner", () => {
  it("prints nothing, and creates no link, when stdout is not a terminal", async () => {
    const svc = await users();
    expect(await buildStartupAccessBanner({ ...base, users: svc, host: "0.0.0.0", isTTY: false })).toBeNull();
    expect(svc.listAccessLinks()).toHaveLength(0);
  });

  it("prints nothing for a loopback bind without a public URL, even on a terminal", async () => {
    const svc = await users();
    expect(await buildStartupAccessBanner({ ...base, users: svc, host: "127.0.0.1" })).toBeNull();
    expect(svc.listAccessLinks()).toHaveLength(0);
  });

  it("prints addresses, a 10-minute admin link, a QR code and the warnings for a network bind", async () => {
    const svc = await users();
    const banner = (await buildStartupAccessBanner({ ...base, users: svc, host: "0.0.0.0" })) as string;

    expect(banner).toContain("http://192.168.1.20:4321");
    expect(banner).toContain("http://10.8.0.2:4321");
    expect(banner).toContain(`valid ${STARTUP_LINK_MINUTES} minutes`);
    const link = /http:\/\/192\.168\.1\.20:4321\/#access=([A-Za-z0-9_-]{43})/.exec(banner);
    expect(link).not.toBeNull();
    expect(banner).toContain("▀");
    expect(banner).toContain('signs in as "root" (administrator)');
    expect(banner).toContain("http is not encrypted");

    // The link is the real, working, single-use admin key and lasts 10 minutes.
    const [pending] = svc.listAccessLinks();
    expect(pending?.username).toBe("root");
    expect(pending?.createdBy).toBe("startup");
    expect((pending?.expiresAt ?? 0) - (pending?.createdAt ?? 0)).toBe(STARTUP_LINK_MINUTES * 60_000);
    expect((await svc.redeemAccessLink(link?.[1] as string))?.role).toBe("admin");
  });

  it("uses the public URL, and omits the http warning for https", async () => {
    const svc = await users();
    const banner = (await buildStartupAccessBanner({ ...base, users: svc, host: "127.0.0.1", publicUrl: "https://tokenring.example.com" })) as string;
    expect(banner).toContain("https://tokenring.example.com/#access=");
    expect(banner).not.toContain("http is not encrypted");
  });

  it("writes through the supplied writer only, and reports whether it printed", async () => {
    const svc = await users();
    const written: string[] = [];
    expect(await printStartupAccessBanner({ ...base, users: svc, host: "0.0.0.0", write: text => void written.push(text) })).toBe(true);
    expect(written.join("")).toContain("#access=");
    expect(await printStartupAccessBanner({ ...base, users: svc, host: "0.0.0.0", isTTY: false, write: text => void written.push(text) })).toBe(false);
  });

  it("prints nothing when there is no administrator to sign in as", async () => {
    const svc = new UserService({ configUsers: () => ({ helper: { password: "helperpass", role: "member" } }) });
    await svc.load();
    expect(await buildStartupAccessBanner({ ...base, users: svc, host: "0.0.0.0" })).toBeNull();
  });
});
