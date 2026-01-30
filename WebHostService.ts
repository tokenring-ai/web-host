import fastifyWebsocket from "@fastify/websocket";
import TokenRingApp from "@tokenring-ai/app";

import {TokenRingService} from "@tokenring-ai/app/types";
import waitForAbort from "@tokenring-ai/utility/promise/waitForAbort";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import Fastify, {FastifyInstance} from "fastify";
import {z} from "zod";
import {registerAuth} from "./auth.ts";

import {type ParsedWebHostConfig, WebHostConfigSchema} from "./schema.ts";
import type {WebResource} from "./types.js";

export default class WebHostService implements TokenRingService {
  name = "WebHostService";
  description = "Fastify web host for serving resources and APIs";

  private server!: FastifyInstance;

  resources = new KeyedRegistry<WebResource>();
  registerResource = this.resources.register;
  getResources = this.resources.getAllItems;

  constructor(private app: TokenRingApp, private config: ParsedWebHostConfig) {}

  async run(signal: AbortSignal) {
    this.server = Fastify({logger: false, routerOptions: {ignoreTrailingSlash: true}});
    await this.server.register(fastifyWebsocket);
    
    if (this.config.auth) {
      registerAuth(this.server, this.config.auth);
    }
    
    for (const resource of this.resources.getAllItemValues()) {
      await resource.register(this.server);
    }

    //console.log(this.server.printRoutes());
    await this.server.listen({port: this.config.port, host: this.config.host});

    this.app.serviceOutput(`WebHost listening at ${this.getURL()}`);

    return waitForAbort(signal, async (ev) => {
      await this.server.close()
    });
  }

  getURL(): URL {
    let port = this.config.port;
    if (! port) {
      if (this.server.addresses().length === 0) {
        throw new Error("Failed to get port");
      }

      port = this.server.addresses()[0].port;
    }
    return new URL(`http://${this.config.host}:${port}`);
  }
}
