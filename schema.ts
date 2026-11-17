import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import z from "zod";

export const UserRoleSchema = z.enum(["admin", "member"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const WebHostAuthConfigSchema = z.object({
  users: z
    .record(
      z.string(),
      z.object({
        password: z.string().meta({
          sensitive: true,
          description:
            "Password for login auth (min 8 characters recommended). May be plaintext or a `sha256:<hex digest>` digest so the raw password never appears in config.",
        } satisfies ConfigFieldMeta),
        role: UserRoleSchema.default("admin").meta({
          description:
            "admin can change settings, secrets and users; member cannot. A member is a trust level, not a sandbox: agents still run with the server's permissions.",
        } satisfies ConfigFieldMeta),
      }),
    )
    .default({})
    .meta({
      label: "Users",
      description: "Accounts defined in configuration, keyed by username. Accounts created in the web UI are stored separately.",
    } satisfies ConfigFieldMeta),
  sessionDays: z
    .number()
    .int()
    .min(1)
    .max(90)
    .default(7)
    .meta({ description: "Days a sign-in stays valid without use (it renews while the app is in use)" } satisfies ConfigFieldMeta),
  usersFile: z
    .string()
    .exactOptional()
    .meta({
      advanced: true,
      restartRequired: true,
      description: "File holding accounts, access links and sign-ins created in the web UI (mode 0600). Unset keeps them in memory only.",
    } satisfies ConfigFieldMeta),
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

function isPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

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
    publicUrl: z
      .string()
      .refine(isPublicUrl, "Must be an http(s) URL without a username, password, query or fragment, such as https://tokenring.example.com")
      .exactOptional()
      .meta({
        description:
          "The address people outside this machine use to reach the app (needed behind Docker port mappings and reverse proxies). Used for access links and QR codes.",
      } satisfies ConfigFieldMeta),
    printAccessLink: z
      .boolean()
      .default(false)
      .meta({
        advanced: true,
        description: "At startup, when run from a terminal on a network-reachable address, print a one-time admin sign-in link and QR code",
      } satisfies ConfigFieldMeta),
    auth: WebHostAuthConfigSchema.default({ users: {}, sessionDays: 7 }).meta({
      label: "Authentication",
      description: "Username/password credentials required for WebSocket RPC login",
    } satisfies ConfigFieldMeta),
    tls: WebHostTlsConfigSchema.exactOptional(),
    websocket: WebHostWebSocketConfigSchema,
  })
  .meta({ label: "Web Host", description: "Built-in HTTP server for the web UI and RPC API" } satisfies ConfigFieldMeta);

export type WebHostConfig = z.input<typeof WebHostConfigSchema>;
export type ParsedWebHostConfig = z.output<typeof WebHostConfigSchema>;
