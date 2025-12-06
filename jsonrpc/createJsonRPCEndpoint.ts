import type {JsonRPCSchema, JsonRPCImplementation, JsonRpcEndpoint} from "./types.ts";

export function createJsonRPCEndpoint<T extends JsonRPCSchema>(schemas: T, implementation: JsonRPCImplementation<T>) {
  return {
    path: schemas.path,
    methods: Object.fromEntries(
      Object.entries(schemas.methods)
        .map(([name, method]) =>
          [name,
            {
              type: method.type,
              inputSchema: method.input,
              resultSchema: method.result,
              execute: implementation[name as keyof T["methods"]],
            }
          ]
        )
    )
  } satisfies JsonRpcEndpoint;
}