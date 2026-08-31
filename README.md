# @tokenring-ai/web-host

Bun-based web hosting service for TokenRing, providing a pluggable system for serving web resources, static
content, and WebSocket JSON-RPC APIs.

## Overview

The `@tokenring-ai/web-host` package serves as the web foundation for TokenRing applications. It provides a
high-performance web server built on **Bun.serve** with a resource registration system that lets other packages
extend web functionality. A resource is either a set of HTTP routes (`routes`) or WebSocket routes (`wsRoutes`),
and all registered resources are merged into the server when it starts.

The package ships with `StaticResource` (prefix-based static file serving with path safety and response
compression) and `WsRpcResource` (WebSocket JSON-RPC over `/rpc:ws`, proxying every method registered on the
`RpcService`). When the `RpcService` is available, the plugin automatically registers the WebSocket RPC resource
at startup. The package also provides a type-safe WebSocket RPC client, optional TLS/HTTPS, and WebSocket
keepalive based on protocol-level ping frames.

### Key Features

- **High-Performance Server**: Built on Bun.serve for low-latency HTTP and WebSocket handling
- **Resource Registration System**: Pluggable architecture using `KeyedRegistry` for HTTP and WebSocket resources
- **Static File Serving**: Serve static files under a URL prefix with index and custom 404 files
- **Path Safety**: URL decoding, NUL/backslash rejection, path traversal normalization, and symlink containment checks
- **Response Compression**: Automatic Brotli/Gzip for compressible static assets, negotiated via `Accept-Encoding`
- **WebSocket RPC**: Real-time WebSocket-based JSON-RPC with query, mutation, and streaming method support
- **Authentication**: Username/password login over the WebSocket RPC session (required before other methods)
- **WebSocket Keepalive**: Protocol-level ping frames with idle-timeout cleanup
- **TLS/HTTPS**: Optional certificate and private key as a file path or inline PEM
- **Automatic RPC Registration**: Auto-creates the WebSocket RPC resource from `RpcService` endpoints
- **Type Safety**: Full TypeScript support with Zod schema validation

## Installation

```bash
bun add @tokenring-ai/web-host
```

## Chat Commands

| Command          | Description                               |
|------------------|-------------------------------------------|
| `/webhost show`  | Show web host URL and available resources |

### /webhost show

Displays the current web host URL and lists all registered resources.

**Usage:**

```bash
/webhost show
```

**Output:**

```text
Web host running at: http://127.0.0.1:3000
Registered resources:
 - Websocket RPC
 - static
```

When no resources are registered, the command outputs:

```text
Web host running at: http://127.0.0.1:3000
No resources registered
```

The registered resources listed are the names of the resources currently registered on the `WebHostService`
(registered keys of the `KeyedRegistry`), formatted as a markdown list.

## Tools

This package does not define any tools. Tools are typically used for agent-assisted operations, and the web-host
package focuses on web server functionality rather than agent tools.

## Configuration

The plugin's configuration lives under the `webHost` key. All schemas are exported from `@tokenring-ai/web-host`.

```typescript
import { z } from "zod";
import {
  WebHostAuthConfigSchema,
  WebHostConfigSchema,
  WebHostTlsConfigSchema,
  WebHostWebSocketConfigSchema,
} from "@tokenring-ai/web-host";

type ParsedWebHostConfig = z.output<typeof WebHostConfigSchema>;
type ParsedWebHostAuthConfig = z.output<typeof WebHostAuthConfigSchema>;
type ParsedWebHostTlsConfig = z.output<typeof WebHostTlsConfigSchema>;
type ParsedWebHostWebSocketConfig = z.output<typeof WebHostWebSocketConfigSchema>;
```

### WebHostConfig

```typescript
const WebHostConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().int().min(0).max(65535).default(0),
  auth: WebHostAuthConfigSchema, // required
  tls: WebHostTlsConfigSchema.exactOptional(),
  websocket: WebHostWebSocketConfigSchema, // default { keepalive: { enabled: true, interval: 30_000 } }
});
```

