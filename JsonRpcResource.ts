import TokenRingApp from "@tokenring-ai/app";
import {FastifyInstance} from "fastify";
import {JsonRpcEndpoint} from "./jsonrpc/types.ts";
import {WebResource} from "./types.ts";

export default class JsonRpcResource implements WebResource {
  name = "JsonRpcResource";

  constructor(private app: TokenRingApp, private jsonRpcEndpoint: JsonRpcEndpoint) {}

  async register(server: FastifyInstance): Promise<void> {
    server.post(this.jsonRpcEndpoint.path, async (request, reply) => {
      const response = await this.handle(request.body);
      reply.send(response);
    });
  }

  async handle(request: any): Promise<any> {
    const {jsonrpc, id, method, params = []} = request;

    if (jsonrpc !== "2.0") {
      return {jsonrpc: "2.0", id, error: {code: -32600, message: "Invalid Request"}};
    }

    const handler = this.jsonRpcEndpoint.methods[method];
    if (!handler) {
      return {jsonrpc: "2.0", id, error: {code: -32601, message: "Method not found"}};
    }

    try {
      const validatedParams = handler.inputSchema.parse(params);
      const result = await handler.execute(validatedParams, this.app);
      const validatedResult = handler.resultSchema.parse(result);
      return {jsonrpc: "2.0", id, result: validatedResult};
    } catch (error: any) {
      return {jsonrpc: "2.0", id, error: {code: -32603, message: error.message}};
    }
  }
}
