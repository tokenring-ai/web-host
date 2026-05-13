# @tokenring-ai/web-host

Bun-based web hosting service for TokenRing applications, providing a pluggable system for serving web resources, static
content, SPAs, and JSON-RPC APIs.

## Overview

The `@tokenring-ai/web-host` package serves as the web foundation for TokenRing applications. It provides a
high-performance web server built on **Bun.serve** with a resource registration system that allows different packages to
extend web functionality through plugins. The package supports static file serving, SPA routing, JSON-RPC endpoints,
WebSocket RPC, and authentication.

### Key Features

- **High-Performance Server**: Built on Bun.serve for low-latency HTTP and WebSocket handling
- **Resource Registration System**: Pluggable architecture using KeyedRegistry for web resources
- **Static File Serving**: Serve static files with custom routing prefixes
- **SPA Support**: Single Page Application routing with fallback for client-side navigation
- **JSON-RPC API**: Built-in JSON-RPC 2.0 support with Server-Sent Events streaming
- **WebSocket RPC**: Real-time WebSocket-based RPC with streaming support
- **Authentication**: Basic and Bearer token authentication with per-user credentials
- **Plugin Integration**: Seamless integration with TokenRing plugin system
- **Automatic RPC Registration**: Auto-creates JSON-RPC and WebSocket resources from RpcService endpoints
- **Type Safety**: Full TypeScript support with Zod configuration validation

## Installation

```bash
bun add @tokenring-ai/web-host
```

## Core Components

### WebHostService

The main service that manages the web server lifecycle and resource registration.

**Class Signature:**

```typescript
class WebHostService implements TokenRingService {
  readonly name = "WebHostService";
  description = "Bun web host for serving resources and APIs";

  resources: KeyedRegistry<WebResource>;
  registerResource: (name: string, resource: WebResource) => void;
  getResourceEntries: () => Iterable<[string, WebResource]>;

  constructor(app: TokenRingApp, config: ParsedWebHostConfig);

  get listening: boolean;

  getURL(): URL;

  async listen(): Promise<void>;

  async reconfigure(config: ParsedWebHostConfig): Promise<void>;

  async stop(): Promise<void>;
}
```

**Properties:**

| Property             | Type                                            | Description                           |
|----------------------|-------------------------------------------------|---------------------------------------|
| `name`               | string                                          | Service name (`"WebHostService"`)     |
| `description`        | string                                          | Service description                   |
| `resources`          | `KeyedRegistry<WebResource>`                    | Registry of registered web resources  |
| `registerResource`   | `(name: string, resource: WebResource) => void` | Register a web resource               |
| `getResourceEntries` | `() => Iterable<[string, WebResource]>`         | Get all registered resources          |
| `listening`          | `boolean`                                       | Whether server is currently listening |

**Methods:**

| Method        | Signature                                        | Description                                     |
|---------------|--------------------------------------------------|-------------------------------------------------|
| `listen`      | `() => Promise<void>`                            | Start the Bun server and register all resources |
| `stop`        | `() => Promise<void>`                            | Stop the server and close all connections       |
| `reconfigure` | `(config: ParsedWebHostConfig) => Promise<void>` | Reconfigure and restart the server              |
| `getURL`      | `() => URL`                                      | Get the current server URL                      |

### WebResource Interface

Interface for web resources that can be registered with the WebHostService.

```typescript
interface WebResource {
  register(router: BunRouter): MaybePromise<void>;
}
```

### BunRouter Interface

Router interface for registering handlers, websockets, and static files.

```typescript
interface BunRouter {
  get(path: string, handler: RouteHandler): void;
  post(path: string, handler: RouteHandler): void;
  put(path: string, handler: RouteHandler): void;
  delete(path: string, handler: RouteHandler): void;
  ws(path: string, handler: WebSocketHandler): void;
  static(prefix: string, root: string, options?: StaticOptions): void;
  fallback(handler: RouteHandler): void;
}
```

## Services

### WebHostService Implementation

The WebHostService is a TokenRingService that provides web server functionality.

**Service Registration:**

The service is automatically registered when the web-host plugin is installed with a webHost configuration.

```typescript
import { TokenRingApp } from "@tokenring-ai/app";
import webHostPackage from "@tokenring-ai/web-host";

const app = new TokenRingApp({
  webHost: {
    port: 3000,
    host: "127.0.0.1"
  }
});

await app.addPlugin(webHostPackage);
await app.start();

// Access the service
const webHostService = app.getService(WebHostService);
```

## Provider Documentation

The web-host package does not use a provider architecture. Instead, it uses a plugin-based registration system with the
TokenRing plugin architecture.

## RPC Endpoints

The web-host package automatically creates JSON-RPC and WebSocket RPC resources from RPC endpoints registered with the
RpcService.

### Automatic RPC Registration

