import type TokenRingApp from "@tokenring-ai/app";
import { RpcService } from "@tokenring-ai/rpc";
import type { RpcMethod } from "@tokenring-ai/rpc/types";
import formatError from "@tokenring-ai/utility/error/formatError";
import { z } from "zod";
import type { ParsedWebHostAuthConfig } from "./schema.ts";
import type { BunWebSocket, WebResource, WebSocketHandler } from "./types.ts";

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

const authParamsSchema = z.object({
  username: z.string(),
  password: z.string(),
});

type WsData = {
  abortController: AbortController;
  authenticated: boolean;
  username: string | null;
};

export default class WsRpcResource implements WebResource {
  wsRoutes: Record<string, WebSocketHandler>;

  constructor(
    private app: TokenRingApp,
    private jsonRpcEndpoint: string,
    private auth: ParsedWebHostAuthConfig,
  ) {
    this.wsRoutes = {
      [this.jsonRpcEndpoint]: this.handler(),
    };
  }

  handler() {
    const rpcService = this.app.requireService(RpcService);
    const authConfig = this.auth;

    return {
      open: (ws: BunWebSocket) => {
        const data: WsData = {
          abortController: new AbortController(),
          authenticated: false,
          username: null,
        };
        ws.data = data;
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

          // Username/password login over the WebSocket session (required).
          if (methodName === "auth") {
            const { username, password } = authParamsSchema.parse(rpcParams);
            if (authConfig.users[username]?.password !== password) {
              wsData.authenticated = false;
              wsData.username = null;
              send({
                jsonrpc: "2.0",
                id,
                error: { code: -32001, message: "Invalid username or password" },
              });
              return;
            }

            wsData.authenticated = true;
            wsData.username = username;
            send({
              jsonrpc: "2.0",
              id,
              result: { authenticated: true, username },
            });
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

          if (method.type === "stream") {
            try {
              const result = method.execute(validatedParams, this.app, wsData.abortController.signal) as AsyncGenerator<unknown>;
              for await (const event of result) {
                const validatedEvent = method.resultSchema.parse(event) as unknown;
                send({ jsonrpc: "2.0", id, result: validatedEvent });
              }
              send({
                jsonrpc: "2.0",
                id,
                result: null,
                stream: "end",
              });
            } catch (error) {
              send({
                jsonrpc: "2.0",
                id,
                error: { code: -32603, message: formatError(error) },
              });
              // Don't close the socket — a single stream failure must not kill
              // other pending requests/streams on this connection.
            }
            return;
          }

          const result = (await (method as RpcMethod<any, any, "query" | "mutation">).execute(validatedParams, this.app)) as unknown;
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
