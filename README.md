# @tokenring-ai/web-host

Bun-based web hosting service for TokenRing applications, providing a pluggable system for serving web resources, static
content, SPAs, and JSON-RPC APIs.

## Overview

The `@tokenring-ai/web-host` package serves as the web foundation for TokenRing applications. It provides a
high-performance web server built on **Bun.serve** with a resource registration system that allows different packages to
extend web functionality through plugins. The package supports static file serving, SPA routing, WebSocket RPC, and
username/password authentication for RPC sessions.

## Installation

```bash
bun add @tokenring-ai/web-host
```

## Features

- **High-Performance Server**: Built on Bun.serve for low-latency HTTP and WebSocket handling
- **TLS/HTTPS**: Optional certificate and private key (file path or PEM) for secure deployments
- **Resource Registration System**: Pluggable architecture using KeyedRegistry for web resources
- **Static File Serving**: Serve static files with custom routing prefixes
- **Response Compression**: Automatic Brotli/Gzip for compressible static assets (negotiated via Accept-Encoding)
- **SPA Support**: Single Page Application routing with fallback for client-side navigation
- **WebSocket RPC**: Real-time WebSocket-based RPC with streaming support
- **WebSocket Keepalive**: Protocol-level ping/pong to keep long-lived connections alive through proxies
- **Authentication**: Username/password login over the WebSocket RPC session
- **Plugin Integration**: Seamless integration with TokenRing plugin system
- **Automatic RPC Registration**: Auto-creates WebSocket RPC resource from RpcService endpoints
- **Type Safety**: Full TypeScript support with Zod configuration validation

## Chat Commands

| Command          | Description                               |
|------------------|-------------------------------------------|
| `/webhost show`  | Show web host URL and available resources |
| `/webhost start` | Start the web host server                 |
| `/webhost stop`  | Stop the web host server                  |

### /webhost show

Displays the current web host URL and lists all registered resources.

**Usage:**

```bash
/webhost show
```

**Output:**

```text
Web host running at: http://localhost:3000
Registered resources:
  - static-files
  - spa
```

### /webhost start

Starts the web host server.

**Usage:**

```bash
/webhost start
```

**Output:**

```text
Web host started at: http://localhost:3000
```

### /webhost stop

Stops the web host server.

**Usage:**

```bash
/webhost stop
```

**Output:**

```text
Web host stopped
```

## Tools

This package does not define any tools. Tools are typically used for agent-assisted operations, and the web-host package
focuses on web server functionality rather than agent tools.

## Configuration

### Configuration Schema

```typescript
import { z } from "zod";
import { WebHostAuthConfigSchema, WebHostConfigSchema } from "@tokenring-ai/web-host";

type WebHostAuthConfig = z.input<typeof WebHostAuthConfigSchema>;
type ParsedWebHostAuthConfig = z.output<typeof WebHostAuthConfigSchema>;
type ParsedWebHostConfig = z.output<typeof WebHostConfigSchema>;
```

### WebHostConfig Schema

```typescript
const WebHostConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().int().min(0).max(65535).default(0),
  auth: WebHostAuthConfigSchema,
  tls: WebHostTlsConfigSchema.exactOptional(),
  websocket: WebHostWebSocketConfigSchema, // defaults applied
});
```

**Configuration Options:**

| Option      | Type             | Required | Default     | Description                                                                     |
|-------------|------------------|----------|-------------|---------------------------------------------------------------------------------|
| `host`      | string           | No       | `127.0.0.1` | Host address to bind to                                                         |
| `port`      | number           | No       | `0`         | Port number. If 0 or not specified, an available port is automatically assigned |
| `auth`      | AuthConfig       | Yes      | -           | **Required.** Username/password credentials for WebSocket RPC login             |
| `tls`       | TlsConfig        | No       | -           | Optional HTTPS/TLS certificate configuration                                    |
| `websocket` | WebSocketConfig  | No       | keepalive on / 30s | WebSocket keepalive (protocol ping/pong)                                 |

### TLS Config Schema

```typescript
const WebHostTlsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  certificate: z.string(),  // file path or PEM
  privateKey: z.string(),   // file path or PEM
  passphrase: z.string().exactOptional(),
  ca: z.string().exactOptional(),
});
```

| Option        | Type    | Description                                              |
|---------------|---------|----------------------------------------------------------|
| `enabled`     | boolean | When `true`, the server listens with HTTPS               |
| `certificate` | string  | TLS certificate as a filesystem path or PEM string       |
| `privateKey`  | string  | TLS private key as a filesystem path or PEM string       |
| `passphrase`  | string  | Optional passphrase for an encrypted private key         |
| `ca`          | string  | Optional CA / intermediate chain (path or PEM)           |

When TLS is enabled, `getURL()` returns an `https://` URL. Changing TLS settings requires a server restart.

### WebSocket Keepalive Config

```typescript
const WebHostWebSocketConfigSchema = z.object({
  keepalive: z.object({
    enabled: z.boolean().default(true),
    interval: z.number().int().min(1000).default(30_000), // ms
  }).default({ enabled: true, interval: 30_000 }),
});
```