| Field       | Type                   | Required | Default                                   | Description                                                    |
|-------------|------------------------|----------|-------------------------------------------|----------------------------------------------------------------|
| `host`      | string                 | No       | `127.0.0.1`                               | Interface the HTTP server binds to (`0.0.0.0` exposes it to the network) |
| `port`      | number                 | No       | `0`                                       | Port the HTTP server listens on (`0` picks a random free port) |
| `auth`      | WebHostAuthConfig      | Yes      | —                                         | Username/password credentials required for WebSocket RPC login |
| `tls`       | WebHostTlsConfig       | No       | —                                         | Optional HTTPS/TLS certificate configuration                   |
| `websocket` | WebHostWebSocketConfig | No       | `{ keepalive: { enabled: true, interval: 30_000 } }` | WebSocket connection behaviour (keepalive) |

#### WebHostConfig schema metadata

The `.meta()` annotations used for configuration UI integration:

| Field       | Metadata                                                                              |
|-------------|---------------------------------------------------------------------------------------|
| (top level) | label `Web Host`, description "Built-in HTTP server for the web UI and RPC API"        |
| `host`      | `restartRequired: true`                                                               |
| `port`      | `restartRequired: true`                                                               |
| `auth`      | label `Authentication`, description "Username/password credentials required for WebSocket RPC login" |
| `tls`       | (group) label `TLS`, `advanced: true`, description "HTTPS certificate and private key" |
| `websocket` | (group) label `WebSocket`, `advanced: true`, description "WebSocket connection behaviour" |

#### Sample configuration

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
  websocket:
    keepalive:
      enabled: true
      interval: 30000
```

### Authentication (WebHostAuthConfig)

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

| Field      | Type                                | Description                                              |
|------------|-------------------------------------|----------------------------------------------------------|
| `users`    | `Record<string, { password: string }>` | Accounts allowed to access the web UI, keyed by username |
| `password` | string                              | Password for login auth (min 8 characters recommended)   |

`auth` is **required**. Every WebSocket RPC session must authenticate with a username and password before calling
other methods. Authentication is performed with the reserved JSON-RPC method `auth` over the open WebSocket (not
HTTP Basic or Bearer headers).

#### Auth schema metadata

| Field      | Metadata                                                        |
|------------|-----------------------------------------------------------------|
| `users`    | label `Users`, description "Accounts allowed to access the web UI, keyed by username" |
| `password` | `sensitive: true`                                               |

### TLS (WebHostTlsConfig)

```typescript
const WebHostTlsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  certificate: z.string(), // file path or PEM
  privateKey: z.string(),  // file path or PEM
  passphrase: z.string().exactOptional(),
  ca: z.string().exactOptional(),
});
```

| Field         | Type    | Required | Default | Description                                                                       |
|---------------|---------|----------|---------|-----------------------------------------------------------------------------------|
| `enabled`     | boolean | No       | `false` | Enable HTTPS/TLS for the web host                                                 |
| `certificate` | string  | Yes*     | —       | TLS certificate as a file path or PEM string                                      |
| `privateKey`  | string  | Yes*     | —       | TLS private key as a file path or PEM string                                      |
| `passphrase`  | string  | No       | —       | Passphrase for an encrypted private key                                           |
| `ca`          | string  | No       | —       | Optional CA certificate (file path or PEM) for client verification / intermediate chains |

\* When `enabled` is `true`, `certificate` and `privateKey` are required (`enabled: false` short-circuits TLS
construction). Values may be inline PEM (detected by `-----BEGIN`) or filesystem paths; paths are resolved to
`Bun.file` and must exist when the server starts, or `buildTlsOptions` throws.

When TLS is enabled, `getURL()` returns an `https://` URL. Changing TLS settings requires a server restart.

#### TLS schema metadata

