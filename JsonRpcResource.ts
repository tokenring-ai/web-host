import type TokenRingApp from "@tokenring-ai/app";
import type {RpcEndpoint, RpcMethod} from "@tokenring-ai/rpc/types";
import pickValue from "@tokenring-ai/utility/object/pickValue";
import {z} from "zod";
import type {BunRequest, BunResponse, BunRouter, WebResource} from "./types.ts";

const jsonBodySchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  method: z.string(),
  params: z.unknown().optional(),
});

export default class JsonRpcResource implements WebResource {
  constructor(
    private app: TokenRingApp,
    private jsonRpcEndpoint: RpcEndpoint,
  ) {
  }

  register(router: BunRouter) {
    router.post(
      this.jsonRpcEndpoint.path,
      async (request: BunRequest, response: BunResponse) => {
        try {
          const body = await request.json();
          const {
            jsonrpc,
            id,
            method,
            params = [],
          } = jsonBodySchema.parse(body);

          if (jsonrpc !== "2.0") {
            return response.json({
              jsonrpc: "2.0",
              id,
              error: {code: -32600, message: "Invalid Request"},
            });
          }

          const handler = pickValue(this.jsonRpcEndpoint.methods, method);
          if (!handler) {
            return response.json({
              jsonrpc: "2.0",
              id,
              error: {code: -32601, message: "Method not found"},
            });
          }

          try {
            const validatedParams = handler.inputSchema.parse(params);

            if (handler.type === "stream") {
              return this.handleStream(id, handler, validatedParams, response);
            }

            const result = (
              handler as RpcMethod<any, any, "query" | "mutation">
            ).execute(validatedParams, this.app);
            const validatedResult = handler.resultSchema.parse(await result);

            return response.json({
              jsonrpc: "2.0",
              id,
              result: validatedResult,
            });
          } catch (error: any) {
            return response.json({
              jsonrpc: "2.0",
              id,
              error: {code: -32603, message: error.message},
            });
          }
        } catch (error: any) {
          return response.json({
            jsonrpc: "2.0",
            id: null,
            error: {code: -32700, message: error.message},
          });
        }
      },
    );
  }

  private handleStream(
    id: number,
    handler: RpcMethod<any, any, "stream">,
    validatedParams: any,
    response: BunResponse,
  ): Response {
    return response.stream(async (controller) => {
      const abortController = new AbortController();

      try {
        const result = handler.execute(
          validatedParams,
          this.app,
          abortController.signal,
        ) as AsyncGenerator<any>;
        for await (const event of result) {
          const data = `data: ${JSON.stringify({jsonrpc: "2.0", id, result: event})}\n\n`;
          controller.enqueue(new TextEncoder().encode(data));
        }
        controller.close();
      } catch (error: any) {
        abortController.abort();
        const data = `data: ${JSON.stringify({jsonrpc: "2.0", id, error: {code: -32603, message: error.message}})}\n\n`;
        controller.enqueue(new TextEncoder().encode(data));
        controller.close();
      }
    });
  }
}
