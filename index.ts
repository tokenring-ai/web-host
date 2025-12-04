import {AgentCommandService} from "@tokenring-ai/agent";
import TokenRingApp from "@tokenring-ai/app";
import {TokenRingPlugin} from "@tokenring-ai/app";
import packageJSON from "./package.json" with {type: "json"};
import WebHostService, {WebHostConfigSchema} from "./WebHostService.js";
import webhost from "./commands/webhost.js";

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app: TokenRingApp) {
    const config = app.getConfigSlice("webHost", WebHostConfigSchema.optional());
    if (config) {
      app.addServices(new WebHostService(app,config));
      app.waitForService(AgentCommandService, service => {
        service.addAgentCommands({ webhost });
      });
    }
},
  async start(app: TokenRingApp) {
    const service = app.getService(WebHostService);
    if (service) {
      await service.start();
    }
  },
} as TokenRingPlugin;

export {default as WebHostService} from "./WebHostService.js";
export type {WebResource} from "./types.js";
