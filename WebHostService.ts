import type TokenRingApp from "@tokenring-ai/app";
import type { TokenRingService } from "@tokenring-ai/app/types";
import { ConfigurationError } from "@tokenring-ai/app/types";
import EnhancedStringMap from "@tokenring-ai/utility/map/enhancedStringMap";

import deepEqual from "@tokenring-ai/utility/object/deepEqual";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import type { Serve } from "bun";
import type { ParsedWebHostConfig } from "./schema.ts";
import type { BunWebSocket, WebResource, WebSocketHandler } from "./types.ts";

type Context = {
  path: string;
  abortController: AbortController;
};

export default class WebHostService implements TokenRingService {
  readonly name = "WebHostService";
  description = "Bun web host for serving resources and APIs";
  resources = new KeyedRegistry<WebResource>();
  registerResource = this.resources.set;
  getResourceEntries = this.resources.entriesArray;

  private server: Bun.Server<unknown> | null = null;
  private config: ParsedWebHostConfig | undefined;

  constructor(
    private app: TokenRingApp,
    config?: ParsedWebHostConfig,
  ) {
    if (config) this.config = config;
  }

  getAuthConfig(): ParsedWebHostConfig["auth"] {
    return this.requireConfig().auth;
  }

  async listen() {
    const config = this.requireConfig();

    const routes: Serve.RoutesWithUpgrade<Context, string> = {};
    const wsRoutes = new EnhancedStringMap<WebSocketHandler>();

    // Register all resources
    for (const resource of this.resources.valuesArray()) {
      if ("routes" in resource) {
        Object.assign(routes, resource.routes);
      } else if ("wsRoutes" in resource) {
        wsRoutes.insertAll(Object.entries(resource.wsRoutes));
      }
    }

    // Build Bun.serve fetch handler
    const fetchHandler = this.buildFetchHandler(wsRoutes);

    // Build WebSocket handlers
    const websocketHandlers = this.buildWebSocketHandlers(wsRoutes);

    if (this.server) {
      // Only fetch, error, routes, and websocket can be updated.
      this.server.reload({
        fetch: fetchHandler,
        websocket: websocketHandlers,
      });
    } else {
      // Start Bun server
      this.server = Bun.serve({
        routes,
        port: config.port,
        hostname: config.host,
        fetch: fetchHandler,
        websocket: websocketHandlers,
        development: {
          hmr: false,
        },
      });

      this.app.serviceOutput(this, `Web Host listening at ${this.getURL()}`);
    }
  }

  async reconfigure(config: ParsedWebHostConfig) {
    if (this.config && deepEqual(config, this.config)) return;

    this.config = config;

    // Only restart the server if it is already listening; first-time bind happens in plugin start.
    if (this.server) {
      await this.server.stop();
      this.server = null;
      await this.listen();
    }
  }

  async stop() {
    if (this.server) {
      await this.server.stop();
      this.server = null;
    }
  }

  getURL(): URL {
    if (!this.server) {
      throw new ConfigurationError(this.name, "Server not started");
    }
    return new URL(`http://${this.server.hostname}:${this.server.port}`);
  }

  private requireConfig(): ParsedWebHostConfig {
    if (!this.config) {
      throw new ConfigurationError(this.name, "WebHostService is not configured");
    }
    return this.config;
  }

  private buildFetchHandler(wsRoutes: EnhancedStringMap<WebSocketHandler>) {
    return async (request: Request, server: Bun.Server<Context>): Promise<Response | undefined> => {
      const url = new URL(request.url);
      const path = url.pathname;

      // Check if this is a WebSocket upgrade request.
      // Auth for RPC is handled inside WsRpcResource (username/password over the socket).
      if (wsRoutes.has(path) && request.headers.get("upgrade") === "websocket") {
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

      // 404 Not Found
      return new Response("Not Found", { status: 404 });
    };
  }

  private buildWebSocketHandlers(wsRoutes: EnhancedStringMap<WebSocketHandler>) {
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
}
