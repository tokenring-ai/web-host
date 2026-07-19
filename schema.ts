import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import z from "zod";

export const WebHostAuthConfigSchema = z.object({
  users: z
    .record(
      z.string(),
      z.object({
        password: z
          .string()
          .exactOptional()
          .meta({ sensitive: true, description: "Password for HTTP basic/login auth (min 8 characters recommended)" } satisfies ConfigFieldMeta),
        bearerToken: z
          .string()
          .exactOptional()
          .meta({ sensitive: true, description: "Bearer token for API access (min 8 characters recommended)" } satisfies ConfigFieldMeta),
      }),
    )
    .meta({ label: "Users", description: "Accounts allowed to access the web UI, keyed by username" } satisfies ConfigFieldMeta),
});
export type WebHostAuthConfig = z.input<typeof WebHostAuthConfigSchema>;
export type ParsedWebHostAuthConfig = z.output<typeof WebHostAuthConfigSchema>;

export const WebHostConfigSchema = z
  .object({
    autoStart: z
      .boolean()
      .default(false)
      .meta({ description: "Start the HTTP server when the app launches" } satisfies ConfigFieldMeta),
    host: z
      .string()
      .default("127.0.0.1")
      .meta({ restartRequired: true, description: "Interface the HTTP server binds to (0.0.0.0 exposes it to the network)" } satisfies ConfigFieldMeta),
    port: z
      .number()
      .int()
      .min(0)
      .max(65535)
      .default(0)
      .meta({ restartRequired: true, description: "Port the HTTP server listens on (0 picks a random free port)" } satisfies ConfigFieldMeta),
    auth: WebHostAuthConfigSchema.exactOptional().meta({
      label: "Authentication",
      description: "Require login for the web UI and API",
    } satisfies ConfigFieldMeta),
  })
  .prefault({})
  .meta({ label: "Web Host", description: "Built-in HTTP server for the web UI and RPC API" } satisfies ConfigFieldMeta);

export type ParsedWebHostConfig = z.output<typeof WebHostConfigSchema>;
