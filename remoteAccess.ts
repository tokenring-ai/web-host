import os from "node:os";

/** True for hostnames/addresses that only this machine can reach. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || host.startsWith("127.") || host === "::ffff:127.0.0.1";
}

/** True when a server bound to `host` accepts connections on every interface. */
export function isWildcardHost(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, "");
  return value === "" || value === "0.0.0.0" || value === "::" || value === "::0";
}

export type InterfaceMap = ReturnType<typeof os.networkInterfaces>;

/**
 * The addresses other devices on the network can use to reach a server listening on `host:port`.
 * A wildcard bind lists every non-internal IPv4 address; a loopback bind returns its own loopback URL
 * (callers flag it as unreachable from phones).
 */
export function listenUrls(options: { host: string; port: number; tls: boolean; interfaces?: InterfaceMap }): string[] {
  const scheme = options.tls ? "https" : "http";
  if (isWildcardHost(options.host)) {
    const interfaces = options.interfaces ?? os.networkInterfaces();
    const urls: string[] = [];
    for (const addresses of Object.values(interfaces)) {
      for (const address of addresses ?? []) {
        // `family` is the string "IPv4" on current runtimes and the number 4 on older ones.
        if (!address.internal && String(address.family).replace("IPv", "") === "4") urls.push(`${scheme}://${address.address}:${options.port}`);
      }
    }
    return urls;
  }
  const host = options.host.includes(":") && !options.host.startsWith("[") ? `[${options.host}]` : options.host;
  return [`${scheme}://${host}:${options.port}`];
}

/** `http://host` style origin for a URL string, or null if it is not one. */
export function describeBaseUrl(baseUrl: string): { isLoopback: boolean; isHttps: boolean } {
  try {
    const url = new URL(baseUrl);
    return { isLoopback: isLoopbackHost(url.hostname), isHttps: url.protocol === "https:" };
  } catch {
    return { isLoopback: false, isHttps: false };
  }
}

export function accessLinkUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/#access=${token}`;
}
