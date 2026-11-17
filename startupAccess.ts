import type os from "node:os";
import { accessLinkUrl, isLoopbackHost, listenUrls } from "./remoteAccess.ts";
import { renderTerminalQr } from "./terminalQr.ts";
import type UserService from "./UserService.ts";

export const STARTUP_LINK_MINUTES = 10;

export type StartupAccessInput = {
  users: UserService;
  host: string;
  port: number;
  tls: boolean;
  /** Configured public URL (no trailing slash), or null. */
  publicUrl: string | null;
  isTTY: boolean;
  write: (text: string) => void;
  interfaces?: ReturnType<typeof os.networkInterfaces>;
};

/**
 * The text printed at startup, or null when nothing should be printed. Kept separate from printing so it
 * can be tested without a terminal.
 */
export async function buildStartupAccessBanner(input: StartupAccessInput): Promise<string | null> {
  // Credentials never go to logs, files or pipes: only an interactive terminal gets the link.
  if (!input.isTTY) return null;

  const reachable = input.publicUrl
    ? [input.publicUrl]
    : isLoopbackHost(input.host)
      ? []
      : listenUrls({ host: input.host, port: input.port, tls: input.tls, ...(input.interfaces ? { interfaces: input.interfaces } : {}) });
  if (reachable.length === 0) return null;

  const admin = input.users.listUsers().find(user => user.role === "admin");
  if (!admin) return null;

  let link: Awaited<ReturnType<UserService["createAccessLink"]>>;
  try {
    link = await input.users.createAccessLink({ username: admin.username, ttlMinutes: STARTUP_LINK_MINUTES, createdBy: "startup" });
  } catch {
    return null;
  }

  const primary = reachable[0] as string;
  const url = accessLinkUrl(primary, link.token);
  const insecure = reachable.some(candidate => candidate.startsWith("http:"));
  const lines = [
    "",
    "Remote access",
    ...reachable.map(candidate => `  ${candidate}`),
    "",
    `One-time admin sign-in link (valid ${STARTUP_LINK_MINUTES} minutes, works once):`,
    `  ${url}`,
    "",
    renderTerminalQr(url)
      .split("\n")
      .map(line => `  ${line}`)
      .join("\n"),
    "",
    `Warning: this link signs in as "${admin.username}" (administrator). Do not share it${insecure ? "; http is not encrypted, so only use it on a network you trust" : ""}.`,
    ...(reachable.length > 1 ? ["If the first address does not work from your phone, replace it in the link with another address from the list."] : []),
    "",
  ];
  return lines.join("\n");
}

/** Prints the banner to the terminal (never through the app logger, which may be written to files). */
export async function printStartupAccessBanner(input: StartupAccessInput): Promise<boolean> {
  const banner = await buildStartupAccessBanner(input);
  if (!banner) return false;
  input.write(`${banner}\n`);
  return true;
}
