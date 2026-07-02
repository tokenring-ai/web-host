import type TokenRingApp from "@tokenring-ai/app";
import { RpcService } from "@tokenring-ai/rpc";
import type { RpcMethod } from "@tokenring-ai/rpc/types";
import errorAsString from "@tokenring-ai/utility/error/errorAsString";
import { z } from "zod";
import type { BunRouter, BunWebSocket, WebResource } from "./types.ts";

const jsonBodySchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  method: z.string(),
  params: z.unknown().exactOptional(),
});

export default class WsRpcResource implements WebResource {
  constructor(
    private app: TokenRingApp,
    private jsonRpcEndpoint: string,
  ) {
  }

  register(router: BunRouter) {
    const rpcService = this.app.requireService(RpcService);
    router.ws(this.jsonRpcEndpoint, {
      open: (ws: BunWebSocket) => {
        ws.data = {
          abortController: new AbortController(),
        };
      },

      close: (ws: BunWebSocket) => {
        ws.data.abortController?.abort();
      },

      message: async (ws: BunWebSocket, message: string | Buffer) => {
        let requestId: string | number | null = null;
        try {
          const messageStr = typeof message === "string" ? message : message.toString();
          const data = JSON.parse(messageStr);
          requestId = data.id ?? null;

          const { jsonrpc, id, method: methodName, params } = jsonBodySchema.parse(data);
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

          const validatedParams = method.inputSchema.parse(rpcParams);

          if (method.type === "stream") {
            try {
              const result = method.execute(validatedParams, this.app, ws.data.abortController.signal) as AsyncGenerator<any>;
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
                  error: { code: -32603, message: errorAsString(error) },
                }),
              );
              ws.close();
            }
            return;
          }

          const result = await (method as RpcMethod<any, any, "query" | "mutation">).execute(validatedParams, this.app);
          const validatedResult = method.resultSchema.parse(result);
          ws.send(JSON.stringify({ jsonrpc: "2.0", id, result: validatedResult }));
        } catch (error) {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: requestId,
              error: { code: -32603, message: errorAsString(error) },
            }),
          );
        }
      },
    });
  }
}
