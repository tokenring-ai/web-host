import TokenRingApp from "@tokenring-ai/app";

import {TokenRingService} from "@tokenring-ai/app/types";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import Fastify, {FastifyInstance} from "fastify";
import {z} from "zod";
import {WebHostConfigSchema} from "./index.ts";
import type {WebResource} from "./types.js";

export default class WebHostService implements TokenRingService {
  name = "WebHostService";
  description = "Fastify web host for serving resources and APIs";

  private server!: FastifyInstance;

  resources = new KeyedRegistry<WebResource>();
  registerResource = this.resources.register;

  constructor(private app: TokenRingApp, private config: z.output<typeof WebHostConfigSchema>) {}

  async start() {
    this.server = Fastify({logger: false, routerOptions: {ignoreTrailingSlash: true}});
    for (const resource of this.resources.getAllItemValues()) {
      await resource.register(this.server);
    }

    //console.log(this.server.printRoutes());
    await this.server.listen({port: this.config.port, host: this.config.host});

    this.app.serviceOutput(`WebHost listening at ${this.getURL()}`);
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

  async stop(): Promise<void> {
    await this.server.close();
  }
}
