import type { RpcCallContext } from "@tokenring-ai/rpc/types";
import type { Serve } from "bun";

/** What the WebSocket host tells an RPC method about its caller beyond who they are. */
export interface WebRpcCallContext extends RpcCallContext {
  /** `scheme://host` the caller's browser used, e.g. `http://192.168.1.20:3000`. */
  requestOrigin?: string;
}

type Context = {
  path: string;
  abortController: AbortController;
  /** Username resolved from the session cookie at handshake, if any. */
  sessionUsername?: string | null;
  /** Whether that session still holds: not signed out, user not removed, password unchanged. */
  sessionValid?: () => boolean;
  requestOrigin?: string;
};

export interface WebResource {
  //register?: (router: BunRouter) => MaybePromise<void>;
  routes?: Serve.RoutesWithUpgrade<Context, string>;
  wsRoutes?: Record<string, WebSocketHandler>;
}

/**
 * WebSocket handler interface
 */
export interface WebSocketHandler {
  open?(ws: BunWebSocket): void;

  close?(ws: BunWebSocket): void;

  message?(ws: BunWebSocket, message: string | Buffer): void | Promise<void>;

  /** Protocol-level ping received from the peer (or sent by the server). */
  ping?(ws: BunWebSocket, data: Buffer): void;

  /** Protocol-level pong received from the peer. */
  pong?(ws: BunWebSocket, data: Buffer): void;
}

/**
 * WebSocket wrapper interface
 */
export interface BunWebSocket {
  data: any;

  send(data: string | object): void;

  close(): void;

  /** Send a protocol-level WebSocket ping frame. */
  ping?(data?: string | ArrayBufferView | ArrayBuffer): void;

  /** Send a protocol-level WebSocket pong frame. */
  pong?(data?: string | ArrayBufferView | ArrayBuffer): void;
}

/**
 * Static file serving options
 */
export interface StaticOptions {
  index?: string;
  notFound?: string;
  headers?: Record<string, string>;
}
