import type { MaybePromise } from "bun";

export interface WebResource {
  register(router: BunRouter): MaybePromise<void>;
}

/**
 * Router interface that wraps Bun's server capabilities
 * Resources use this to register routes, websockets, and static file handlers
 */
export interface BunRouter {
  /**
   * Register a GET route handler
   */
  get(path: string, handler: RouteHandler): void;

  /**
   * Register a POST route handler
   */
  post(path: string, handler: RouteHandler): void;

  /**
   * Register a PUT route handler
   */
  put(path: string, handler: RouteHandler): void;

  /**
   * Register a DELETE route handler
   */
  delete(path: string, handler: RouteHandler): void;

  /**
   * Register a WebSocket route handler
   */
  ws(path: string, handler: WebSocketHandler): void;

  /**
   * Serve static files from a directory
   */
  static(prefix: string, root: string, options?: StaticOptions): void;

  /**
   * Set a catch-all handler for unmatched routes
   */
  fallback(handler: RouteHandler): void;
}

/**
 * Request object passed to route handlers
 */
export interface BunRequest {
  method: string;
  url: string;
  path: string;
  headers: Headers;
  body: () => MaybePromise<any>;
  json: () => MaybePromise<any>;
  text: () => MaybePromise<string>;
  arrayBuffer: () => MaybePromise<ArrayBuffer>;
}

/**
 * Response utilities
 */
export interface BunResponse {
  /**
   * Send a JSON response
   */
  json(data: any, status?: number): Response;

  /**
   * Send a text response
   */
  text(data: string, status?: number): Response;

  /**
   * Send a file response
   */
  file(path: string): MaybePromise<Response>;

  /**
   * Send HTML response
   */
  html(data: string, status?: number): Response;

  /**
   * Send a redirect
   */
  redirect(url: string, status?: number): Response;

  /**
   * Create a stream response
   */
  stream(callback: (controller: ReadableStreamDefaultController) => MaybePromise<void>): Response;
}

/**
 * Route handler function type
 */
export type RouteHandler = (request: BunRequest, response: BunResponse) => MaybePromise<Response | void>;

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