When the plugin starts, it automatically:

1. Scans all registered RpcService endpoints
2. Creates JsonRpcResource for HTTP JSON-RPC endpoints
3. Creates WsRpcResource for WebSocket RPC endpoints
4. Logs the endpoint paths

```typescript
// Register an RPC endpoint
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import { RpcService } from "@tokenring-ai/rpc";

const calculatorSchema = {
  name: "Calculator",
  path: "/api/calc",
  methods: {
    add: {
      type: "query",
      input: z.object({ a: z.number(), b: z.number() }),
      result: z.object({ result: z.number() })
    }
  }
};

const calculator = {
  add: async (params: { a: number; b: number }, app) => ({
    result: params.a + params.b
  })
};

const endpoint = createRPCEndpoint(calculatorSchema, calculator);
rpcService.registerEndpoint("calculator", endpoint);

// The web-host plugin will automatically create:
// - JsonRpcResource at /api/calc
// - WsRpcResource at /api/calc
```

### JSON-RPC Error Codes

| Error Code | Description                                    |
|------------|------------------------------------------------|
| -32700     | Parse error (invalid JSON)                     |
| -32600     | Invalid Request (wrong JSON-RPC version)       |
| -32601     | Method not found                               |
| -32603     | Internal error (validation or execution error) |

## Chat Commands

### webhost show

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
  - calculator
```

### webhost start

Starts the web host server.

**Usage:**

```bash
/webhost start
```

**Output:**

```text
Web host started at: http://localhost:3000
```

### webhost stop

Stops the web host server.

**Usage:**

```bash
/webhost stop
```

**Output:**

```text
Web host stopped
```

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
  autoStart: z.boolean().default(false),
  host: z.string().default("127.0.0.1"),
  port: z.number().default(0),
  auth: WebHostAuthConfigSchema.optional()
}).prefault({});
```

**Configuration Options:**

| Option      | Type       | Required | Default       | Description                                                                     |
|-------------|------------|----------|---------------|---------------------------------------------------------------------------------|
| `autoStart` | boolean    | No       | `false`       | Whether to automatically start the server when plugin starts                    |
| `host`      | string     | No       | `"127.0.0.1"` | Host address to bind to                                                         |
| `port`      | number     | No       | `0`           | Port number. If 0 or not specified, an available port is automatically assigned |
| `auth`      | AuthConfig | No       | -             | Authentication configuration                                                    |

### AuthConfig Schema

```typescript
const WebHostAuthConfigSchema = z.object({
  users: z.record(z.string(), z.object({
    password: z.string().optional(),
    bearerToken: z.string().optional(),
  }))
});
```

| Option        | Type   | Description                                     |
|---------------|--------|-------------------------------------------------|
| `users`       | Record | Map of usernames to credentials                 |
| `password`    | string | Optional password for Basic authentication      |
| `bearerToken` | string | Optional bearer token for Bearer authentication |

**Note:** Each user can have either a password, a bearer token, or both. Users without either credential cannot
authenticate.

### StaticResource Config Schema

```typescript
const staticResourceConfigSchema = z.object({
  type: z.literal("static"),
  root: z.string(),
  description: z.string(),
  indexFile: z.string(),
  notFoundFile: z.string().optional(),
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

## Integration

### Plugin Installation

The web-host package integrates with TokenRing applications as a plugin.

```typescript
import { TokenRingApp } from "@tokenring-ai/app";
import webHostPackage from "@tokenring-ai/web-host";

const app = new TokenRingApp({
  webHost: {
    port: 3000,
    host: "127.0.0.1",
    autoStart: true,
    auth: {
      users: {
        "admin": {
          password: "secret123",
          bearerToken: "admin-token-xyz"
        }
      }
    },
    resources: {
      "static-files": {
        type: "static",
        root: "./public",
        description: "Public static files",
        indexFile: "index.html",
        prefix: "/static"
      },
      "spa": {
        type: "spa",
        file: "./dist/index.html",
        description: "Main application",
        prefix: "/"
      }
    }
  }
});

await app.addPlugin(webHostPackage);
await app.start();
```

### Service Integration

The web-host service integrates with:

- **@tokenring-ai/app**: Service registration and lifecycle management
- **@tokenring-ai/agent**: Agent command registration via `/webhost show`, `/webhost start`, `/webhost stop` commands
- **@tokenring-ai/rpc**: Automatic JSON-RPC and WebSocket resource creation
- **@tokenring-ai/utility**: Registry and utility functions

### RPC Integration

RPC endpoints registered with RpcService are automatically converted to web resources:

```typescript
// Register RPC endpoint
const endpoint = createRPCEndpoint(calculatorSchema, calculator);
rpcService.registerEndpoint("calculator", endpoint);

