import TokenRingApp from "@tokenring-ai/app";
import {RpcEndpoint, RpcMethod} from "@tokenring-ai/rpc/types";
import pickValue from "@tokenring-ai/utility/object/pickValue";
import {z} from "zod";
import {type BunRouter, type BunWebSocket, type WebResource} from "./types.ts";

const jsonBodySchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  method: z.string(),
  params: z.unknown().optional()
});

export default class WsRpcResource implements WebResource {
  constructor(private app: TokenRingApp, private jsonRpcEndpoint: RpcEndpoint) {}

  async register(router: BunRouter): Promise<void> {
    router.ws(this.jsonRpcEndpoint.path, {
      open: (ws: BunWebSocket) => {
        ws.data = {
          abortController: new AbortController(),
          path: this.jsonRpcEndpoint.path
        };
      },

      close: (ws: BunWebSocket) => {
        ws.data.abortController?.abort();
      },

      message: async (ws: BunWebSocket, message: string | Buffer) => {
        let requestId: string | number | null = null;
        try {
          const messageStr = typeof message === 'string' ? message : message.toString();
          const data = JSON.parse(messageStr);
          requestId = data.id ?? null;

          const {jsonrpc, id, method, params = []} = jsonBodySchema.parse(data);

          if (jsonrpc !== "2.0") {
            ws.send(JSON.stringify({jsonrpc: "2.0", id, error: {code: -32600, message: "Invalid Request"}}));
            return;
          }

          const handler = pickValue(this.jsonRpcEndpoint.methods, method);
          if (!handler) {
            ws.send(JSON.stringify({jsonrpc: "2.0", id, error: {code: -32601, message: "Method not found"}}));
            return;
          }

          const validatedParams = handler.inputSchema.parse(params);

          if (handler.type === "stream") {
            try {
              const result = handler.execute(validatedParams, this.app, ws.data.abortController.signal) as AsyncGenerator<any>;
              for await (const event of result) {
                ws.send(JSON.stringify({jsonrpc: "2.0", id, result: event}));
              }
              ws.send(JSON.stringify({jsonrpc: "2.0", id, result: null, stream: "end"}));
            } catch (error: any) {
              ws.send(JSON.stringify({jsonrpc: "2.0", id, error: {code: -32603, message: error.message}}));
              ws.close();
            }
            return;
          }

          const result = await (handler as RpcMethod<any, any, "query" | "mutation">).execute(validatedParams, this.app);
          const validatedResult = handler.resultSchema.parse(result);
          ws.send(JSON.stringify({jsonrpc: "2.0", id, result: validatedResult}));
        } catch (error: any) {
          ws.send(JSON.stringify({jsonrpc: "2.0", id: requestId, error: {code: -32603, message: error.message}}));
        }
      }
    });
  }
}
