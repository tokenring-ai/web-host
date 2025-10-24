import {AgentTeam, TokenRingPackage} from "@tokenring-ai/agent";
import {z} from "zod";
import packageJSON from "./package.json" with {type: "json"};
import WebHostService, {WebHostConfigSchema} from "./WebHostService.js";


export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(agentTeam: AgentTeam) {
    const config = agentTeam.getConfigSlice("webHost", WebHostConfigSchema.optional());
    if (config) {
      const service = new WebHostService(config);
      agentTeam.addServices(service);
    }
  },
  async start(agentTeam: AgentTeam) {
    const service = agentTeam.services.getItemByType(WebHostService);
    if (service) {
      await service.start(agentTeam);
    }
  },
} as TokenRingPackage;

export {default as WebHostService} from "./WebHostService.js";
export type {WebResource} from "./types.js";