// Web-host plugin automatically creates:
// - JsonRpcResource for HTTP JSON-RPC
// - WsRpcResource for WebSocket RPC
```

## Usage Examples

### Basic Configuration

```typescript
import { TokenRingApp } from "@tokenring-ai/app";
import webHostPackage from "@tokenring-ai/web-host";

const app = new TokenRingApp({
  webHost: {
    port: 3000,
    host: "127.0.0.1"
  }
});

await app.addPlugin(webHostPackage);
await app.start();
```

### Static File Serving

```typescript
import { StaticResource } from "@tokenring-ai/web-host";
import WebHostService from "@tokenring-ai/web-host";

const app = new TokenRingApp({
  webHost: { port: 3000 }
});

await app.addPlugin(webHostPackage);
await app.start();

const webHostService = app.getService(WebHostService);
webHostService.registerResource("public", new StaticResource({
  type: "static",
  root: "./public",
  description: "Public static files",
  indexFile: "index.html",
  prefix: "/static"
}));
```

### SPA Routing

```typescript
import { SPAResource } from "@tokenring-ai/web-host";

const spaResource = new SPAResource({
  type: "spa",
  file: "./dist/index.html",
  description: "Main SPA application",
  prefix: "/"
});

webHostService.registerResource("spa", spaResource);
```

**SPA Routing Behavior:**

- Static files (JS, CSS, images) are served by Bun's native file serving
- The root path serves the specified index.html file
- All other routes that don't match static files also serve index.html (for client-side routing)
- If the SPA file doesn't exist, a warning is logged but the server continues

### Custom Resource Registration

```typescript
import { WebHostService } from "@tokenring-ai/web-host";
import type { WebResource } from "@tokenring-ai/web-host";

const webHost = app.getServiceByType(WebHostService);

if (webHost) {
  const apiResource: WebResource = {
    async register(router) {
      router.get("/api/health", async (request, response) => {
        return response.json({ status: "ok" });
      });

      router.post("/api/data", async (request, response) => {
        const data = await request.json();
        return response.json({ received: data });
      });

      router.get("/api/whoami", async (request, response) => {
        return response.json({ user: request.headers.get("x-user") });
      });
    }
  };

  webHost.registerResource("customAPI", apiResource);
}
```

### JSON-RPC Endpoint

```typescript
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import { RpcService } from "@tokenring-ai/rpc";
import { z } from "zod";

const calculatorSchema = {
  name: "Calculator",
  path: "/api/calc",
  methods: {
    add: {
      type: "query",
      input: z.object({ a: z.number(), b: z.number() }),
      result: z.object({ result: z.number() })
    },
    multiply: {
      type: "mutation",
      input: z.object({ a: z.number(), b: z.number() }),
      result: z.object({ result: z.number() })
    },
    streamResult: {
      type: "stream",
      input: z.object({ steps: z.number() }),
      result: z.object({ step: z.number(), value: z.number() })
    }
  }
};

