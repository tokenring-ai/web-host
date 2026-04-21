import { AgentCommandService } from "@tokenring-ai/agent";
import type { TokenRingPlugin } from "@tokenring-ai/app";
import { RpcService } from "@tokenring-ai/rpc";

import { z } from "zod";
import commands from "./commands.ts";
import JsonRpcResource from "./JsonRpcResource.ts";
import packageJSON from "./package.json" with { type: "json" };
import { WebHostConfigSchema } from "./schema.ts";
import WebHostService from "./WebHostService.ts";
import WsRpcResource from "./WsRpcResource.ts";

const packageConfigSchema = z.object({
  webHost: WebHostConfigSchema,
});

export default {
  name: packageJSON.name,
  displayName: "Web Host",
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    const webHostService = new WebHostService(app, config.webHost);
    app.addServices(webHostService);

    app.waitForService(AgentCommandService, service => {
      service.addAgentCommands(...commands);
    });
  },
  async start(app, config) {
    const webHostService = app.requireService(WebHostService);
    const rpcService = app.getService(RpcService);

    if (rpcService) {
      for (const endpoint of rpcService.getAllEndpoints()) {
        app.serviceOutput(webHostService, `Registering JSON-RPC endpoint: ${endpoint.path}`);
        webHostService.registerResource(endpoint.name, new JsonRpcResource(app, endpoint));
        webHostService.registerResource(`${endpoint.name} (WS)`, new WsRpcResource(app, endpoint));
      }
    }
    if (config.webHost.autoStart) {
      await webHostService.listen();
    }
  },
  async reconfigure(app, config) {
    await app.requireService(WebHostService).reconfigure(config.webHost);
  },
  config: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
