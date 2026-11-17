import type TokenRingApp from "@tokenring-ai/app";
import { RpcService } from "@tokenring-ai/rpc";
import type { RpcMethod } from "@tokenring-ai/rpc/types";
import formatError from "@tokenring-ai/utility/error/formatError";
import { z } from "zod";
import { isAdminOnlyMethod } from "./adminOnlyMethods.ts";
import type { BunWebSocket, WebResource, WebRpcCallContext, WebSocketHandler } from "./types.ts";
import UserService, { type ConfigUsers } from "./UserService.ts";
import { LoginRateLimiter, loginRateLimiter } from "./util/authSecurity.ts";

const jsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);

const jsonBodySchema = z.object({
  jsonrpc: z.string(),
  id: jsonRpcIdSchema.exactOptional(),
  method: z.string(),
  params: z.unknown().exactOptional(),
});

const jsonBodyIdSchema = z.object({
  id: jsonRpcIdSchema,
});

/**
 * Credentials are optional: a socket whose handshake carried a valid session
 * cookie is already authenticated, and its client calls `auth` with no params
 * purely to learn who it is signed in as.
 */
/**
 * `rpc.cancel` (a notification): the client stopped reading stream `id`, so the server stops
 * producing it. Without this a stream ran until the whole socket closed, and every remounted
 * view left one behind.
 */
const cancelParamsSchema = z.object({ id: jsonRpcIdSchema });

const authParamsSchema = z.object({
  username: z.string().exactOptional(),
  password: z.string().exactOptional(),
});

type WsData = {
  abortController: AbortController;
  authenticated: boolean;
  username: string | null;
  /** Username resolved from the session cookie during the upgrade, if any. */
  sessionUsername?: string | null;
  /** Whether that cookie session still holds; set by the web host at upgrade. */
  sessionValid?: () => boolean;
  /** For a socket signed in with a password: the stored password it matched, rechecked per message. */
  credential?: string;
  /** For a socket signed in with a managed user's password: their stamp, which changes on password/role change or sign-out. */
  stamp?: string;
  /** `scheme://host` of the page's request, for building links that work from the same place. */
  requestOrigin?: string;
  /** Client identity captured at upgrade, used as the login-throttle key component. */
  clientIp?: string;
  /** Running streams by request id, so `rpc.cancel` can stop one. */
  streams?: Map<string | number | null, AbortController>;
};

/** The part of the auth config this resource needs: the configured users. */
type AuthUsers = { users: ConfigUsers };

export default class WsRpcResource implements WebResource {
  wsRoutes: Record<string, WebSocketHandler>;

  constructor(
    private app: TokenRingApp,
    private jsonRpcEndpoint: string,
    /** A getter reads the current users, so a password change or removal applies without a restart. */
    private auth: AuthUsers | (() => AuthUsers),
    /** Managed accounts and roles. Without it only the config users exist (all administrators unless a role says otherwise). */
    private users?: UserService,
  ) {
    this.wsRoutes = {
      [this.jsonRpcEndpoint]: this.handler(),
    };
  }

