import {AgentCommandService} from "@tokenring-ai/agent";
import {TokenRingPlugin} from "@tokenring-ai/app";
import {RpcService} from "@tokenring-ai/rpc";

import {z} from "zod";
import webhost from "./commands/webhost.js";
import {WebHostConfigSchema} from "./index.ts";
import JsonRpcResource from "./JsonRpcResource.ts";
import packageJSON from "./package.json" with {type: "json"};
import SPAResource, {spaResourceConfigSchema} from "./SPAResource.ts";
import StaticResource, {staticResourceConfigSchema} from "./StaticResource.ts";
import WebHostService from "./WebHostService.js";

const packageConfigSchema = z.object({
  webHost: WebHostConfigSchema.optional()
});

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    if (config.webHost) {
      const webHostService = new WebHostService(app, config.webHost);
      app.addServices(webHostService);

      app.waitForService(AgentCommandService, service => {
        service.addAgentCommands({webhost});
      });

      for (const resourceName in config.webHost.resources) {
        const resourceConfig = config.webHost.resources[resourceName];
        if (resourceConfig.type === 'static') {
          webHostService.registerResource(resourceName, new StaticResource(staticResourceConfigSchema.parse(resourceConfig)));
        }

        if (resourceConfig.type === 'spa') {
          webHostService.registerResource(resourceName, new SPAResource(spaResourceConfigSchema.parse(resourceConfig)));
        }
      }
    }
  },
  start(app, config) {
    if (! config.webHost) return;
    const webHostService = app.requireService(WebHostService);
    const rpcService = app.getService(RpcService);

    if (rpcService) {
      for (const endpoint of rpcService.getAllEndpoints()) {
        app.serviceOutput(`Registering JSON-RPC endpoint: ${endpoint.path}`);
        webHostService.registerResource(endpoint.name, new JsonRpcResource(app, endpoint));
      }
    }
  },
  config: packageConfigSchema
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
