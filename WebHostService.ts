import type TokenRingApp from "@tokenring-ai/app";
import type { TokenRingService } from "@tokenring-ai/app/types";
import { ConfigurationError } from "@tokenring-ai/app/types";
import EnhancedStringMap from "@tokenring-ai/utility/map/enhancedStringMap";

import deepEqual from "@tokenring-ai/utility/object/deepEqual";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import type { Serve } from "bun";
import { type ParsedWebHostConfig, type WebHostConfig, WebHostConfigSchema } from "./schema.ts";
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
import { buildTlsOptions } from "./tls.ts";
import type { BunWebSocket, WebResource, WebSocketHandler } from "./types.ts";
import { LoginRateLimiter, loginRateLimiter } from "./util/authSecurity.ts";

type Context = {
  path: string;
  abortController: AbortController;
  /** Client identity captured at upgrade for login throttling in the WS auth handler. */
  clientIp?: string | undefined;
  /** Username resolved from the session cookie at handshake, if any. */
  sessionUsername?: string | null;
};

/** Endpoint that trades a password for a session cookie, and revokes it again. */
const AUTH_SESSION_ROUTE = "/api/auth/session";

export default class WebHostService implements TokenRingService {
  readonly name = "WebHostService";
  description = "Bun web host for serving resources and APIs";
  resources = new KeyedRegistry<WebResource>();
  registerResource = this.resources.set;
  getResourceEntries = this.resources.entriesArray;

  private server: Bun.Server<unknown> | null = null;
  private config: ParsedWebHostConfig | undefined;
  /** Live WebSocket connections for keepalive ping. */
  private activeSockets = new Set<Bun.ServerWebSocket<Context>>();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  /** Logged-in sessions, shared by the cookie endpoint and the WebSocket handshake. */
  private readonly sessions = new SessionStore();

  constructor(
    private app: TokenRingApp,
    config?: WebHostConfig | ParsedWebHostConfig,
  ) {
    if (config) this.config = WebHostConfigSchema.parse(config);
  }

  getAuthConfig(): ParsedWebHostConfig["auth"] {
    return this.requireConfig().auth;
  }

  /**
   * The username behind the request's sign-in session cookie, or null. Lets
   * other HTTP resources (e.g. `/api/fs` media) accept the same sign-in as the
   * RPC socket, so one sign-out revokes access everywhere.
   */
  resolveSessionUsername(request: Request): string | null {
    return this.sessions.resolve(parseCookie(request.headers.get("Cookie"), SESSION_COOKIE));
  }

  async listen() {
    const config = this.requireConfig();

    const routes: Serve.RoutesWithUpgrade<Context, string> = {};
    const wsRoutes = new EnhancedStringMap<WebSocketHandler>();

    // Register all resources
    for (const resource of this.resources.valuesArray()) {
      if ("routes" in resource) {
        Object.assign(routes, resource.routes);
      } else if ("wsRoutes" in resource) {
        wsRoutes.insertAll(Object.entries(resource.wsRoutes));
      }
    }

    // Registered after resources so a catch-all static route cannot shadow it.
    Object.assign(routes, this.buildAuthSessionRoutes());

    // Build Bun.serve fetch handler
    const fetchHandler = this.buildFetchHandler(wsRoutes);

    // Build WebSocket handlers (includes keepalive open/close bookkeeping)
    const websocketHandlers = this.buildWebSocketHandlers(wsRoutes, config);

    const tlsOptions = buildTlsOptions(config.tls);

    if (this.server) {
      // Only fetch, error, routes, and websocket can be updated.
      this.server.reload({
        routes,
        fetch: fetchHandler,
        websocket: websocketHandlers,
      });
    } else {
      // Start Bun server
      this.server = Bun.serve({
        routes,
        port: config.port,
        hostname: config.host,
        fetch: fetchHandler,
        websocket: websocketHandlers,
        ...(tlsOptions ? { tls: tlsOptions } : {}),
        development: {
          hmr: false,
        },
      });

      this.app.serviceOutput(this, `Web Host listening at ${this.getURL()}`);
    }

    this.startKeepalive(config);
  }

