import { randomBytes } from "node:crypto";
import type TokenRingApp from "@tokenring-ai/app";
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import type { RpcCallContext } from "@tokenring-ai/rpc/types";
import { accessLinkUrl, describeBaseUrl, listenUrls } from "../remoteAccess.ts";
import type UserService from "../UserService.ts";
import { MAX_LINK_MINUTES, MIN_LINK_MINUTES } from "../UserService.ts";
import WebHostService from "../WebHostService.ts";
import UsersRpcSchema from "./schema.ts";

type CallContext = RpcCallContext & { requestOrigin?: string };

/** Defense in depth: the WebSocket host already refuses members for these methods. */
function requireAdmin(app: TokenRingApp, context: CallContext | undefined): { webHost: WebHostService; users: UserService; actor: string } {
  const webHost = app.requireService(WebHostService);
  const username = context?.username ?? null;
  if (!username || webHost.users.roleOf(username) !== "admin") throw new Error("Administrator access required.");
  return { webHost, users: webHost.users, actor: username };
}

function requireSignedIn(app: TokenRingApp, context: CallContext | undefined): { webHost: WebHostService; users: UserService; actor: string } {
  const webHost = app.requireService(WebHostService);
  const username = context?.username ?? null;
  if (!username || !webHost.users.roleOf(username)) throw new Error("Not signed in.");
  return { webHost, users: webHost.users, actor: username };
}

function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

function remoteAccess(webHost: WebHostService, context: CallContext | undefined) {
  const configured = webHost.getConfiguredPublicUrl();
  let baseUrl: string;
  let baseUrlSource: "configured" | "request" | "derived";
  if (configured) {
    baseUrl = configured;
    baseUrlSource = "configured";
  } else if (context?.requestOrigin) {
    baseUrl = context.requestOrigin;
    baseUrlSource = "request";
  } else {
    baseUrl = listenUrls({ host: webHost.listenHost, port: webHost.listenPort, tls: webHost.usesTls })[0] ?? `http://localhost:${webHost.listenPort}`;
    baseUrlSource = "derived";
  }
  const { isLoopback, isHttps } = describeBaseUrl(baseUrl);
  const warnings: string[] = [];
  if (isLoopback) {
    warnings.push(
      "This address only works on this computer. A phone or another computer cannot open it. Open the app using this computer's network address, or set a public URL.",
    );
  }
  if (!isHttps) {
    warnings.push(
      "This address is not encrypted (http). Anyone on the same network could read a sign-in link or password in transit. Use https where you can.",
    );
  }
  if (!webHost.users.persistent) warnings.push("Accounts created here are kept in memory only and will be lost on restart.");
  return { baseUrl, baseUrlSource, isLoopback, isHttps, warnings, storeProblem: webHost.users.unavailableReason };
}

function issued(info: { baseUrl: string }, link: { id: string; token: string; expiresAt: number }) {
  return { id: link.id, url: accessLinkUrl(info.baseUrl, link.token), expiresAt: link.expiresAt };
}

function minutes(requested: number | undefined, fallback: number): number {
  const value = requested ?? fallback;
  return Math.min(MAX_LINK_MINUTES, Math.max(MIN_LINK_MINUTES, value));
}

export default createRPCEndpoint(UsersRpcSchema, {
  getMe(_args, app, context) {
    const { users, actor } = requireSignedIn(app, context);
    return { username: actor, role: users.roleOf(actor) ?? "member", source: users.sourceOf(actor) ?? "config" };
  },

  getRemoteAccessInfo(_args, app, context) {
    const { webHost } = requireAdmin(app, context);
    return remoteAccess(webHost, context);
  },

  listUsers(_args, app, context) {
    const { users } = requireAdmin(app, context);
    return { users: users.listUsers(), storeProblem: users.unavailableReason };
  },

  listAccessLinks(_args, app, context) {
    const { users } = requireAdmin(app, context);
    return { links: users.listAccessLinks() };
  },

  async createUser({ username, role, method, password, expiresInMinutes }, app, context) {
    const { webHost, users, actor } = requireAdmin(app, context);
    if (method === "accessLink") {
      const info = remoteAccess(webHost, context);
      const created = await users.createUser({
        username,
        role,
        link: { ttlMinutes: users.clampLinkMinutes(expiresInMinutes) },
        createdBy: actor,
      });
      return { user: created.user, ...(created.link ? { link: issued(info, created.link) } : {}) };
    }
    const chosen = password ?? generatePassword();
    const created = await users.createUser({ username, role, password: chosen, createdBy: actor });
    return { user: created.user, ...(password === undefined ? { generatedPassword: chosen } : {}) };
  },

  async createAccessLink({ username, expiresInMinutes }, app, context) {
    const { webHost, users, actor } = requireAdmin(app, context);
    const info = remoteAccess(webHost, context);
    const link = await users.createAccessLink({ username, ttlMinutes: users.clampLinkMinutes(expiresInMinutes), createdBy: actor });
    return issued(info, link);
  },

  async createMyAccessLink({ expiresInMinutes }, app, context) {
    const { webHost, users, actor } = requireSignedIn(app, context);
    const info = remoteAccess(webHost, context);
    const link = await users.createAccessLink({ username: actor, ttlMinutes: minutes(expiresInMinutes, MIN_LINK_MINUTES), createdBy: actor });
    return issued(info, link);
  },

  async setPassword({ username, password }, app, context) {
    const { users } = requireAdmin(app, context);
    const chosen = password ?? generatePassword();
    await users.setPassword(username, chosen);
    return password === undefined ? { generatedPassword: chosen } : {};
  },

  async setRole({ username, role }, app, context) {
    const { users } = requireAdmin(app, context);
    await users.setRole(username, role);
    return { ok: true as const };
  },

  async signOutUser({ username }, app, context) {
    const { webHost, users } = requireAdmin(app, context);
    if (!users.sourceOf(username)) throw new Error("No such user.");
    await webHost.signOutUser(username);
    return { ok: true as const };
  },

  async removeUser({ username }, app, context) {
    const { users } = requireAdmin(app, context);
    await users.removeUser(username);
    return { ok: true as const };
  },

  async revokeAccessLink({ id }, app, context) {
    const { users } = requireAdmin(app, context);
    return { revoked: await users.revokeAccessLink(id) };
  },
});
