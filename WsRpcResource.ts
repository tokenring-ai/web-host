import TokenRingApp from "@tokenring-ai/app";
import {RpcEndpoint, RpcMethod} from "@tokenring-ai/rpc/types";
import pickValue from "@tokenring-ai/utility/object/pickValue";
import {FastifyInstance} from "fastify";
import type {WebSocket} from "ws";
import {z} from "zod";
import {WebResource} from "./types.ts";

const jsonBodySchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  method: z.string(),
  params: z.unknown().optional()
});

export default class WsRpcResource implements WebResource {
  constructor(private app: TokenRingApp, private jsonRpcEndpoint: RpcEndpoint) {
  }

  async register(server: FastifyInstance): Promise<void> {
    server.get(this.jsonRpcEndpoint.path, {websocket: true}, (socket: WebSocket, req) => {
      socket.on('message', async (message: any) => {
        try {
          const data = JSON.parse(message.toString());
          const {jsonrpc, id, method, params = []} = jsonBodySchema.parse(data);

          if (jsonrpc !== "2.0") {
            socket.send(JSON.stringify({jsonrpc: "2.0", id, error: {code: -32600, message: "Invalid Request"}}));
            return;
          }

          const handler = pickValue(this.jsonRpcEndpoint.methods, method)
          if (!handler) {
            socket.send(JSON.stringify({jsonrpc: "2.0", id, error: {code: -32601, message: "Method not found"}}));
            return;
          }

          const validatedParams = handler.inputSchema.parse(params);

          if (handler.type === "stream") {
            const abortController = new AbortController();
            const cleanup = () => abortController.abort();
            socket.on('close', cleanup);

            try {
              const result = handler.execute(validatedParams, this.app, abortController.signal) as AsyncGenerator<any>;
              for await (const event of result) {
                socket.send(JSON.stringify({jsonrpc: "2.0", id, result: event}));
              }
              socket.send(JSON.stringify({jsonrpc: "2.0", id, result: null, stream: "end"}));
            } catch (error: any) {
              abortController.abort();
              socket.send(JSON.stringify({jsonrpc: "2.0", id, error: {code: -32603, message: error.message}}));
            } finally {
              socket.off('close', cleanup);
            }
            return;
          }

          const result = await (handler as RpcMethod<any, any, "query" | "mutation">).execute(validatedParams, this.app);
          const validatedResult = handler.resultSchema.parse(result);
          socket.send(JSON.stringify({jsonrpc: "2.0", id, result: validatedResult}));

        } catch (error: any) {
          socket.send(JSON.stringify({jsonrpc: "2.0", id: null, error: {code: -32603, message: error.message}}));
        }
      });
    });
  }
}
