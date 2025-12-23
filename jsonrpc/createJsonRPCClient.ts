import {z} from "zod";
import type {JsonRPCSchema} from "./types.ts";


export type ResultOfRPCCall<T extends JsonRPCSchema, K extends keyof T["methods"]> = z.infer<T["methods"][K]["result"]>;
export type ParamsOfRPCCall<T extends JsonRPCSchema, K extends keyof T["methods"]> = z.infer<T["methods"][K]["input"]>;
export type FunctionTypeOfRPCCall<T extends JsonRPCSchema, K extends keyof T["methods"]> = T["methods"][K]["type"] extends "stream"
  ? (params: ParamsOfRPCCall<T, K>, signal: AbortSignal) => AsyncGenerator<ResultOfRPCCall<T, K>>
  : (params: ParamsOfRPCCall<T, K>) => Promise<ResultOfRPCCall<T, K>>;


let rpcId = 0;

export function resetRpcId() {
  rpcId = 0;
}

export default function createJsonRPCClient<T extends JsonRPCSchema>(baseURL: URL, schemas: T) {
  return Object.fromEntries(
    Object.keys(schemas.methods).map(name =>
      [
        name,
        schemas.methods[name].type === "stream"
          ? createJsonRPCStream(baseURL, schemas, name)
          : createJsonRPCFetchMethod(baseURL, schemas, name)
      ]
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
    return async (params: z.infer<T["methods"][K]["input"]>): Promise<z.infer<T["methods"][K]["result"]>> => {
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

function createJsonRPCStream<T extends JsonRPCSchema, K extends keyof T["methods"]>(
  baseURL: URL,
  schemas: T,
  key: K
) {
  return async function* (params: z.infer<T["methods"][K]["input"]>, signal: AbortSignal): AsyncGenerator<z.infer<T["methods"][K]["result"]>> {
    const url = new URL(schemas.path, baseURL);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        "Accept": "text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: key,
        params,
      }),
      signal
    });

    const reader = response.body!.getReader();
    let accumulatedData = '';

    while (! signal.aborted) {
      const {done, value} = await reader.read();
      if (done) break;

      accumulatedData += new TextDecoder().decode(value);

      // Basic parsing for demonstration, a more robust parser is needed for production
      const events = accumulatedData.split('\n\n');
      accumulatedData = events.pop()!; // Keep incomplete event data

      for (let event of events) {
        event = event.trim();
        if (!event) continue; // Skip empty lines

        if (event.startsWith('data:')) {
          yield JSON.parse(event.substring(5)).result as ResultOfRPCCall<T, K>;
        }
      }
    }
  }
}
