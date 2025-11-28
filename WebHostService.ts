import fastifyWebsocket from "@fastify/websocket";

import {TokenRingService} from "@tokenring-ai/app/types";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import Fastify, {FastifyInstance} from "fastify";
import {z} from "zod";
import type {WebResource} from "./types.js";

export const WebHostConfigSchema = z.object({
  port: z.number().optional()
})

export default class WebHostService implements TokenRingService {
  name = "WebHostService";
  description = "Fastify web host for serving resources and APIs";

  private readonly server: FastifyInstance;
  private port: number;
  private resources = new KeyedRegistry<WebResource>();
  registerResource = this.resources.register;

  constructor({port}: z.infer<typeof WebHostConfigSchema>) {
    this.port = port ?? 0;
    this.server = Fastify({logger: false});
  }

  async start(): Promise<void> {
    await this.server.register(fastifyWebsocket);

    for (const resource of this.resources.getAllItemValues()) {
      await resource.register(this.server);
    }

    await this.server.listen({port: this.port, host: "0.0.0.0"});
    if (this.port === 0) {
      if (this.server.addresses().length === 0) {
        throw new Error("Failed to get port");
      }

      this.port = this.server.addresses()[0].port;
    }
    console.log(`WebHost listening on port ${this.port}`);
  }

  async stop(): Promise<void> {
    await this.server.close();
  }

  getServer(): FastifyInstance {
    return this.server;
  }
}
