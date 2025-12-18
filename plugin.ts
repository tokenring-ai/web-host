import {AgentCommandService} from "@tokenring-ai/agent";
import TokenRingApp, {TokenRingPlugin} from "@tokenring-ai/app";
import webhost from "./commands/webhost.js";
import {WebHostConfigSchema} from "./index.ts";
import packageJSON from "./package.json" with {type: "json"};
import SPAResource, {spaResourceConfigSchema} from "./SPAResource.ts";
import StaticResource, {staticResourceConfigSchema} from "./StaticResource.ts";
import WebHostService from "./WebHostService.js";


export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app: TokenRingApp) {
    const config = app.getConfigSlice("webHost", WebHostConfigSchema.optional());
    if (config) {
      const webHostService = new WebHostService(app, config);
      app.addServices(webHostService);

      app.waitForService(AgentCommandService, service => {
        service.addAgentCommands({webhost});
      });

      for (const resourceName in config.resources) {
        const resourceConfig = config.resources[resourceName];
        if (resourceConfig.type === 'static') {
          webHostService.registerResource(resourceName, new StaticResource(staticResourceConfigSchema.parse(resourceConfig)));
        }

        if (resourceConfig.type === 'spa') {
          webHostService.registerResource(resourceName, new SPAResource(spaResourceConfigSchema.parse(resourceConfig)));
        }
      }
    }
  }
} satisfies TokenRingPlugin;
