import TokenRingApp from "@tokenring-ai/app";
import {TokenRingPlugin} from "@tokenring-ai/app";
import packageJSON from "./package.json" with {type: "json"};
import WebHostService, {WebHostConfigSchema} from "./WebHostService.js";


export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app: TokenRingApp) {
    const config = app.getConfigSlice("webHost", WebHostConfigSchema.optional());
    if (config) {
      const service = new WebHostService(config);
      app.addServices(service);
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
