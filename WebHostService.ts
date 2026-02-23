import fastifyWebsocket from "@fastify/websocket";
import TokenRingApp from "@tokenring-ai/app";

import {TokenRingService} from "@tokenring-ai/app/types";
import waitForAbort from "@tokenring-ai/utility/promise/waitForAbort";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import Fastify, {FastifyInstance} from "fastify";
import {registerAuth} from "./auth.ts";

import {type ParsedWebHostConfig} from "./schema.ts";
import type {WebResource} from "./types.js";

export default class WebHostService implements TokenRingService {
  readonly name = "WebHostService";
  description = "Fastify web host for serving resources and APIs";

  private server = Fastify({logger: false, routerOptions: {ignoreTrailingSlash: true}});

  resources = new KeyedRegistry<WebResource>();
  registerResource = this.resources.register;
  getResourceEntries = this.resources.entries;



  constructor(private app: TokenRingApp, private config: ParsedWebHostConfig) {}

  async start(signal: AbortSignal) {
    await this.server.register(fastifyWebsocket);

    if (this.config.auth) {
      registerAuth(this.server, this.config.auth);
    }

    for (const resource of this.resources.getAllItemValues()) {
      await resource.register(this.server);
    }

    await this.server.listen({port: this.config.port, host: this.config.host});

    this.app.serviceOutput(this,`Web Host listening at ${this.getURL()}`);
  }

  async stop() {
    await this.server.close()
  }

  getURL(): URL {
    const address = this.server.server.address();
    if (address === null ) {
      throw new Error("Failed to get port");
    }
    if (typeof address === "string") {
      throw new Error("Unknown address type found: " + address + ".");
    }

    return new URL(`http://${address.address}:${address.port}`);
  }
}
