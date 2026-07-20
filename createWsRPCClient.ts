import type { FunctionTypeOfRPCCall, RPCSchema } from "@tokenring-ai/rpc/types";
import z from "zod";

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
  /** Shared login for this socket; null until auth succeeds. */
  authPromise: Promise<void> | null;
  authenticatedUsername: string | null;
};

export type WsRPCClientAuth = {
  username: string;
  password: string;
};

/** JSON-RPC error code the server uses for failed/missing authentication. */
export const RPC_AUTH_ERROR_CODE = -32001;

export class RPCError extends Error {
  constructor(
    message: string,
    public code: number,
  ) {
    super(message);
    this.name = "RPCError";
  }
}

export function isRPCAuthError(error: unknown): error is RPCError {
  return error instanceof RPCError && error.code === RPC_AUTH_ERROR_CODE;
}

export type WsRPCAuthHandler = {
  /**
   * Called when authentication fails. Resolve once new credentials are
   * available (the auth object is re-read), and authentication is retried.
   * Rejecting propagates the failure to all pending RPC calls.
   */
  onAuthRequired: (error: RPCError) => Promise<void>;
  /** Called after authentication succeeds, so any login UI can close. */
  onAuthSuccess?: () => void;
};

let authHandler: WsRPCAuthHandler | null = null;

/**
 * Register a UI hook (e.g. a login overlay) that supplies new credentials when
 * authentication fails. Without a handler, auth failures reject pending calls.
 */
export function setWsRPCAuthHandler(handler: WsRPCAuthHandler | null): void {
  authHandler = handler;
}

const socketCache = new Map<string, SocketEntry>();

const JSONRPCSchema = z.object({
  id: z.number(),
  result: z.unknown().exactOptional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .exactOptional(),
  stream: z.literal("end").exactOptional(),
});

function ensureOpen(socket: WebSocket) {
  return new Promise<void>((resolve, reject): void => {
    if (socket.readyState === WebSocket.OPEN) {
      return resolve();
    }

    if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      return reject(new Error("Socket closed"));
    }

    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", e => reject(e), { once: true });
  });
}

function sendAuthRequest(entry: SocketEntry, auth: WsRPCClientAuth): Promise<void> {
  const id = ++rpcId;

  return new Promise<void>((resolve, reject) => {
    entry.pendingRequests.set(id, {
      resolve: () => resolve(),
      reject: (reason?: unknown) => reject(reason instanceof Error ? reason : new Error(String(reason))),
    });

    entry.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "auth",
        params: {
          username: auth.username,
          password: auth.password,
        },
      }),
    );
  });
}

function ensureAuth(entry: SocketEntry, auth: WsRPCClientAuth): Promise<void> {
  if (entry.authenticatedUsername === auth.username) {
    return Promise.resolve();
  }

  if (entry.authPromise) {
    return entry.authPromise;
  }

  entry.authPromise = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- retried until auth succeeds or a non-auth error occurs
      while (true) {
        await ensureOpen(entry.socket);
        try {
          // Credentials are re-read from `auth` on every attempt, so a login
          // UI can update them between retries.
          await sendAuthRequest(entry, auth);
          entry.authenticatedUsername = auth.username;
          authHandler?.onAuthSuccess?.();
          return;
        } catch (error) {
          if (isRPCAuthError(error) && authHandler) {
            await authHandler.onAuthRequired(error);
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      entry.authPromise = null;
      entry.authenticatedUsername = null;
      throw error;
    }
  })();

  return entry.authPromise;
}

function getOrCreateSocketEntry(wsUrl: URL): SocketEntry {
  const urlKey = wsUrl.toString();

  let entry = socketCache.get(urlKey);
  if (!entry || entry.socket.readyState === WebSocket.CLOSED || entry.socket.readyState === WebSocket.CLOSING) {
    const socket = new WebSocket(wsUrl);
    const pendingRequests = new Map<number, PendingRequest>();
    const pendingStreams = new Map<number, StreamHandler>();

    socket.onmessage = event => {
      const data = JSON.parse(event.data) as unknown;
      const parsed = JSONRPCSchema.parse(data);
      const { id, result, error, stream } = parsed;

      if (pendingRequests.has(id)) {
        const { resolve, reject } = pendingRequests.get(id)!;
        pendingRequests.delete(id);
        if (error) reject(new RPCError(error.message, error.code));
        else resolve(result);
      } else if (pendingStreams.has(id)) {
        const handler = pendingStreams.get(id)!;
        if (error) {
          handler.error(new RPCError(error.message, error.code));
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

    entry = {
      socket,
      pendingRequests,
      pendingStreams,
      authPromise: null,
      authenticatedUsername: null,
    };
    socketCache.set(urlKey, entry);
  }

  return entry;
}

/**
 * Create a type-safe WebSocket RPC client.
 * Always authenticates with the given username/password after the socket opens
 * (and after reconnects) before any other method calls.
 */
export default function createWsRPCClient<T extends RPCSchema>(wsUrl: URL, schemas: T, auth: WsRPCClientAuth) {
  // The socket entry is resolved on every call so that a closed socket is
  // transparently replaced (and re-authenticated) instead of failing forever.
  const ensureReady = async (): Promise<SocketEntry> => {
    const entry = getOrCreateSocketEntry(wsUrl);
    await ensureOpen(entry.socket);
    await ensureAuth(entry, auth);
    return entry;
  };

  return Object.fromEntries(
    Object.entries(schemas.methods).map(([methodName, method]) => [
      methodName,
      method.type === "stream"
        ? async function* (params: unknown, signal: AbortSignal) {
            const { socket, pendingStreams } = await ensureReady();
            const id = ++rpcId;

            const queue: unknown[] = [];
            let resolveNext: ((value: unknown) => void) | null = null;
            let finished = false as boolean;
            let streamError: Error | null = null;

            pendingStreams.set(id, {
              enqueue: (val: unknown) => {
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
            signal.addEventListener("abort", onAbort);

            try {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this is ok
              while (true) {
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- can be mutated asynchronously
                if (streamError) throw streamError;
                if (queue.length > 0) {
                  yield queue.shift();
                  continue;
                }
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- can be mutated asynchronously
                if (finished || signal.aborted) break;

                await new Promise(resolve => {
                  resolveNext = resolve;
                });
              }
            } finally {
              pendingStreams.delete(id);
              signal.removeEventListener("abort", onAbort);
            }
          }
        : async (params: unknown) => {
            const { socket, pendingRequests } = await ensureReady();
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
