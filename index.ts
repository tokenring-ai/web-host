import {z} from "zod";
import {AuthConfigSchema} from "./auth.ts";
import {spaResourceConfigSchema} from "./SPAResource.ts";
import {staticResourceConfigSchema} from "./StaticResource.ts";

export const WebHostConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().optional(),
  auth: AuthConfigSchema.optional(),
  resources: z.record(z.string(), z.discriminatedUnion("type", [
    staticResourceConfigSchema,
    spaResourceConfigSchema,
  ])).optional(),
})


export {default as WebHostService} from "./WebHostService.js";
export {default as StaticResource} from "./StaticResource.js";
export type {WebResource} from "./types.js";
