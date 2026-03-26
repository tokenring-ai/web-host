import z from "zod";
import {spaResourceConfigSchema} from "./SPAResource.ts";
import {staticResourceConfigSchema} from "./StaticResource.ts";

export const AuthConfigSchema = z.object({
  users: z.record(z.string(), z.object({
    password: z.string().optional(),
    bearerToken: z.string().optional(),
  }))
});
export type ParsedAuthConfig = z.output<typeof AuthConfigSchema>;

export const WebHostConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().default(0),
  auth: AuthConfigSchema.optional(),
  resources: z.record(z.string(), z.discriminatedUnion("type", [
    staticResourceConfigSchema,
    spaResourceConfigSchema,
  ])).optional(),
});

export type ParsedWebHostConfig = z.output<typeof WebHostConfigSchema>;