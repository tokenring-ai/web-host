import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import z from "zod";

export const WebHostAuthConfigSchema = z.object({
  users: z
    .record(
      z.string(),
      z.object({
        password: z.string().meta({ sensitive: true, description: "Password for login auth (min 8 characters recommended)" } satisfies ConfigFieldMeta),
      }),
    )
    .meta({ label: "Users", description: "Accounts allowed to access the web UI, keyed by username" } satisfies ConfigFieldMeta),
});
export type WebHostAuthConfig = z.input<typeof WebHostAuthConfigSchema>;
export type ParsedWebHostAuthConfig = z.output<typeof WebHostAuthConfigSchema>;

/** PEM content or path to a cert/key file. Paths are resolved when the server starts. */
export const WebHostTlsConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .default(false)
      .meta({ restartRequired: true, description: "Enable HTTPS/TLS for the web host" } satisfies ConfigFieldMeta),
    certificate: z.string().meta({
      restartRequired: true,
      description: "TLS certificate as a file path or PEM string",
      uiType: "multilineText",
    } satisfies ConfigFieldMeta),
    privateKey: z.string().meta({
      restartRequired: true,
      sensitive: true,
      description: "TLS private key as a file path or PEM string",
      uiType: "multilineText",
    } satisfies ConfigFieldMeta),
    passphrase: z
      .string()
      .exactOptional()
      .meta({ sensitive: true, description: "Passphrase for an encrypted private key" } satisfies ConfigFieldMeta),
    ca: z
      .string()
      .exactOptional()
      .meta({
        description: "Optional CA certificate (file path or PEM) for client verification / intermediate chains",
        uiType: "multilineText",
      } satisfies ConfigFieldMeta),
  })
  .meta({ label: "TLS", advanced: true, description: "HTTPS certificate and private key" } satisfies ConfigFieldMeta);

export type WebHostTlsConfig = z.input<typeof WebHostTlsConfigSchema>;
export type ParsedWebHostTlsConfig = z.output<typeof WebHostTlsConfigSchema>;

export const WebHostWebSocketKeepaliveSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .meta({ description: "Send WebSocket protocol-level ping frames to keep connections alive" } satisfies ConfigFieldMeta),
    interval: z
      .number()
      .int()
      .min(1000)
      .default(30_000)
      .meta({ description: "Milliseconds between server-initiated ping frames" } satisfies ConfigFieldMeta),
  })
  .default({ enabled: true, interval: 30_000 })
  .meta({ label: "WebSocket keepalive", advanced: true } satisfies ConfigFieldMeta);

export const WebHostWebSocketConfigSchema = z
  .object({
    keepalive: WebHostWebSocketKeepaliveSchema,
  })
  .default({ keepalive: { enabled: true, interval: 30_000 } })
  .meta({ label: "WebSocket", advanced: true, description: "WebSocket connection behaviour" } satisfies ConfigFieldMeta);

export type ParsedWebHostWebSocketConfig = z.output<typeof WebHostWebSocketConfigSchema>;

export const WebHostConfigSchema = z
  .object({
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
    auth: WebHostAuthConfigSchema.meta({
      label: "Authentication",
      description: "Username/password credentials required for WebSocket RPC login",
    } satisfies ConfigFieldMeta),
    tls: WebHostTlsConfigSchema.exactOptional(),
    websocket: WebHostWebSocketConfigSchema,
  })
  .meta({ label: "Web Host", description: "Built-in HTTP server for the web UI and RPC API" } satisfies ConfigFieldMeta);

export type WebHostConfig = z.input<typeof WebHostConfigSchema>;
export type ParsedWebHostConfig = z.output<typeof WebHostConfigSchema>;