| Option               | Type    | Default | Description                                              |
|----------------------|---------|---------|----------------------------------------------------------|
| `keepalive.enabled`  | boolean | `true`  | Send protocol-level WebSocket ping frames on an interval |
| `keepalive.interval` | number  | `30000` | Milliseconds between server-initiated pings              |

Bun also auto-responds to client pings when keepalive is enabled (`sendPings`). Idle connections that stop responding are closed after roughly three missed intervals (minimum 120s).

### AuthConfig Schema

```typescript
const WebHostAuthConfigSchema = z.object({
  users: z.record(
    z.string(),
    z.object({
      password: z.string(),
    }),
  ),
});
```

| Option     | Type   | Description                     |
|------------|--------|---------------------------------|
| `users`    | Record | Map of usernames to credentials |
| `password` | string | Password for that username      |

`auth` is required. Every WebSocket RPC session must authenticate with a username and password before calling other
methods. Authentication is performed with the reserved JSON-RPC method `auth` over the open WebSocket (not HTTP Basic or
Bearer headers).

**Auth request:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "auth",
  "params": {
    "username": "admin",
    "password": "secret123"
  }
}
```

**Auth success:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "authenticated": true,
    "username": "admin"
  }
}
```

**Auth failure / unauthorized:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32001,
    "message": "Invalid username or password"
  }
}
```

Unauthenticated method calls receive error code `-32001` until a successful
`auth` call completes on that WebSocket session.

### StaticResource Config Schema

```typescript
const staticResourceConfigSchema = z.object({
  root: z.string(),
  indexFile: z.string().exactOptional(),
  notFoundFile: z.string().exactOptional(),
  prefix: z.string(),
  headers: z.record(z.string(), z.string()).exactOptional(),
  compress: z.object({
    enabled: z.boolean().default(true),
    minSize: z.number().int().min(0).default(1024),
    algorithms: z.array(z.enum(["gzip", "br"])).default(["br", "gzip"]),
  }).default({}),
});
```

| Option         | Type       | Description                            |
|----------------|------------|----------------------------------------|
| `root`         | string     | Directory path for static files        |
| `indexFile`    | string     | Default index file name                |
| `notFoundFile` | string     | Optional custom 404 page               |
| `prefix`       | string     | URL prefix for this resource           |
| `headers`      | Record     | Extra response headers for all files   |
| `compress`     | object     | Response compression (see below)       |

#### Compression options

| Option                 | Type              | Default           | Description                                                        |
|------------------------|-------------------|-------------------|--------------------------------------------------------------------|
| `compress.enabled`     | boolean           | `true`            | Negotiate Brotli/Gzip for compressible text assets                 |
| `compress.minSize`     | number            | `1024`            | Only compress files at least this many bytes                       |
| `compress.algorithms`  | `("br"\|"gzip")[]`| `["br","gzip"]`   | Preference order; first match accepted by the client is used       |

Compression uses the `Accept-Encoding` request header and sets `Content-Encoding` + `Vary: Accept-Encoding`. Already-compressed formats (images, video, fonts, etc.) are skipped.

### SPAResource Config Schema

```typescript
const spaResourceConfigSchema = z.object({
  type: z.literal("spa"),
  file: z.string(),
  description: z.string(),
  prefix: z.string()
});
```

| Option        | Type    | Description                         |
|---------------|---------|-------------------------------------|
| `type`        | `"spa"` | Discriminator for SPA resource type |
| `file`        | string  | Path to the index.html file         |
| `description` | string  | Human-readable description          |
| `prefix`      | string  | URL prefix for SPA routing          |

### Sample Configuration

```yaml
webHost:
  host: "127.0.0.1"
  port: 3000
  auth:
    users:
      admin:
        password: "secret123"
      user1:
        password: "user-pass-123"
```

## WebSocket RPC Client

Use `createWsRPCClient` to call server RPC methods over `/rpc:ws`. Auth is **required** on both the server and the
client: every connection must log in with username/password before other RPC methods are allowed.

```typescript
import { createWsRPCClient } from "@tokenring-ai/web-host";
import type { RPCSchema } from "@tokenring-ai/rpc/types";

const wsUrl = new URL("/rpc:ws", "http://127.0.0.1:3000");

const client = createWsRPCClient(wsUrl, mySchema, {
  username: "admin",
  password: "secret123",
});

// Auth is sent automatically after the socket opens, before this call.
const result = await client.someMethod({ /* params */ });
```

### Signature

```typescript
function createWsRPCClient<T extends RPCSchema>(
  wsUrl: URL,
  schemas: T,
  auth: { username: string; password: string },
): { [K in keyof T["methods"]]: FunctionTypeOfRPCCall<T, K> };
```

| Argument  | Type                     | Description                                                                                    |
|-----------|--------------------------|------------------------------------------------------------------------------------------------|
| `wsUrl`   | `URL`                    | WebSocket endpoint (typically `/rpc:ws`)                                                       |
| `schemas` | `RPCSchema`              | RPC method schemas for type-safe calls                                                         |
| `auth`    | `{ username, password }` | **Required.** Sent via the `auth` RPC after connect (and after reconnect) before other methods |

Sockets are cached by URL: multiple clients for the same URL share one WebSocket, and a successful login is reused for
that connection.

## License

MIT License - see LICENSE file for details.
