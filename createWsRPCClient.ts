import type {RPCSchema} from "@tokenring-ai/rpc/types";
import {z} from "zod";

export type ResultOfRPCCall<T extends RPCSchema, K extends keyof T["methods"]> = z.infer<T["methods"][K]["result"]>;
export type ParamsOfRPCCall<T extends RPCSchema, K extends keyof T["methods"]> = z.infer<T["methods"][K]["input"]>;
export type FunctionTypeOfRPCCall<T extends RPCSchema, K extends keyof T["methods"]> = T["methods"][K]["type"] extends "stream"
  ? (params: ParamsOfRPCCall<T, K>, signal: AbortSignal) => AsyncGenerator<ResultOfRPCCall<T, K>>
  : (params: ParamsOfRPCCall<T, K>) => Promise<ResultOfRPCCall<T, K>>;

let rpcId = 0;

export default function createWsRPCClient<T extends RPCSchema>(baseURL: URL, schemas: T) {
  const wsUrl = new URL(schemas.path, baseURL);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  const socket = new WebSocket(wsUrl.toString());
  const pendingRequests = new Map<number, { resolve: (value: any) => void, reject: (reason?: any) => void }>();

  type StreamHandler = {
    enqueue: (val: any) => void;
    close: () => void;
    error: (err: Error) => void;
  };
  const pendingStreams = new Map<number, StreamHandler>();

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const {id, result, error, stream} = data;

    if (pendingRequests.has(id)) {
      const {resolve, reject} = pendingRequests.get(id)!;
      pendingRequests.delete(id);
      if (error) reject(new Error(error.message));
      else resolve(result);
    } else if (pendingStreams.has(id)) {
      const handler = pendingStreams.get(id)!;
      if (error) {
        handler.error(new Error(error.message));
        pendingStreams.delete(id);
      } else if (stream === "end") {
        handler.close();
        pendingStreams.delete(id);
      } else {
        handler.enqueue(result);
      }
    }
  };

  const ensureOpen = () => new Promise<void>((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) return resolve();
    if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) return reject(new Error("Socket closed"));
    socket.addEventListener('open', () => resolve(), {once: true});
    socket.addEventListener('error', (e) => reject(e), {once: true});
  });

  return Object.fromEntries(
    Object.keys(schemas.methods).map(name =>
      [
        name,
        schemas.methods[name].type === "stream"
          ? async function* (params: any, signal: AbortSignal) {
            await ensureOpen();
            const id = ++rpcId;

            const queue: any[] = [];
            let resolveNext: ((value: any) => void) | null = null;
            let finished = false;
            let streamError: Error | null = null;

            pendingStreams.set(id, {
              enqueue: (val: any) => {
                queue.push(val);
                if (resolveNext) {
                  const resolve = resolveNext;
                  resolveNext = null;
                  resolve(undefined);
                }
              },
              close: () => {
                finished = true;
                if (resolveNext) {
                  const resolve = resolveNext;
                  resolveNext = null;
                  resolve(undefined);
                }
              },
              error: (err: Error) => {
                streamError = err;
                if (resolveNext) {
                  const resolve = resolveNext;
                  resolveNext = null;
                  resolve(undefined);
                }
              }
            });

            socket.send(JSON.stringify({
              jsonrpc: '2.0',
              id,
              method: name,
              params,
            }));

            const onAbort = () => {
              finished = true;
              if (resolveNext) {
                const resolve = resolveNext;
                resolveNext = null;
                resolve(undefined);
              }
            };
            signal?.addEventListener('abort', onAbort);

            try {
              while (true) {
                if (streamError) throw streamError;
                if (queue.length > 0) {
                  yield queue.shift();
                  continue;
                }
                if (finished || signal?.aborted) break;

                await new Promise(resolve => {
                  resolveNext = resolve;
                });
              }
            } finally {
              pendingStreams.delete(id);
              signal?.removeEventListener('abort', onAbort);
            }
          }
          : async (params: any) => {
            await ensureOpen();
            const id = ++rpcId;
            return new Promise((resolve, reject) => {
              pendingRequests.set(id, {resolve, reject});
              socket.send(JSON.stringify({
                jsonrpc: '2.0',
                id,
                method: name,
                params,
              }));
            });
          }
      ]
    )
  ) as {
    [K in keyof T["methods"]]: FunctionTypeOfRPCCall<T, K>;
  }
}
