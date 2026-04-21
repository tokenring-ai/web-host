import z from "zod";

export const WebHostAuthConfigSchema = z.object({
  users: z.record(
    z.string(),
    z.object({
      password: z.string().exactOptional(),
      bearerToken: z.string().exactOptional(),
    }),
  ),
});
export type WebHostAuthConfig = z.input<typeof WebHostAuthConfigSchema>;
export type ParsedWebHostAuthConfig = z.output<typeof WebHostAuthConfigSchema>;

export const WebHostConfigSchema = z
  .object({
    autoStart: z.boolean().default(false),
    host: z.string().default("127.0.0.1"),
    port: z.number().default(0),
    auth: WebHostAuthConfigSchema.exactOptional(),
  })
  .prefault({});

export type ParsedWebHostConfig = z.output<typeof WebHostConfigSchema>;