| Field         | Metadata                                                                        |
|---------------|---------------------------------------------------------------------------------|
| (top level)   | label `TLS`, `advanced: true`, description "HTTPS certificate and private key"   |
| `enabled`     | `restartRequired: true`, description "Enable HTTPS/TLS for the web host"         |
| `certificate` | `restartRequired: true`, description "TLS certificate as a file path or PEM string", `uiType: "multilineText"` |
| `privateKey`  | `restartRequired: true`, `sensitive: true`, `uiType: "multilineText"`            |
| `passphrase`  | `sensitive: true`, description "Passphrase for an encrypted private key"         |
| `ca`          | description "Optional CA certificate (file path or PEM) for client verification / intermediate chains", `uiType: "multilineText"` |

### WebSocket keepalive (WebHostWebSocketConfig)

```typescript
const WebHostWebSocketKeepaliveSchema = z
  .object({
    enabled: z.boolean().default(true),
    interval: z.number().int().min(1000).default(30_000), // ms
  })
  .default({ enabled: true, interval: 30_000 });

const WebHostWebSocketConfigSchema = z
  .object({
    keepalive: WebHostWebSocketKeepaliveSchema,
  })
  .default({ keepalive: { enabled: true, interval: 30_000 } });
```

| Option                | Type    | Default  | Description                                                   |
|-----------------------|---------|----------|---------------------------------------------------------------|
| `keepalive.enabled`   | boolean | `true`   | Send WebSocket protocol-level ping frames to keep connections alive |
| `keepalive.interval`  | number  | `30000`  | Milliseconds between server-initiated ping frames             |

`WebHostService` sends protocol-level ping frames to every connected socket on `interval`. Bun is configured with
`sendPings` (which auto-handles pong replies / idle detection) and an `idleTimeout` of
`max(120s, interval × 3)`; idle connections that stop responding are closed after roughly three missed intervals
(minimum 120s).

#### Keepalive schema metadata

| Field               | Metadata                                                        |
|---------------------|-----------------------------------------------------------------|
| (keepalive group)   | label `WebSocket keepalive`, `advanced: true`                   |
| `keepalive.enabled` | description "Send WebSocket protocol-level ping frames to keep connections alive" |
| `keepalive.interval`| description "Milliseconds between server-initiated ping frames" |

## Core Components

### WebHostService

The main service that manages the server lifecycle and resource registration. It implements `TokenRingService`.

```typescript
class WebHostService implements TokenRingService {
  readonly name = "WebHostService";
  description = "Bun web host for serving resources and APIs";

  constructor(app: TokenRingApp, config?: WebHostConfig | ParsedWebHostConfig);
}
```

**Properties:**

| Property             | Type                     | Description                                                          |
|----------------------|--------------------------|----------------------------------------------------------------------|
| `name`               | string                   | Service name (`WebHostService`)                                      |
| `description`        | string                   | Service description ("Bun web host for serving resources and APIs")  |
| `resources`          | `KeyedRegistry<WebResource>` | Registry of registered web resources                             |
| `registerResource`   | `(name, resource) => void` | Register a web resource (bound `resources.set`)                    |
| `getResourceEntries` | `() => Iterable<[string, WebResource]>` | All registered resources (bound `resources.entriesArray`) |

**Methods:**

| Method       | Signature                          | Description                                                                                                      |
|--------------|------------------------------------|------------------------------------------------------------------------------------------------------------------|
| `listen`     | `async listen(): Promise<void>`    | Start (or reload) the Bun server with all registered resources, then start the keepalive timer. Logs `Web Host listening at <url>` on first bind |
| `reconfigure`| `async reconfigure(config: WebHostConfig \| ParsedWebHostConfig): Promise<void>` | Parse and store the config; if a server is currently listening, stop it and re-`listen()`. A no-op when the parsed config is deep-equal to the current one |
| `stop`       | `async stop(): Promise<void>`      | Stop the keepalive timer, clear tracked sockets, and stop the server if running                                  |
| `getURL`     | `getURL(): URL`                    | The server's URL (Bun's `server.url`, so the scheme reflects TLS). Throws `ConfigurationError("Server not started")` when not listening |
| `getAuthConfig` | `getAuthConfig(): ParsedWebHostConfig["auth"]` | The configured auth object used by the WebSocket RPC resource                                          |

