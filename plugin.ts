import { AgentCommandService } from "@tokenring-ai/agent";
import type { TokenRingPlugin } from "@tokenring-ai/app";
import { RpcService } from "@tokenring-ai/rpc";

import { z } from "zod";
import commands from "./commands.ts";
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
  install(app) {
    app.addServices(new WebHostService(app));

    app.waitForService(AgentCommandService, service => {
      service.addAgentCommands(...commands);
    });
  },
  async reconfigure(app, config) {
    await app.requireService(WebHostService).reconfigure(config.webHost);
  },
  async start(app) {
    const webHostService = app.requireService(WebHostService);
    const rpcService = app.getService(RpcService);

    if (rpcService) {
      webHostService.registerResource(`Websocket RPC`, new WsRpcResource(app, "/rpc:ws", webHostService.getAuthConfig()));
    }
    await webHostService.listen();
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
