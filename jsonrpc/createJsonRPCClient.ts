import {z} from "zod";
import type {JsonRPCSchema} from "./types.ts";


export type ResultOfRPCCall<T extends JsonRPCSchema, K extends keyof T["methods"]> = z.infer<T["methods"][K]["result"]>;
export type ParamsOfRPCCall<T extends JsonRPCSchema, K extends keyof T["methods"]> = z.infer<T["methods"][K]["input"]>;
export type FunctionTypeOfRPCCall<T extends JsonRPCSchema, K extends keyof T["methods"]> = (params: ParamsOfRPCCall<T, K>) => Promise<ResultOfRPCCall<T, K>>;


let rpcId = 0;
export default function createJsonRPCClient<T extends JsonRPCSchema>(baseURL: URL, schemas: T) {
  return Object.fromEntries(
    Object.keys(schemas.methods).map(name =>
      [name, createJsonRPCFetchMethod(baseURL, schemas, name)]
    )
  ) as {
    [K in keyof T["methods"]]: FunctionTypeOfRPCCall<T, K>;
  }
}

function createJsonRPCFetchMethod<T extends JsonRPCSchema, K extends keyof T["methods"]>(
  baseURL: URL,
  schemas: T,
  key: K
) {
  return async (params:  z.infer<T["methods"][K]["input"]>): Promise<z.infer<T["methods"][K]["result"]>> => {
    const url = new URL(schemas.path, baseURL);
    const response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: key,
        params,
      }),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message);
    return result.result;
  };
}
