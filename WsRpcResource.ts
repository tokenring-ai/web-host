import type TokenRingApp from "@tokenring-ai/app";
import { RpcService } from "@tokenring-ai/rpc";
import type { RpcMethod } from "@tokenring-ai/rpc/types";
import formatError from "@tokenring-ai/utility/error/formatError";
import { z } from "zod";
import type { ParsedWebHostAuthConfig } from "./schema.ts";
import type { BunWebSocket, WebResource, WebSocketHandler } from "./types.ts";

const jsonBodySchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  method: z.string(),
  params: z.unknown().exactOptional(),
});

const jsonBodyIdSchema = z.object({
  id: z.number(),
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

        try {
          const { jsonrpc, method: methodName, params } = jsonBodySchema.parse(data);
          const rpcParams = params ?? {};

          if (jsonrpc !== "2.0") {
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: { code: -32600, message: "Invalid Request" },
              }),
            );
            return;
          }

          // Username/password login over the WebSocket session (required).
          if (methodName === "auth") {
            const { username, password } = authParamsSchema.parse(rpcParams);
            if (authConfig.users[username]?.password !== password) {
              wsData.authenticated = false;
              wsData.username = null;
              ws.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  error: { code: -32001, message: "Invalid username or password" },
                }),
              );
              return;
            }

            wsData.authenticated = true;
            wsData.username = username;
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                result: { authenticated: true, username },
              }),
            );
            return;
          }

          if (!wsData.authenticated) {
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: { code: -32001, message: "Unauthorized. Call auth with username and password first." },
              }),
            );
            return;
          }

          const method = rpcService.getMethod(methodName);

          if (!method) {
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: { code: -32601, message: "Method not found" },
              }),
            );
            return;
          }

          const validatedParams = method.inputSchema.parse(rpcParams) as unknown;

          if (method.type === "stream") {
            try {
              const result = method.execute(validatedParams, this.app, wsData.abortController.signal) as AsyncGenerator<unknown>;
              for await (const event of result) {
                ws.send(JSON.stringify({ jsonrpc: "2.0", id, result: event }));
              }
              ws.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  result: null,
                  stream: "end",
                }),
              );
            } catch (error) {
              ws.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  error: { code: -32603, message: formatError(error) },
                }),
              );
              ws.close();
            }
            return;
          }

          const result = (await (method as RpcMethod<any, any, "query" | "mutation">).execute(validatedParams, this.app)) as unknown;
          const validatedResult = method.resultSchema.parse(result) as unknown;
          ws.send(JSON.stringify({ jsonrpc: "2.0", id, result: validatedResult }));
        } catch (error) {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              error: { code: -32603, message: formatError(error) },
            }),
          );
        }
      },
    };
  }
}
