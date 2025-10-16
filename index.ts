import { AgentTeam, TokenRingPackage } from "@tokenring-ai/agent";
import { z } from "zod";
import packageJSON from "./package.json" with { type: "json" };
import WebHostService from "./WebHostService.js";

export const WebHostConfigSchema = z.object({
  port: z.number().default(3000),
  enabled: z.boolean().default(true),
}).optional();

export const packageInfo: TokenRingPackage = {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(agentTeam: AgentTeam) {
    const config = agentTeam.getConfigSlice("webHost", WebHostConfigSchema);
    if (config?.enabled) {
      const service = new WebHostService(config.port);
      agentTeam.addServices(service);
    }
  },
  async start(agentTeam: AgentTeam) {
    const service = agentTeam.services.getItemByType(WebHostService);
    if (service) {
      await service.start(agentTeam);
    }
  },
};

export { default as WebHostService } from "./WebHostService.js";
export type { WebResource } from "./types.js";
