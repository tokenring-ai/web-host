import TokenRingApp from "@tokenring-ai/app";
import pickValue from "@tokenring-ai/utility/object/pickValue";
import {FastifyInstance} from "fastify";
import {z} from "zod";
import {JsonRpcEndpoint, JsonRpcMethod} from "./jsonrpc/types.ts";
import {WebResource} from "./types.ts";

const jsonBodySchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  method: z.string(),
  params: z.unknown().optional()
});

export default class JsonRpcResource implements WebResource {
  constructor(private app: TokenRingApp, private jsonRpcEndpoint: JsonRpcEndpoint) {}

  async register(server: FastifyInstance): Promise<void> {
    server.post(this.jsonRpcEndpoint.path, async (request, reply) => {
      const {jsonrpc, id, method, params = []} = jsonBodySchema.parse(request.body);

      if (jsonrpc !== "2.0") {
        return reply.send({jsonrpc: "2.0", id, error: {code: -32600, message: "Invalid Request"}});
      }

      const handler = pickValue(this.jsonRpcEndpoint.methods, method)
      if (!handler) {
        return reply.send({jsonrpc: "2.0", id, error: {code: -32601, message: "Method not found"}});
      }

      try {
        const validatedParams = handler.inputSchema.parse(params);

        if (handler.type === "stream") {
          return this.handleStream(id, handler, validatedParams, reply);
        }
        const result = (handler as JsonRpcMethod<any, any, "query" | "mutation">).execute(validatedParams, this.app);

        const validatedResult = handler.resultSchema.parse(await result);
        return reply.send({jsonrpc: "2.0", id, result: validatedResult});
      } catch (error: any) {
        return reply.send({jsonrpc: "2.0", id, error: {code: -32603, message: error.message}});
      }
    });
  }

  private async handleStream(id: number, handler: JsonRpcMethod<any, any, "stream">, validatedParams: any, reply: any): Promise<void> {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const abortController = new AbortController();

    try {
      const result = handler.execute(validatedParams, this.app, abortController.signal) as AsyncGenerator<any>;
      for await (const event of result) {
        reply.raw.write(`data: ${JSON.stringify({jsonrpc: "2.0", id, result: event})}\n\n`);
      }
      reply.raw.end();
    } catch (error: any) {
      abortController.abort();
      reply.raw.write(`data: ${JSON.stringify({jsonrpc: "2.0", id, error: {code: -32603, message: error.message}})}\n\n`);
      reply.raw.end();
    }
  }

}
