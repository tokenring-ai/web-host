import type { Serve } from "bun";

type Context = {
  path: string;
  abortController: AbortController;
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

  message?(ws: BunWebSocket, message: string | Buffer): void;

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