Behavior notes:

- `listen()` merges each resource's `routes` into the Bun `routes` table and each resource's `wsRoutes` into the
  WebSocket handler table. Non-WebSocket requests that match no route return `404 Not Found`.
- When a server is already running, `listen()` calls `server.reload({ routes, fetch, websocket })` — port, host,
  and TLS are not changed (changing those requires a `reconfigure`-triggered restart).
- `reconfigure()` only restarts the server if it is already listening; the first bind happens in the plugin's
  `start` phase.

### StaticResource

Serves static files from a directory under a URL prefix. Implements `WebResource`.

```typescript
class StaticResource implements WebResource {
  routes: NonNullable<WebResource["routes"]>;

  constructor(config: StaticResourceConfig);
}
```

The config is validated with `staticResourceConfigSchema`:

```typescript
const staticResourceConfigSchema = z.object({
  root: z.string(),
  indexFile: z.string().exactOptional(),
  notFoundFile: z.string().exactOptional(),
  prefix: z.string(),
  headers: z.record(z.string(), z.string()).exactOptional(),
  compress: z
    .object({
      enabled: z.boolean().default(true),
      minSize: z.number().int().min(0).default(1024),
      algorithms: z.array(z.enum(["gzip", "br"])).default(["br", "gzip"]),
    })
    .default({ enabled: true, minSize: 1024, algorithms: ["br", "gzip"] }),
});
```

| Option          | Type       | Required | Default                       | Description                                       |
|-----------------|------------|----------|-------------------------------|---------------------------------------------------|
| `root`          | string     | Yes      | —                             | Directory path for static files                   |
| `indexFile`     | string     | No       | —                             | Default index file name for directory requests    |
| `notFoundFile`  | string     | No       | —                             | Optional custom 404 page (served relative to root)|
| `prefix`        | string     | Yes      | —                             | URL prefix for this resource (e.g. `/static`)     |
| `headers`       | Record     | No       | —                             | Extra response headers for all files              |
| `compress`      | object     | No       | `{ enabled: true, minSize: 1024, algorithms: ["br", "gzip"] }` | Response compression (below)      |

Behavior:

- Only `GET` and `HEAD` are served; other methods return `405 Method Not Allowed` with `Allow: GET, HEAD`.
- Only files within (or at) `root` are served. Paths are `decodeURIComponent`-decoded, path traversal is
  normalized, `..` escapes return `403 Forbidden`, and NUL bytes or backslashes return `400 Bad Request`.
  Symlinks are resolved with `realpath` and re-checked against the root, so a symlink pointing outside the root is
  not served. Only regular files are served.
- A request whose path ends in `/` is served from `indexFile` when configured.
- Non-matching or missing files fall back to `notFoundFile` (a custom 404 page) or a plain `404 Not Found`.

#### Compression

| Option                    | Type                | Default              | Description                                                  |
|---------------------------|---------------------|----------------------|--------------------------------------------------------------|
| `compress.enabled`        | boolean             | `true`               | Negotiate Brotli/Gzip for compressible text assets            |
| `compress.minSize`        | number              | `1024`               | Only compress files at least this many bytes                  |
| `compress.algorithms`     | `("br" \| "gzip")[]` | `["br", "gzip"]`     | Preference order; first match accepted by the client is used  |

Compression is negotiated against the `Accept-Encoding` request header (honoring `q` values and the `*`
wildcard) and sets `Content-Encoding` plus `Vary: Accept-Encoding`. Only compressible extensions are considered
(`.css`, `.csv`, `.htm`, `.html`, `.js`, `.json`, `.map`, `.mjs`, `.cjs`, `.md`, `.svg`, `.txt`, `.xml`,
`.yaml`, `.yml`, `.ts`, `.tsx`, `.jsx`); already-compressed formats (images, video, fonts, archives, wasm) are
skipped. `HEAD` responses include a compressed `Content-Length` without a body.

