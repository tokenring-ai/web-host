import z from "zod";

export const AuthConfigSchema = z.object({
  users: z.record(z.string(), z.object({
    password: z.string().optional(),
    bearerToken: z.string().optional(),
  }))
});
export type ParsedAuthConfig = z.output<typeof AuthConfigSchema>;

export const WebHostConfigSchema = z.object({
  autoStart: z.boolean().default(false),
  host: z.string().default("127.0.0.1"),
  port: z.number().default(0),
  auth: AuthConfigSchema.optional(),
}).prefault({});

export type ParsedWebHostConfig = z.output<typeof WebHostConfigSchema>;