import type { FunctionTypeOfRPCCall, RPCSchema } from "@tokenring-ai/rpc/types";

let rpcId = 0;

type PendingRequest = { resolve: (value: any) => void; reject: (reason?: any) => void };
type StreamHandler = {
  enqueue: (val: any) => void;
  close: () => void;
  error: (err: Error) => void;
};

type SocketEntry = {
  socket: WebSocket;
  pendingRequests: Map<number, PendingRequest>;
  pendingStreams: Map<number, StreamHandler>;
};

const socketCache = new Map<string, SocketEntry>();

export default function createWsRPCClient<T extends RPCSchema>(wsUrl: URL, schemas: T) {
  const urlKey = wsUrl.toString();

  let entry = socketCache.get(urlKey);
  if (!entry || entry.socket.readyState === WebSocket.CLOSED || entry.socket.readyState === WebSocket.CLOSING) {
    const socket = new WebSocket(wsUrl);
    const pendingRequests = new Map<number, PendingRequest>();
    const pendingStreams = new Map<number, StreamHandler>();

    socket.onmessage = event => {
      const data = JSON.parse(event.data);
      const { id, result, error, stream } = data;

      if (pendingRequests.has(id)) {
        const { resolve, reject } = pendingRequests.get(id)!;
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

    socket.addEventListener("close", () => socketCache.delete(urlKey), { once: true });

    entry = { socket, pendingRequests, pendingStreams };
    socketCache.set(urlKey, entry);
  }

  const { socket, pendingRequests, pendingStreams } = entry;

  const ensureOpen = () =>
    new Promise<void>((resolve, reject): void => {
      if (socket.readyState === WebSocket.OPEN) {
        return resolve();
      }

      if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        return reject(new Error("Socket closed"));
      }

      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", e => reject(e), { once: true });
    });

  return Object.fromEntries(
    Object.entries(schemas.methods).map(([methodName, method]) => [
      methodName,
      method.type === "stream"
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
              },
            });

            socket.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                method: `${schemas.path}.${methodName}`,
                params,
              }),
            );

            const onAbort = () => {
              finished = true;
              if (resolveNext) {
                const resolve = resolveNext;
                resolveNext = null;
                resolve(undefined);
              }
            };
            signal?.addEventListener("abort", onAbort);

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
              signal?.removeEventListener("abort", onAbort);
            }
          }
        : async (params: any) => {
            await ensureOpen();
            const id = ++rpcId;
            return new Promise((resolve, reject) => {
              pendingRequests.set(id, { resolve, reject });
              socket.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  method: `${schemas.path}.${methodName}`,
                  params,
                }),
              );
            });
          },
    ]),
  ) as {
    [K in keyof T["methods"]]: FunctionTypeOfRPCCall<T, K>;
  };
}