  async reconfigure(config: WebHostConfig | ParsedWebHostConfig) {
    const parsed = WebHostConfigSchema.parse(config);
    if (this.config && deepEqual(parsed, this.config)) return;

    this.config = parsed;

    // Only restart the server if it is already listening; first-time bind happens in plugin start.
    if (this.server) {
      await this.server.stop();
      this.server = null;
      this.stopKeepalive();
      this.activeSockets.clear();
      await this.listen();
    }
  }

  async stop() {
    this.stopKeepalive();
    this.activeSockets.clear();
    if (this.server) {
      await this.server.stop();
      this.server = null;
    }
  }

  getURL(): URL {
    if (!this.server) {
      throw new ConfigurationError(this.name, "Server not started");
    }

    // Bun always sets `url` on real servers; rebuild it from the bound host,
    // port, and TLS mode when a server object arrives without one (test mocks).
    const url = (this.server as { url?: URL }).url;
    if (url) return url;
    const scheme = this.requireConfig().tls?.enabled ? "https" : "http";
    return new URL(`${scheme}://${this.server.hostname}:${this.server.port}/`);
  }

  private requireConfig(): ParsedWebHostConfig {
    if (!this.config) {
      throw new ConfigurationError(this.name, "WebHostService is not configured");
    }
    return this.config;
  }

  private getKeepalive(config: ParsedWebHostConfig) {
    return config.websocket.keepalive;
  }

  private startKeepalive(config: ParsedWebHostConfig) {
    this.stopKeepalive();

    const keepalive = this.getKeepalive(config);
    if (!keepalive.enabled) return;

    this.keepaliveTimer = setInterval(() => {
      for (const ws of this.activeSockets) {
        try {
          // Protocol-level ping (RFC 6455). Clients / proxies that drop idle
          // sockets will see activity; Bun auto-handles pong replies via sendPings.
          ws.ping();
        } catch {
          // Socket may already be half-closed; cleanup happens in `close`.
        }
      }
    }, keepalive.interval);

    // Don't keep the process alive solely for keepalive ticks.
    this.keepaliveTimer.unref();
  }

