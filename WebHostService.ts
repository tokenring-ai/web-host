import { TokenRingService } from "@tokenring-ai/agent/types";
import AgentTeam from "@tokenring-ai/agent/AgentTeam";
import Fastify, { FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import KeyedRegistry from "@tokenring-ai/utility/KeyedRegistry";
import type { WebResource } from "./types.js";

export default class WebHostService implements TokenRingService {
  name = "WebHostService";
  description = "Fastify web host for serving resources and APIs";

  private server: FastifyInstance;
  private port: number;
  private resources = new KeyedRegistry<WebResource>();

  constructor(port: number = 3000) {
    this.port = port;
    this.server = Fastify({ logger: false });
  }

  registerResource = this.resources.register;

  async start(agentTeam: AgentTeam): Promise<void> {
    await this.server.register(fastifyWebsocket);

    for (const resource of this.resources.getAllItemValues()) {
      await resource.register(this.server);
    }

    await this.server.listen({ port: this.port, host: "0.0.0.0" });
    console.log(`WebHost listening on port ${this.port}`);
  }

  async stop(): Promise<void> {
    await this.server.close();
  }

  getServer(): FastifyInstance {
    return this.server;
  }
}