const calculator = {
  add: async (params: { a: number; b: number }, app) => ({
    result: params.a + params.b
  }),
  multiply: async (params: { a: number; b: number }, app) => ({
    result: params.a * params.b
  }),
  streamResult: async function* (params: { steps: number }, app, signal: AbortSignal) {
    let value = 0;
    for (let i = 0; i < params.steps; i++) {
      if (signal.aborted) break;
      value += Math.random();
      yield { step: i, value };
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
};

const endpoint = createRPCEndpoint(calculatorSchema, calculator);
rpcService.registerEndpoint("calculator", endpoint);
```

### JSON-RPC Client

```typescript
import { createJsonRPCClient } from "@tokenring-ai/web-host/createJsonRPCClient";
import type { RPCSchema } from "@tokenring-ai/rpc/types";

const calculatorSchema: RPCSchema = {
  name: "Calculator",
  path: "/api/calc",
  methods: {
    add: {
      type: "query",
      input: z.object({ a: z.number(), b: z.number() }),
      result: z.object({ result: z.number() })
    },
    streamResult: {
      type: "stream",
      input: z.object({ steps: z.number() }),
      result: z.object({ step: z.number(), value: z.number() })
    }
  }
};

const client = createJsonRPCClient(new URL("http://localhost:3000"), calculatorSchema);

// Call query/mutation methods
const result = await client.add({ a: 5, b: 3 });

// Stream methods return async generators
const controller = new AbortController();
for await (const update of client.streamResult({ steps: 5 }, controller.signal)) {
  console.log(update);
  if (update.step >= 2) {
    controller.abort();
    break;
  }
}
```

### WebSocket RPC Client

```typescript
import { createWsRPCClient } from "@tokenring-ai/web-host/createWsRPCClient";
import type { RPCSchema } from "@tokenring-ai/rpc/types";

const wsClient = createWsRPCClient(new URL("http://localhost:3000"), calculatorSchema);

// Call methods on WebSocket
const result = await wsClient.add({ a: 5, b: 3 });

// Stream methods return async generators
for await (const update of wsClient.streamResult({ steps: 5 }, signal)) {
  console.log(update);
}
```

## Authentication

### Basic Authentication

```bash
curl -u admin:secret123 http://localhost:3000/api/status
```

### Bearer Token Authentication

```bash
curl -H "Authorization: Bearer admin-token-xyz" http://localhost:3000/api/status
```

**Note:** The authentication system validates credentials but does not attach user information to the request object.
Implement custom header-based authentication if you need to pass user information to handlers.

## Best Practices

1. **Use Resource Registration**: Register resources at startup or through the plugin system for consistent
   initialization.

2. **Validate Configuration**: Use the provided Zod schemas to validate configuration before creating resources.

3. **Handle Streaming Properly**: When implementing stream methods, always check the `AbortSignal` to support graceful
   shutdown.

4. **Use Type Safety**: Leverage the type utilities for type-safe RPC interactions.

5. **Configure Authentication**: Use authentication for all production deployments to secure your APIs.

6. **Automatic Endpoint Registration**: Let the web-host plugin automatically create JSON-RPC and WebSocket RPC
   resources from RpcService endpoints.

7. **SPA Routing**: Use SPAResource for single-page applications to ensure proper client-side routing.

8. **Error Handling**: Implement proper error handling in RPC methods to provide meaningful error messages.

## Testing

The package includes comprehensive unit and integration tests using Vitest:

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test:watch

# Run tests with coverage
bun test:coverage
```

**Test Files:**

- `WebHostService.test.ts` - Service lifecycle and resource registration
- `StaticResource.test.ts` - Static file serving
- `SPAResource.test.ts` - SPA routing
- `JsonRpcResource.test.ts` - JSON-RPC API endpoints
- `WsRpcResource.test.ts` - WebSocket RPC endpoints
- `auth.test.ts` - Authentication
- `integration.test.ts` - Integration tests
- `createJsonRPCClient.test.ts` - HTTP client
- `createWsRPCClient.test.ts` - WebSocket client

## Dependencies

### Production Dependencies

| Package               | Version | Description                                        |
|-----------------------|---------|----------------------------------------------------|
| @tokenring-ai/app     | 0.2.0   | Base application framework with service management |
| @tokenring-ai/agent   | 0.2.0   | Agent system with state management                 |
| @tokenring-ai/utility | 0.2.0   | Registry and utility functions                     |
| @tokenring-ai/rpc     | 0.2.0   | RPC endpoint registration and execution            |
| zod                   | ^4.3.6  | Schema validation                                  |

### Development Dependencies

| Package    | Version | Description         |
|------------|---------|---------------------|
| vitest     | ^4.1.1  | Testing framework   |
| typescript | ^6.0.2  | TypeScript compiler |

## Package Structure

```text
pkg/web-host/
├── index.ts                    # Main entry point and exports
├── plugin.ts                   # Plugin definition for TokenRing integration
├── package.json                # Package manifest
├── LICENSE                     # MIT License
├── README.md                   # This documentation
├── WebHostService.ts           # Main service implementation
├── StaticResource.ts           # Static file resource
├── SPAResource.ts              # SPA resource implementation
├── JsonRpcResource.ts          # JSON-RPC resource implementation
├── WsRpcResource.ts            # WebSocket RPC resource implementation
├── auth.ts                     # Authentication utilities
├── types.ts                    # Type definitions
├── schema.ts                   # Configuration schemas
├── createJsonRPCClient.ts      # HTTP JSON-RPC client
├── createWsRPCClient.ts        # WebSocket RPC client
├── commands.ts                 # Command exports
├── commands/
│   ├── webhost-show.ts        # /webhost show command
│   ├── webhost-start.ts       # /webhost start command
│   └── webhost-stop.ts        # /webhost stop command
└── vitest.config.ts            # Vitest configuration
```

## Type Exports

The package exports the following types:

- `WebResource`: Interface for web resources
- `ParsedWebHostAuthConfig`: Type for parsed authentication configuration
- `ParsedWebHostConfig`: Type for parsed web host configuration
- `BunRouter`: Router interface for registering handlers
- `BunRequest`: Request object passed to route handlers
- `BunResponse`: Response utilities
- `BunWebSocket`: WebSocket wrapper interface
- `RouteHandler`: Route handler function type
- `WebSocketHandler`: WebSocket handler interface
- `StaticOptions`: Static file serving options

## Schema Exports

The package exports the following Zod schemas:

- `WebHostConfigSchema`: Web host configuration schema
- `WebHostAuthConfigSchema`: Authentication configuration schema
- `staticResourceConfigSchema`: Static resource configuration schema
- `spaResourceConfigSchema`: SPA resource configuration schema

## License

MIT License - see LICENSE file for details.
