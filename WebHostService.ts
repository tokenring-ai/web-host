import type TokenRingApp from "@tokenring-ai/app";
import type { TokenRingService } from "@tokenring-ai/app/types";
import { ConfigurationError } from "@tokenring-ai/app/types";
import { stripUndefinedKeys } from "@tokenring-ai/utility/object/stripObject";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import { checkAuth, unauthorizedResponse } from "./auth.ts";
import type { ParsedWebHostConfig } from "./schema.ts";
import type { BunRequest, BunResponse, BunRouter, BunWebSocket, RouteHandler, StaticOptions, WebResource, WebSocketHandler } from "./types.ts";

type Context = {
  path: string;
  abortController: AbortController;
};

/**
 * Router implementation that collects routes and later integrates with Bun.serve
 */
class Router implements BunRouter {
  private routes: Map<string, Map<string, RouteHandler>> = new Map();
  private wsRoutes: Map<string, WebSocketHandler> = new Map();
  private staticRoutes: Array<{
    prefix: string;
    root: string;
    options?: StaticOptions;
  }> = [];
  private fallbackHandler?: RouteHandler;

  get(path: string, handler: RouteHandler): void {
    this.addRoute("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.addRoute("POST", path, handler);
  }

  put(path: string, handler: RouteHandler): void {
    this.addRoute("PUT", path, handler);
  }

  delete(path: string, handler: RouteHandler): void {
    this.addRoute("DELETE", path, handler);
  }

  ws(path: string, handler: WebSocketHandler): void {
    this.wsRoutes.set(path, handler);
  }

  static(prefix: string, root: string, options?: StaticOptions): void {
    this.staticRoutes.push(stripUndefinedKeys({ prefix, root, options }));
  }

  fallback(handler: RouteHandler): void {
    this.fallbackHandler = handler;
  }

  /**
   * Get all registered routes for Bun.serve
   */
  getRoutes() {
    return this.routes;
  }

  /**
   * Get all WebSocket routes
   */
  getWsRoutes() {
    return this.wsRoutes;
  }

  /**
   * Get all static routes
   */
  getStaticRoutes() {
    return this.staticRoutes;
  }

  /**
   * Get fallback handler
   */
  getFallback() {
    return this.fallbackHandler;
  }

  private addRoute(method: string, path: string, handler: RouteHandler): void {
    if (!this.routes.has(path)) {
      this.routes.set(path, new Map());
    }
    this.routes.get(path)!.set(method, handler);
  }
}

export default class WebHostService implements TokenRingService {
  readonly name = "WebHostService";
  description = "Bun web host for serving resources and APIs";
  resources = new KeyedRegistry<WebResource>();
  registerResource = this.resources.set;
  getResourceEntries = this.resources.entriesArray;
  private router = new Router();
  private server: any;

  constructor(
    private app: TokenRingApp,
    private config: Omit<ParsedWebHostConfig, "autoStart">,
  ) {}

  get listening() {
    return !!this.server;
  }

  async listen() {
    if (this.server) {
      throw new ConfigurationError(this.name, "Server already listening");
    }
    this.router = new Router();

    // Register all resources
    for (const resource of this.resources.valuesArray()) {
      await resource.register(this.router);
    }

    // Build Bun.serve fetch handler
    const fetchHandler = this.buildFetchHandler();

    // Build WebSocket handlers
    const websocketHandlers = this.buildWebSocketHandlers();

    // Start Bun server
    this.server = Bun.serve({
      port: this.config.port,
      hostname: this.config.host,
      fetch: fetchHandler,
      websocket: websocketHandlers,
    });

    this.app.serviceOutput(this, `Web Host listening at ${this.getURL()}`);
  }

  async reconfigure(config: ParsedWebHostConfig) {
    const wasListening = this.listening;
    if (wasListening) {
      this.stop();
    }

    this.config = config;

    if (config.autoStart || wasListening) {
      await this.listen();
    }
  }