### WsRpcResource

Provides WebSocket JSON-RPC over a single endpoint (default `/rpc:ws`). It proxies every method registered on the
`RpcService` and enforces username/password authentication per connection. Implements `WebResource`.

```typescript
class WsRpcResource implements WebResource {
  wsRoutes: Record<string, WebSocketHandler>;

  constructor(app: TokenRingApp, jsonRpcEndpoint: string, auth: ParsedWebHostAuthConfig);
}
```

See the [RPC](#rpc) section for the wire protocol, authentication flow, and error codes.

### createWsRPCClient

Type-safe WebSocket RPC client for calling server methods over a WebSocket endpoint. It authenticates with the
given username/password after the socket opens (and after reconnects) before any other method calls.

```typescript
function createWsRPCClient<T extends RPCSchema>(
  wsUrl: URL,
  schemas: T,
  auth: WsRPCClientAuth, // { username: string; password: string }
): { [K in keyof T["methods"]]: FunctionTypeOfRPCCall<T, K> };
```

| Argument  | Type                          | Description                                                                                  |
|-----------|-------------------------------|----------------------------------------------------------------------------------------------|
| `wsUrl`   | `URL`                         | WebSocket endpoint (typically `http://127.0.0.1:3000/rpc:ws`)                                |
| `schemas` | `RPCSchema`                   | RPC method schemas (`name`, `path`, `methods`) for type-safe calls                            |
| `auth`    | `{ username: string; password: string }` | Credentials sent via the `auth` RPC method after connect (and after reconnect) |

**Behavior:**

- Sockets are cached by URL: multiple clients for the same URL share one WebSocket, and a successful login is
  reused for that connection. Closed sockets are replaced (and re-authenticated) transparently on the next call.
- Query/mutation methods return a promise; stream methods return an async generator that can be cancelled with an
  `AbortSignal`.
- Method names on the wire are `${schemas.path}.${methodName}` (matching how `RpcService` registers methods).
- Auth failures reject pending calls with an `RPCError` (`code === -32001`). A UI hook can be registered with
  `setWsRPCAuthHandler({ onAuthRequired, onAuthSuccess })` to supply new credentials interactively; when a handler
  resolves, authentication is retried with the re-read `auth` object.

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

### Resource types

```typescript
export interface WebResource {
  routes?: Serve.RoutesWithUpgrade<Context, string>;
  wsRoutes?: Record<string, WebSocketHandler>;
}

export interface WebSocketHandler {
  open?(ws: BunWebSocket): void;
  close?(ws: BunWebSocket): void;
  message?(ws: BunWebSocket, message: string | Buffer): void;
  ping?(ws: BunWebSocket, data: Buffer): void;   // protocol-level ping received
  pong?(ws: BunWebSocket, data: Buffer): void;   // protocol-level pong received
}
```

`BunWebSocket` wraps a Bun server socket with `send(data: string | object)`, `close()`, optional `ping()` /
`pong()`, and the socket `data` payload. Resources with `routes` contribute HTTP routes; resources with
`wsRoutes` contribute WebSocket upgrade handlers keyed by path.

## Services & Plugin Lifecycle

### Service registration

The plugin registers `WebHostService` during install. Plugins are installed through `PluginManager`:

```typescript
import TokenRingApp from "@tokenring-ai/app";
import PluginManager from "@tokenring-ai/app/PluginManager";
import webHostPackage from "@tokenring-ai/web-host";

const app = new TokenRingApp({ /* ... */ });
const pluginManager = app.addService(new PluginManager(app));
await pluginManager.installPlugins([webHostPackage]);
```

The plugin's config is read from the `webHost` key of the app config.

### Plugin lifecycle

The web-host plugin defines no agent lifecycle hooks; its plugin-level lifecycle is:

| Phase        | What it does                                                                                                    |
|--------------|------------------------------------------------------------------------------------------------------------------|
| `install`    | Adds `WebHostService` to the app. When `AgentCommandService` is available, registers the agent commands (currently `/webhost show`) |
| `reconfigure`| Calls `WebHostService.reconfigure(config.webHost)` — updates the config and, if the server is already listening, stops and restarts it. No-op when the config is unchanged |
| `start`      | If `RpcService` is present, registers a `WsRpcResource` named `Websocket RPC` at `/rpc:ws` using the auth config; then calls `WebHostService.listen()` |

#### Lifecycle method details

- `install(app)` — `app.addService(new WebHostService(app))`, then
  `app.waitForService(AgentCommandService, service => service.addAgentCommands(commands))`.
- `reconfigure(app, config)` — `await app.requireService(WebHostService).reconfigure(config.webHost)`. `webHost`
  config changes propagate live: when already listening, the server is stopped and re-created with the new host,
  port, TLS, and keepalive settings.
- `start(app)` — `webHostService.registerResource("Websocket RPC", new WsRpcResource(app, "/rpc:ws", webHostService.getAuthConfig()))`
  when `app.getService(RpcService)` is present, then `await webHostService.listen()`.

## RPC

The plugin exposes a single WebSocket JSON-RPC endpoint at `/rpc:ws` (registered under the resource name
`Websocket RPC`). Any method registered on the `RpcService` is callable over this socket; method names use the
`${endpoint.path}.${methodName}` key format used by `RpcService`.

**Authentication:** the `auth` method is reserved for login and is sent over the socket (not via HTTP headers).
A session must authenticate before calling any other method.

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

Unauthenticated method calls receive error code `-32001` ("Unauthorized. Call auth with username and password
first.") until a successful `auth` call completes on that WebSocket session.

**Method types** (`query`, `mutation`, `stream`) are dispatched per `RpcService` method metadata:

- `query` / `mutation` methods return a single JSON-RPC `result` (validated against the method's `resultSchema`).
- `stream` methods emit one JSON-RPC `result` message per yielded event, terminated by
  `{ "jsonrpc": "2.0", "id", "result": null, "stream": "end" }`. Streams are aborted via the per-connection
  `AbortController` (triggered when the socket closes); a stream failure sends a `-32603` error without closing the
  socket.

**JSON-RPC error codes:**

| Code    | Description                                                                                |
|---------|--------------------------------------------------------------------------------------------|
| `-32700`| Parse error (payload is not valid JSON)                                                    |
| `-32600`| Invalid Request (wrong JSON-RPC version)                                                   |
| `-32601`| Method not found                                                                           |
| `-32001`| Invalid username/password, or method called before authenticating                          |
| `-32603`| Internal error (schema validation or execution failure)                                    |

## Dependencies

| Package             | Purpose                                                                 |
|---------------------|-------------------------------------------------------------------------|
| `@tokenring-ai/app` | `TokenRingPlugin` / `TokenRingService` interfaces and app integration   |
| `@tokenring-ai/agent`| `AgentCommandService` registration for the `/webhost show` command      |
| `@tokenring-ai/utility` | `KeyedRegistry`, `EnhancedStringMap`, `deepEqual` utilities          |
| `@tokenring-ai/rpc` | `RpcService`-backed WebSocket RPC dispatch and client typing            |
| `zod`               | Configuration and JSON-RPC schema validation                            |

## Testing

```bash
bun test
```

The suite covers static file compression negotiation and path safety (`StaticResource.test.ts`), compression
helpers and compressible extensions (`compression.test.ts`), TLS material resolution (`tls.test.ts`),
`WebHostService` lifecycle, keepalive, and resource registration (`WebHostService.test.ts`), and end-to-end
resource/RPC integration (`integration.test.ts`).

## License

MIT License — see LICENSE file for details.