  handler() {
    const rpcService = this.app.requireService(RpcService);
    const currentAuth = () => (typeof this.auth === "function" ? this.auth() : this.auth);
    const users = this.users ?? new UserService({ configUsers: () => currentAuth().users });
    const stillAuthorized = (data: WsData): boolean => {
      if (data.username === null) return false;
      if (data.credential !== undefined) {
        const configured = currentAuth().users;
        return Object.hasOwn(configured, data.username) && configured[data.username]?.password === data.credential;
      }
      if (data.stamp !== undefined) return users.stampOf(data.username) === data.stamp;
      return data.sessionValid ? data.sessionValid() : true;
    };

    return {
      open: (ws: BunWebSocket) => {
        // `ws.data` is the per-connection context created at upgrade and shared
        // by every later callback, so this mutates it rather than replacing it.
        const data = ws.data as WsData;
        const sessionUsername = data.sessionUsername ?? null;
        data.authenticated = sessionUsername !== null;
        data.username = sessionUsername;
      },

      close: (ws: BunWebSocket) => {
        (ws.data as WsData | undefined)?.abortController.abort();
      },

      message: async (ws: BunWebSocket, message: string | Buffer) => {
        const messageStr = typeof message === "string" ? message : message.toString();
        const wsData = ws.data as WsData;

        let data: unknown;
        try {
          data = JSON.parse(messageStr);
        } catch {
          // Not valid JSON at all — per JSON-RPC 2.0 spec, id must be null here.
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "Parse error" },
            }),
          );
          return;
        }

        // Best-effort extraction of the id so we can echo it back on any later
        // error, even if the rest of the request fails schema validation.
        const idResult = jsonBodyIdSchema.safeParse(data);
        const id = idResult.success ? idResult.data.id : null;
        // JSON-RPC 2.0: a Request object without an `id` member is a Notification.
        // After a valid parse the server MUST NOT reply (including later errors).
        const isNotification = typeof data === "object" && data !== null && !("id" in data);

        let parsed: z.infer<typeof jsonBodySchema>;
        try {
          parsed = jsonBodySchema.parse(data);
        } catch (error) {
          // Not a well-formed Request/Notification — still report Invalid/Internal error.
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              error: { code: -32603, message: formatError(error) },
            }),
          );
          return;
        }

        const send = (payload: object) => {
          if (!isNotification) {
            ws.send(JSON.stringify(payload));
          }
        };

        try {
          const { jsonrpc, method: methodName, params } = parsed;
          const rpcParams = params ?? {};

          if (jsonrpc !== "2.0") {
            send({
              jsonrpc: "2.0",
              id,
              error: { code: -32600, message: "Invalid Request" },
            });
            return;
          }

          if (methodName === "rpc.cancel") {
            const parsedCancel = cancelParamsSchema.safeParse(rpcParams);
            if (parsedCancel.success) wsData.streams?.get(parsedCancel.data.id)?.abort();
            return;
          }

          // Login over the WebSocket: either username/password, or nothing at
          // all when the handshake's session cookie already authenticated us.
          if (methodName === "auth") {
            const { username, password } = authParamsSchema.parse(rpcParams);

            if (username === undefined || password === undefined) {
              if (wsData.authenticated && wsData.username && stillAuthorized(wsData)) {
                send({ jsonrpc: "2.0", id, result: { authenticated: true, username: wsData.username, role: users.roleOf(wsData.username) } });
                return;
              }
              send({
                jsonrpc: "2.0",
                id,
                error: { code: -32001, message: "No active session. Sign in with a username and password." },
              });
              return;
            }

            const throttleKey = LoginRateLimiter.keyFor(ws.data.clientIp, username);
            const retryAfterSeconds = loginRateLimiter.isBlocked(throttleKey);
            if (retryAfterSeconds > 0) {
              wsData.authenticated = false;
              wsData.username = null;
              send({
                jsonrpc: "2.0",
                id,
                error: {
                  code: -32001,
                  message: `Too many failed login attempts. Try again in ${retryAfterSeconds} seconds.`,
                },
              });
              return;
            }
            const authenticated = await users.authenticate(username, password);
            if (!authenticated) {
              loginRateLimiter.recordFailure(throttleKey);
              wsData.authenticated = false;
              wsData.username = null;
              send({
                jsonrpc: "2.0",
                id,
                error: { code: -32001, message: "Invalid username or password" },
              });
              return;
            }

            loginRateLimiter.recordSuccess(throttleKey);
            wsData.authenticated = true;
            wsData.username = authenticated.username;
            delete wsData.credential;
            delete wsData.stamp;
            if (authenticated.credential !== undefined) wsData.credential = authenticated.credential;
            if (authenticated.stamp !== undefined) wsData.stamp = authenticated.stamp;
            send({
              jsonrpc: "2.0",
              id,
              result: { authenticated: true, username: authenticated.username, role: authenticated.role },
            });
            return;
          }

          if (wsData.authenticated && !stillAuthorized(wsData)) {
            // Signed out elsewhere, removed from the config, or the password changed.
            wsData.authenticated = false;
            wsData.username = null;
            delete wsData.credential;
            delete wsData.stamp;
            send({ jsonrpc: "2.0", id, error: { code: -32001, message: "Your session has ended. Sign in again." } });
            return;
          }

          if (!wsData.authenticated) {
            send({
              jsonrpc: "2.0",
              id,
              error: { code: -32001, message: "Unauthorized. Call auth with username and password first." },
            });
            return;
          }

          // Central, explicit gate: members never reach an administrator-only method, whatever the plugin does.
          if (isAdminOnlyMethod(methodName) && users.roleOf(wsData.username) !== "admin") {
            send({ jsonrpc: "2.0", id, error: { code: -32003, message: "Administrator access required." } });
            return;
          }

          const method = rpcService.getMethod(methodName);

          if (!method) {
            send({
              jsonrpc: "2.0",
              id,
              error: { code: -32601, message: "Method not found" },
            });
            return;
          }

          const validatedParams = method.inputSchema.parse(rpcParams) as unknown;
          const context: WebRpcCallContext = {
            username: wsData.username,
            ...(wsData.requestOrigin ? { requestOrigin: wsData.requestOrigin } : {}),
          };

          if (method.type === "stream") {
            // Each stream stops on its own `rpc.cancel`, or with the socket.
            const streamController = new AbortController();
            const signal = AbortSignal.any([wsData.abortController.signal, streamController.signal]);
            wsData.streams ??= new Map();
            wsData.streams.set(id, streamController);
            try {
              const result = (method as RpcMethod<any, any, "stream">).execute(validatedParams, this.app, signal, context);
              for await (const event of result) {
                if (signal.aborted) break;
                const validatedEvent = method.resultSchema.parse(event) as unknown;
                send({ jsonrpc: "2.0", id, result: validatedEvent });
              }
              // A cancelled stream has no reader left to tell.
              if (!signal.aborted) send({ jsonrpc: "2.0", id, result: null, stream: "end" });
            } catch (error) {
              if (!signal.aborted) {
                send({
                  jsonrpc: "2.0",
                  id,
                  error: { code: -32603, message: formatError(error) },
                });
              }
              // Don't close the socket — a single stream failure must not kill
              // other pending requests/streams on this connection.
            } finally {
              if (wsData.streams.get(id) === streamController) wsData.streams.delete(id);
            }
            return;
          }

          const result = (await (method as RpcMethod<any, any, "query" | "mutation">).execute(validatedParams, this.app, context)) as unknown;
          const validatedResult = method.resultSchema.parse(result) as unknown;
          send({ jsonrpc: "2.0", id, result: validatedResult });
        } catch (error) {
          send({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: formatError(error) },
          });
        }
      },
    };
  }
}