  stop() {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  getURL(): URL {
    if (!this.server) {
      throw new ConfigurationError(this.name, "Server not started");
    }
    return new URL(`http://${this.server.hostname}:${this.server.port}`);
  }

  private buildFetchHandler() {
    const routes = this.router.getRoutes();
    const wsRoutes = this.router.getWsRoutes();
    const staticRoutes = this.router.getStaticRoutes();
    const fallback = this.router.getFallback();
    const authConfig = this.config.auth;

    return async (request: Request, server: Bun.Server<Context>): Promise<Response | undefined> => {
      const url = new URL(request.url);
      const path = url.pathname;

      // Check if this is a WebSocket upgrade request
      if (wsRoutes.has(path) && request.headers.get("upgrade") === "websocket") {
        // Check auth if configured
        if (authConfig) {
          const bunRequest = this.wrapRequest(request);
          const username = checkAuth(bunRequest, authConfig);
          if (!username) {
            const bunResponse = this.createResponseHelper();
            return unauthorizedResponse(bunResponse);
          }
        }

        // Upgrade to WebSocket
        const success = server.upgrade(request, {
          data: {
            path,
            abortController: new AbortController(),
          },
        });

        // If upgrade fails, return error
        if (!success) {
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        // Return undefined to indicate WebSocket upgrade
        return undefined;
      }

      // Wrap request and response utilities
      const bunRequest = this.wrapRequest(request);
      const bunResponse = this.createResponseHelper();

      // Check authentication if configured
      if (authConfig) {
        const username = checkAuth(bunRequest, authConfig);
        if (!username) {
          return unauthorizedResponse(bunResponse);
        }
        // Attach user to request for use in handlers
        //(bunRequest as any).user = username;
      }

      // Try static file routes first
      for (const { prefix, root, options } of staticRoutes) {
        if (path.startsWith(prefix)) {
          let filePath = path.slice(prefix.length);

          // Handle index file
          if (filePath === "" || filePath === "/") {
            filePath = "/" + (options?.index || "index.html");
          }

          const fullPath = `${root}${filePath}`;

          try {
            const file = Bun.file(fullPath);
            if (await file.exists()) {
              return new Response(file);
            }
          } catch {
            // File doesn't exist, continue to next handler
          }
        }
      }

      // Try route handlers
      const routeHandlers = routes.get(path);
      if (routeHandlers) {
        const handler = routeHandlers.get(request.method);
        if (handler) {
          const result = await handler(bunRequest, bunResponse);
          return result || new Response("");
        }
      }

      // Try fallback handler
      if (fallback) {
        const result = await fallback(bunRequest, bunResponse);
        return result || new Response("");
      }

      // 404 Not Found
      return new Response("Not Found", { status: 404 });
    };
  }

  private buildWebSocketHandlers() {
    const wsRoutes = this.router.getWsRoutes();

    return {
      open(ws: Bun.ServerWebSocket<Context>) {
        const handler = wsRoutes.get(ws.data.path);
        if (handler?.open) {
          // Create wrapper with send method
          const wsWrapper: BunWebSocket = {
            send: (data: string | object) => {
              const message = typeof data === "string" ? data : JSON.stringify(data);
              ws.send(message);
            },
            close: () => ws.close(),
            data: ws.data,
          };
          handler.open(wsWrapper);
        }
      },

      close(ws: Bun.ServerWebSocket<Context>) {
        const handler = wsRoutes.get(ws.data.path);
        if (handler?.close) {
          const wsWrapper: BunWebSocket = {
            send: (data: string | object) => {
              const message = typeof data === "string" ? data : JSON.stringify(data);
              ws.send(message);
            },
            close: () => ws.close(),
            data: ws.data,
          };
          handler.close(wsWrapper);
        }
      },

      message(ws: Bun.ServerWebSocket<Context>, message: string | Buffer) {
        const handler = wsRoutes.get(ws.data.path);
        if (handler?.message) {
          const wsWrapper: BunWebSocket = {
            send: (data: string | object) => {
              const msg = typeof data === "string" ? data : JSON.stringify(data);
              ws.send(msg);
            },
            close: () => ws.close(),
            data: ws.data,
          };
          handler.message(wsWrapper, message);
        }
      },
    };
  }

  private wrapRequest(request: Request): BunRequest {
    return {
      method: request.method,
      url: request.url,
      path: new URL(request.url).pathname,
      headers: request.headers,
      body: () => request.text(),
      json: () => request.json(),
      text: () => request.text(),
      arrayBuffer: () => request.arrayBuffer(),
    };
  }

  private createResponseHelper(): BunResponse {
    return {
      json: (data: any, status = 200) => {
        return new Response(JSON.stringify(data), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      },
      text: (data: string, status = 200) => {
        return new Response(data, {
          status,
          headers: { "Content-Type": "text/plain" },
        });
      },
      file: (path: string) => {
        const file = Bun.file(path);
        return Promise.resolve(new Response(file));
      },
      html: (data: string, status = 200) => {
        return new Response(data, {
          status,
          headers: { "Content-Type": "text/html" },
        });
      },
      redirect: (url: string, status = 302) => {
        return new Response(null, {
          status,
          headers: { Location: url },
        });
      },
      stream: (callback: (controller: ReadableStreamDefaultController) => Promise<void>) => {
        const stream = new ReadableStream({
          start: callback,
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    };
  }
}