  private stopKeepalive() {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  /**
   * `POST /api/auth/session` trades HTTP Basic credentials for an HttpOnly
   * session cookie; `DELETE` revokes it. The cookie is what lets a reloaded
   * page re-open its RPC socket without the user retyping a password, while
   * the password itself is never stored anywhere in the browser.
   */
  private buildAuthSessionRoutes(): Serve.RoutesWithUpgrade<Context, string> {
    const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

    return {
      [AUTH_SESSION_ROUTE]: async (request: Request): Promise<Response> => {
        const secure = isSecureRequest(request);

        if (request.method === "DELETE") {
          this.sessions.revoke(parseCookie(request.headers.get("Cookie"), SESSION_COOKIE));
          return new Response(null, {
            status: 204,
            headers: { "Cache-Control": "no-store", "Set-Cookie": clearedSessionCookieHeader(secure) },
          });
        }

        if (request.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, DELETE" } });
        }

        const auth = this.requireConfig().auth;
        if (Object.keys(auth.users).length === 0) {
          // Misconfiguration: refuse rather than hand out unauthenticated sessions.
          return new Response("Authentication is not configured", { status: 503, headers: { "Cache-Control": "no-store" } });
        }

        const basic = parseBasicCredentials(request.headers.get("Authorization"));
        const throttleKey = basic ? LoginRateLimiter.keyFor(LoginRateLimiter.clientIpFromRequest(request), basic.username) : null;
        if (throttleKey) {
          const retryAfterSeconds = loginRateLimiter.isBlocked(throttleKey);
          if (retryAfterSeconds > 0) {
            return new Response("Too many failed login attempts", {
              status: 429,
              headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" },
            });
          }
        }
        if (!basic || !credentialsValid(auth, basic.username, basic.password)) {
          if (throttleKey) loginRateLimiter.recordFailure(throttleKey);
          return new Response("Unauthorized", {
            status: 401,
            headers: { "WWW-Authenticate": 'Basic realm="TokenRing", charset="UTF-8"', "Cache-Control": "no-store" },
          });
        }
        if (throttleKey) loginRateLimiter.recordSuccess(throttleKey);

        const sessionId = this.sessions.create(basic.username);
        return new Response(JSON.stringify({ ok: true, username: basic.username }), {
          status: 200,
          headers: { ...noStore, "Set-Cookie": sessionCookieHeader(sessionId, Math.floor(SESSION_TTL_MS / 1000), secure) },
        });
      },
    };
  }

  private buildFetchHandler(wsRoutes: EnhancedStringMap<WebSocketHandler>) {
    return async (request: Request, server: Bun.Server<Context>): Promise<Response | undefined> => {
      const url = new URL(request.url);
      const path = url.pathname;

      // Check if this is a WebSocket upgrade request.
      // Auth for RPC is handled inside WsRpcResource (username/password over the socket).
      if (wsRoutes.has(path) && request.headers.get("upgrade") === "websocket") {
        // Browsers always send Origin on a WS handshake; reject cross-site
        // upgrades so a malicious page cannot ride a session cookie even if
        // cookie policy ever loosens. Non-browser clients omit Origin.
        const origin = request.headers.get("Origin");
        if (origin) {
          let sameOrigin: boolean;
          try {
            sameOrigin = new URL(origin).host === url.host;
          } catch {
            sameOrigin = false;
          }
          if (!sameOrigin) {
            return new Response("Cross-origin WebSocket upgrade rejected", { status: 403 });
          }
        }
        // Upgrade to WebSocket
        // A valid session cookie authenticates the socket before its first
        // message, so a reloaded page never has to send a password again.
        const sessionUsername = this.sessions.resolve(parseCookie(request.headers.get("Cookie"), SESSION_COOKIE));
        const success = server.upgrade(request, {
          data: {
            path,
            abortController: new AbortController(),
            sessionUsername,
            clientIp: LoginRateLimiter.clientIpFromRequest(request),
          },
        });

        // If upgrade fails, return error
        if (!success) {
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        // Return undefined to indicate WebSocket upgrade
        return undefined;
      }

      // 404 Not Found
      return new Response("Not Found", { status: 404 });
    };
  }

  private wrapSocket(ws: Bun.ServerWebSocket<Context>): BunWebSocket {
    return {
      send: (data: string | object) => {
        const message = typeof data === "string" ? data : JSON.stringify(data);
        ws.send(message);
      },
      close: () => ws.close(),
      ping: (data?: string | ArrayBufferView | ArrayBuffer) => {
        ws.ping(data as string | Bun.BufferSource | undefined);
      },
      pong: (data?: string | ArrayBufferView | ArrayBuffer) => {
        ws.pong(data as string | Bun.BufferSource | undefined);
      },
      data: ws.data,
    };
  }

  private buildWebSocketHandlers(wsRoutes: EnhancedStringMap<WebSocketHandler>, config: ParsedWebHostConfig) {
    const activeSockets = this.activeSockets;
    const wrapSocket = this.wrapSocket.bind(this);
    const keepalive = this.getKeepalive(config);

    // idleTimeout is in seconds. Give at least two missed pings before drop.
    const idleTimeoutSeconds = keepalive.enabled ? Math.max(120, Math.ceil((keepalive.interval * 3) / 1000)) : 120;

    return {
      // Bun auto-replies to client pings when sendPings is true.
      sendPings: keepalive.enabled,
      idleTimeout: idleTimeoutSeconds,

      open(ws: Bun.ServerWebSocket<Context>) {
        activeSockets.add(ws);
        const handler = wsRoutes.get(ws.data.path);
        if (handler?.open) {
          handler.open(wrapSocket(ws));
        }
      },

      close(ws: Bun.ServerWebSocket<Context>) {
        activeSockets.delete(ws);
        const handler = wsRoutes.get(ws.data.path);
        if (handler?.close) {
          handler.close(wrapSocket(ws));
        }
      },

      message(ws: Bun.ServerWebSocket<Context>, message: string | Buffer) {
        const handler = wsRoutes.get(ws.data.path);
        if (handler?.message) {
          void Promise.resolve(handler.message(wrapSocket(ws), message)).catch(err => {
            console.error("Unhandled error in WebSocket message handler:", err);
          });
        }
      },

      ping(ws: Bun.ServerWebSocket<Context>, data: Buffer) {
        const handler = wsRoutes.get(ws.data.path);
        if (handler?.ping) {
          handler.ping(wrapSocket(ws), data);
        }
      },

      pong(ws: Bun.ServerWebSocket<Context>, data: Buffer) {
        const handler = wsRoutes.get(ws.data.path);
        if (handler?.pong) {
          handler.pong(wrapSocket(ws), data);
        }
      },
    };
  }
}
