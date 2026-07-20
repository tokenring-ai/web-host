export type { WsRPCClientAuth } from "./createWsRPCClient.ts";
export { default as createWsRPCClient } from "./createWsRPCClient.ts";
export {
  default as SPAResource,
  FallbackResourceConfigSchema,
} from "./FallbackResource.ts";
export {
  default as StaticResource,
  staticResourceConfigSchema,
} from "./StaticResource.ts";
export type { ParsedWebHostAuthConfig, ParsedWebHostConfig } from "./schema.ts";
export { WebHostAuthConfigSchema, WebHostConfigSchema } from "./schema.ts";
export type { WebResource } from "./types.ts";

import WebHostService from "./WebHostService.ts";

export { WebHostService };
export default WebHostService;
export { default as WsRpcResource } from "./WsRpcResource.ts";
