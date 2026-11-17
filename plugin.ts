import { AgentCommandService } from "@tokenring-ai/agent";
import type { TokenRingPlugin } from "@tokenring-ai/app";
import { RpcService } from "@tokenring-ai/rpc";

import { z } from "zod";
import commands from "./commands.ts";
import packageJSON from "./package.json" with { type: "json" };
import usersRpc from "./rpc/users.ts";
import { WebHostConfigSchema } from "./schema.ts";
import { printStartupAccessBanner } from "./startupAccess.ts";
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
    app.addService(WebHostService, new WebHostService(app));

    app.waitForService(AgentCommandService, service => {
      service.addAgentCommands(commands);
    });
    app.waitForService(RpcService, service => {
      service.registerEndpoint(usersRpc);
    });
  },
  async reconfigure(app, config) {
    await app.requireService(WebHostService).reconfigure(config.webHost);
  },
  async start(app) {
    const webHostService = app.requireService(WebHostService);
    const rpcService = app.getService(RpcService);

    if (rpcService) {
      webHostService.registerResource(`Websocket RPC`, new WsRpcResource(app, "/rpc:ws", () => webHostService.getAuthConfig(), webHostService.users));
    }
    await webHostService.listen();

    if (webHostService.printAccessLink) {
      await printStartupAccessBanner({
        users: webHostService.users,
        host: webHostService.listenHost,
        port: webHostService.listenPort,
        tls: webHostService.usesTls,
        publicUrl: webHostService.getConfiguredPublicUrl(),
        isTTY: process.stdout.isTTY === true,
        write: text => void process.stdout.write(text),
      });
    }
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
