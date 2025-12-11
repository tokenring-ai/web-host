import {AgentCommandService} from "@tokenring-ai/agent";
import TokenRingApp, {TokenRingPlugin} from "@tokenring-ai/app";
import {z} from "zod";
import {AuthConfigSchema} from "./auth.ts";
import webhost from "./commands/webhost.js";
import packageJSON from "./package.json" with {type: "json"};
import SPAResource, {spaResourceConfigSchema} from "./SPAResource.ts";
import StaticResource, {staticResourceConfigSchema} from "./StaticResource.ts";
import WebHostService from "./WebHostService.js";

export const WebHostConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().optional(),
  auth: AuthConfigSchema.optional(),
  resources: z.record(z.string(), z.discriminatedUnion("type", [
    staticResourceConfigSchema,
    spaResourceConfigSchema,
  ])).optional(),
})
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
} as TokenRingPlugin;

export {default as WebHostService} from "./WebHostService.js";
export {default as StaticResource} from "./StaticResource.js";
export type {WebResource} from "./types.js";
