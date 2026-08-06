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
}

/**
 * WebSocket wrapper interface
 */
export interface BunWebSocket {
  data: any;

  send(data: string | object): void;

  close(): void;
}

/**
 * Static file serving options
 */
export interface StaticOptions {
  index?: string;
  notFound?: string;
  headers?: Record<string, string>;
}
