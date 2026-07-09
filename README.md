# @tokenring-ai/web-host

Bun-based web hosting service for TokenRing applications, providing a
pluggable system for serving web resources, static content, SPAs, and
JSON-RPC APIs.

## Overview

The `@tokenring-ai/web-host` package serves as the web foundation for
TokenRing applications. It provides a high-performance web server built on
**Bun.serve** with a resource registration system that allows different
packages to extend web functionality through plugins. The package supports
static file serving, SPA routing, WebSocket RPC, and authentication.

## Installation

```bash
bun add @tokenring-ai/web-host
```

## Features

- **High-Performance Server**: Built on Bun.serve for low-latency HTTP and
  WebSocket handling
- **Resource Registration System**: Pluggable architecture using KeyedRegistry
  for web resources
- **Static File Serving**: Serve static files with custom routing prefixes
- **SPA Support**: Single Page Application routing with fallback for
  client-side navigation
- **WebSocket RPC**: Real-time WebSocket-based RPC with streaming support
- **Authentication**: Basic and Bearer token authentication with per-user
  credentials
- **Plugin Integration**: Seamless integration with TokenRing plugin system
- **Automatic RPC Registration**: Auto-creates WebSocket RPC resource from
  RpcService endpoints
- **Type Safety**: Full TypeScript support with Zod configuration validation

## Chat Commands

| Command | Description |
|---------|-------------|
| `/webhost show` | Show web host URL and available resources |
| `/webhost start` | Start the web host server |
| `/webhost stop` | Stop the web host server |

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

This package does not define any tools. Tools are typically used for
agent-assisted operations, and the web-host package focuses on web server
functionality rather than agent tools.

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
const WebHostConfigSchema = z
  .object({
    autoStart: z.boolean().default(false),
    host: z.string().default("127.0.0.1"),
    port: z.number().default(0),
    auth: WebHostAuthConfigSchema.exactOptional(),
  })
  .prefault({});
```

**Configuration Options:**

| Option      | Type       | Required | Default       | Description                                                                     |
|-------------|------------|----------|---------------|---------------------------------------------------------------------------------|
| `autoStart` | boolean    | No       | `false`       | Whether to automatically start the server when plugin starts                    |
| `host`      | string     | No       | `127.0.0.1`   | Host address to bind to                                                         |
| `port`      | number     | No       | `0`           | Port number. If 0 or not specified, an available port is automatically assigned |
| `auth`      | AuthConfig | No       | -             | Authentication configuration                                                    |

### AuthConfig Schema

```typescript
const WebHostAuthConfigSchema = z.object({
  users: z.record(z.string(), z.object({
    password: z.string().exactOptional(),
    bearerToken: z.string().exactOptional(),
  }))
});
```

| Option        | Type   | Description                                     |
|---------------|--------|-------------------------------------------------|
| `users`       | Record | Map of usernames to credentials                 |
| `password`    | string | Optional password for Basic authentication      |
| `bearerToken` | string | Optional bearer token for Bearer authentication |

**Note:** Each user can have either a password, a bearer token, or both. Users
without either credential cannot authenticate.

### StaticResource Config Schema

```typescript
const staticResourceConfigSchema = z.object({
  type: z.literal("static"),
  root: z.string(),
  description: z.string(),
  indexFile: z.string(),
  notFoundFile: z.string().exactOptional(),
  prefix: z.string()
});
```

| Option         | Type       | Description                            |
|----------------|------------|----------------------------------------|
| `type`         | `"static"` | Discriminator for static resource type |
| `root`         | string     | Directory path for static files        |
| `description`  | string     | Human-readable description             |
| `indexFile`    | string     | Default index file name                |
| `notFoundFile` | string     | Optional custom 404 page               |
| `prefix`       | string     | URL prefix for this resource           |

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
  autoStart: true
  host: "127.0.0.1"
  port: 3000
  auth:
    users:
      admin:
        password: "secret123"
        bearerToken: "admin-token-xyz"
      user1:
        password: "user-pass-123"
```

## License

MIT License - see LICENSE file for details.
