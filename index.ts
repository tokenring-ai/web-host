export {default as createJsonRPCClient} from "./createJsonRPCClient.ts";
export {default as createWsRPCClient} from "./createWsRPCClient.ts";
export {default as JsonRpcResource} from "./JsonRpcResource.ts";
export {
  default as SPAResource,
  spaResourceConfigSchema,
} from "./SPAResource.ts";
export {
  default as StaticResource,
  staticResourceConfigSchema,
} from "./StaticResource.ts";
export type {ParsedAuthConfig, ParsedWebHostConfig} from "./schema.ts";
export {AuthConfigSchema, WebHostConfigSchema} from "./schema.ts";
export type {WebResource} from "./types.ts";
export {default as WebHostService} from "./WebHostService.ts";
export {default as WsRpcResource} from "./WsRpcResource.ts";
