# @tokenring-ai/web-host

Fastify-based web hosting service for TokenRing applications, providing a pluggable system for serving web resources, static content, SPAs, and JSON-RPC APIs.

## Overview

The `@tokenring-ai/web-host` package serves as the web foundation for TokenRing applications. It provides a high-performance web server built on Fastify with a resource registration system that allows different packages to extend web functionality through plugins. The package supports static file serving, SPA routing, JSON-RPC endpoints, WebSocket RPC, and authentication.

## Features

- **Fastify Server**: High-performance, low-latency web server with plugin architecture
- **Resource Registration System**: Pluggable architecture for registering web resources via KeyedRegistry
- **Static File Serving**: Support for serving static files with custom routing and 404 handling
- **SPA Support**: Single Page Application routing with fallback handling for client-side routing
- **JSON-RPC API**: Built-in JSON-RPC 2.0 support with streaming via Server-Sent Events
- **WebSocket RPC**: WebSocket-based RPC endpoints for real-time communication with streaming support
- **Authentication**: Basic and Bearer token authentication with per-user credentials
- **Plugin Integration**: Seamless integration with TokenRing plugin system
- **Configuration Validation**: Zod-based configuration schemas
- **Service Integration**: Deep integration with TokenRing service architecture
- **Automatic RPC Registration**: Automatic creation of JSON-RPC and WebSocket resources from RpcService endpoints

## Installation

```bash
bun install @tokenring-ai/web-host
```

## Usage

### Basic Configuration

The web-host package integrates with TokenRing applications as a plugin. Configure it through the main application config:

```typescript
import { TokenRingApp } from "@tokenring-ai/app";
import webHostPackage from "@tokenring-ai/web-host";

const app = new TokenRingApp({
  webHost: {
    port: 3000,
    host: "127.0.0.1"
  }
});

// Install the package
await app.addPlugin(webHostPackage);

// Start the application
await app.start();
```

### Resource Types

The web-host supports multiple resource types that can be configured or registered programmatically:

#### StaticResource

Serves static files from a directory:

```typescript
import { StaticResource } from "@tokenring-ai/web-host";

const staticResource = new StaticResource({
  type: "static",
  root: "./public",
  description: "Public static files",
  indexFile: "index.html",
  notFoundFile: "404.html",
  prefix: "/static"
});

webHostService.registerResource("public", staticResource);
```

#### SPAResource

Serves Single Page Applications with fallback routing for client-side navigation:

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

- Static files (JS, CSS, images) are served by the `fastifyStatic` middleware
- The root path serves the specified index.html file
- All other routes that don't match static files also serve index.html (for client-side routing)
- If the SPA file doesn't exist, a warning is logged but the server continues

#### JsonRpcResource

Provides JSON-RPC 2.0 API endpoints with streaming support:

```typescript
import { JsonRpcResource } from "@tokenring-ai/web-host";
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import { RpcService } from "@tokenring-ai/rpc";
import { z } from "zod";

// Define RPC endpoint schema
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

// Define RPC implementation
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

// Create and register endpoint
const endpoint = createRPCEndpoint(calculatorSchema, calculator);
const rpcResource = new JsonRpcResource(app, endpoint);

webHostService.registerResource("calculator", rpcResource);
```

**Note:** When using the web-host plugin, JSON-RPC resources are automatically created from RPC endpoints registered with the RpcService during the plugin's start phase.

#### WsRpcResource

Provides WebSocket-based RPC endpoints for real-time communication:

```typescript
import { WsRpcResource } from "@tokenring-ai/web-host";

// WsRpcResource is automatically created from RPC endpoints
// by the plugin during startup
```

**Note:** WebSocket RPC resources are automatically created from RPC endpoints registered with the RpcService during the plugin's start phase.

### Configuration Schema

```typescript
import { z } from "zod";
import { AuthConfigSchema, WebHostConfigSchema } from "@tokenring-ai/web-host";

// Schema types are also available
type AuthConfig = z.output<typeof AuthConfigSchema>;
type WebHostConfig = z.output<typeof WebHostConfigSchema>;
```

**Configuration Options:**

- `host`: Host address to bind to (default: `"127.0.0.1"`)
- `port`: Port number to listen on. If not specified, the system will automatically assign an available port.
- `auth`: Optional authentication configuration with per-user credentials
  - `users`: Record of username to credentials mapping
    - `password`: Optional password for Basic authentication
    - `bearerToken`: Optional bearer token for Bearer authentication
- `resources`: Optional web resources to register at startup

### Complete Configuration Example

```typescript
const app = new TokenRingApp({
  webHost: {
    port: 3000,
    host: "0.0.0.0",
    auth: {
      users: {
        "admin": {
          password: "secret123",
          bearerToken: "admin-token-xyz"
        },
        "api-user": {
          bearerToken: "api-key-abc123"
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
```

## Authentication

The web-host supports both Basic and Bearer token authentication on a per-user basis.

### Using Authentication

**Basic Authentication:**

```bash
curl -u admin:secret123 http://localhost:3000/api/status
```

**Bearer Token Authentication:**

```bash
curl -H "Authorization: Bearer admin-token-xyz" http://localhost:3000/api/status
```

### Accessing User Information

Authenticated username is available in request handlers:

```typescript
server.get("/api/whoami", async (request) => {
  return { user: (request as any).user };
});
```

**Note:** The `user` property is added to the request object by the authentication hook.

## JSON-RPC Implementation

### RPC Method Types

The RPC system supports three method types:

- **query**: Read-only operations that return a single result
- **mutation**: Operations that modify state and return a single result
- **stream**: Operations that emit a sequence of results

### JSON-RPC Error Codes

The JSON-RPC implementation includes proper error handling with standard JSON-RPC 2.0 error codes:

| Error Code | Description |
|------------|-------------|
| -32700 | Parse error (invalid JSON) |
| -32600 | Invalid Request (wrong JSON-RPC version) |
| -32601 | Method not found |
| -32603 | Internal error (validation or execution error) |

### Defining RPC Schemas

```typescript
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
```

### Implementing RPC Methods

```typescript
const calculator = {
  // Query method
  add: async (params: { a: number; b: number }, app) => ({
    result: params.a + params.b
  }),

  // Mutation method
  multiply: async (params: { a: number; b: number }, app) => ({
    result: params.a * params.b
  }),

  // Stream method
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
```

### Automatic Registration via Plugin

The plugin automatically creates JSON-RPC and WebSocket RPC resources from RPC endpoints registered with the RpcService:

```typescript
// Register RPC endpoint with RpcService
const endpoint = createRPCEndpoint(calculatorSchema, calculator);
rpcService.registerEndpoint("calculator", endpoint);

// The web-host plugin will automatically:
// 1. Create JsonRpcResource for HTTP JSON-RPC
// 2. Create WsRpcResource for WebSocket RPC
// 3. Log the endpoint path
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

const client = createJsonRPCClient(new URL("http://localhost:3000"), calculatorSchema);

// Call query/mutation methods
const result = await client.add({ a: 5, b: 3 });

// Stream methods return async generators
for await (const update of client.streamResult({ steps: 5 }, signal)) {
  console.log(update);
}
```

**Error Handling:**

```typescript
try {
  const result = await client.add({ a: 5, b: 3 });
} catch (error) {
  console.error("RPC call failed:", error.message);
}
```

**Streaming with Abort:**

```typescript
const controller = new AbortController();

// Start streaming
const stream = client.streamResult({ steps: 10 }, controller.signal);

// Stop after 3 updates
let count = 0;
for await (const update of stream) {
  console.log(update);
  if (++count >= 3) {
    controller.abort();
    break;
  }
}
```

### WebSocket RPC Client

```typescript
import { createWsRPCClient } from "@tokenring-ai/web-host/createWsRPCClient";
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

const wsClient = createWsRPCClient(new URL("http://localhost:3000"), calculatorSchema);

// Call methods on WebSocket
const result = await wsClient.add({ a: 5, b: 3 });
console.log(result);

// Stream methods return async generators
for await (const update of wsClient.streamResult({ steps: 5 }, signal)) {
  console.log(update);
}
```

**WebSocket Client Behavior:**

- Automatically manages WebSocket connection
- Queues requests if connection is not yet open
- Handles connection errors and reconnection attempts
- Supports streaming with abort signals

**Error Handling:**

```typescript
try {
  const result = await wsClient.add({ a: 5, b: 3 });
} catch (error) {
  if (error.message === "Socket closed") {
    console.error("WebSocket connection closed");
  } else {
    console.error("RPC call failed:", error.message);
  }
}
```

## API Reference

### WebHostService Class

```typescript
class WebHostService implements TokenRingService {
  readonly name = "WebHostService";
  description = "Fastify web host for serving resources and APIs";

  resources: KeyedRegistry<WebResource>;
  registerResource: (name: string, resource: WebResource) => void;
  getResourceEntries: () => Iterable<[string, WebResource]>;

  constructor(app: TokenRingApp, config: ParsedWebHostConfig);

  getURL(): URL;

  async start(signal: AbortSignal): Promise<void>;
  async stop(): Promise<void>;
}
```

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Service name (`"WebHostService"`) |
| `description` | string | Service description |
| `resources` | `KeyedRegistry<WebResource>` | Registry of registered resources |
| `registerResource` | `(name: string, resource: WebResource) => void` | Method to register resources |
| `getResourceEntries` | `() => Iterable<[string, WebResource]>` | Method to get all resources |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `start` | `(signal: AbortSignal) => Promise<void>` | Start the Fastify server and register all resources |
| `stop` | `() => Promise<void>` | Stop the server and close all connections |
| `getURL` | `() => URL` | Get the current server URL |

**Server Lifecycle:**

1. **Start Phase:**
   - Registers WebSocket support via `@fastify/websocket`
   - Registers authentication if configured
   - Registers all web resources
   - Binds to configured host and port
   - Logs the server URL

2. **Stop Phase:**
   - Closes the server and all active connections

### WebResource Interface

```typescript
interface WebResource {
  register(server: FastifyInstance): Promise<void>;
}
```

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `register` | `(server: FastifyInstance) => Promise<void>` | Register routes, handlers, and middleware |

### Resource Configuration Schemas

#### StaticResource Config

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

| Option | Type | Description |
|--------|------|-------------|
| `type` | `"static"` | Discriminator for static resource type |
| `root` | string | Directory path for static files |
| `description` | string | Human-readable description |
| `indexFile` | string | Default index file name |
| `notFoundFile` | string | Optional custom 404 page |
| `prefix` | string | URL prefix for this resource |

#### SPAResource Config

```typescript
const spaResourceConfigSchema = z.object({
  type: z.literal("spa"),
  file: z.string(),
  description: z.string(),
  prefix: z.string()
});
```

| Option | Type | Description |
|--------|------|-------------|
| `type` | `"spa"` | Discriminator for SPA resource type |
| `file` | string | Path to the index.html file |
| `description` | string | Human-readable description |
| `prefix` | string | URL prefix for SPA routing |

### AuthConfig Schema

```typescript
const AuthConfigSchema = z.object({
  users: z.record(z.string(), z.object({
    password: z.string().optional(),
    bearerToken: z.string().optional(),
  }))
});
```

| Option | Type | Description |
|--------|------|-------------|
| `users` | Record | Map of usernames to credentials |
| `password` | string | Optional password for Basic authentication |
| `bearerToken` | string | Optional bearer token for Bearer authentication |

**Note:** Each user can have either a password, a bearer token, or both. Users without either credential cannot authenticate.

### WebHostConfig Schema

```typescript
const WebHostConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().optional(),
  auth: AuthConfigSchema.optional(),
  resources: z.record(z.string(), z.discriminatedUnion("type", [
    staticResourceConfigSchema,
    spaResourceConfigSchema,
  ])).optional(),
});
```

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `host` | string | No | `"127.0.0.1"` | Host address to bind to |
| `port` | number | No | - | Port number. If not specified, an available port is automatically assigned |
| `auth` | AuthConfig | No | - | Authentication configuration |
| `resources` | Record | No | - | Web resources to register at startup |

### Type Exports

The package exports the following types:

- `WebResource`: Interface for web resources
- `ParsedAuthConfig`: Type for parsed authentication configuration
- `ParsedWebHostConfig`: Type for parsed web host configuration

## Commands

The web-host package provides a `/webhost` command for monitoring:

```bash
# Show web host URL and registered resources
/webhost

# Output:
# Web host running at: http://localhost:3000
# Registered resources:
#   - static-files
#   - spa
#   - calculator
```

### Command Help

```markdown
# /webhost

## Description
Displays the current web host URL and lists all registered resources.

## Usage
/webhost

## Output
- Web host URL with port
- List of registered resources and their names

## Example
/webhost
# Output:
# Web host running at: http://localhost:3000
# Registered resources:
#   - trpcBackend
#   - defaultFrontend
```

## Integration with Other Packages

The web-host package works seamlessly with other TokenRing packages:

- **@tokenring-ai/agent**: Provides RPC endpoints for agent management and command registration
- **@tokenring-ai/app**: Service registration and lifecycle management
- **@tokenring-ai/rpc**: RPC endpoint registration and execution
- **@tokenring-ai/chat**: Chat services and human interface
- **@tokenring-ai/utility**: Registry and utility functions

## Package Structure

```
pkg/web-host/
├── index.ts                     # Main entry point and exports
├── plugin.ts                    # Plugin definition for TokenRing integration
├── package.json                 # Package manifest
├── WebHostService.ts            # Main service implementation
├── StaticResource.ts            # Static file resource
├── SPAResource.ts              # SPA resource implementation
├── JsonRpcResource.ts          # JSON-RPC resource implementation
├── WsRpcResource.ts            # WebSocket RPC resource implementation
├── auth.ts                     # Authentication utilities
├── types.ts                    # Type definitions
├── schema.ts                   # Configuration schemas
├── createJsonRPCClient.ts      # HTTP JSON-RPC client
├── createWsRPCClient.ts        # WebSocket RPC client
├── commands/
│   └── webhost.ts              # /webhost command
└── vitest.config.ts            # Vitest configuration
```

## Examples

### Complete Application Setup

```typescript
import { TokenRingApp } from "@tokenring-ai/app";
import webHostPackage from "@tokenring-ai/web-host";
import { StaticResource } from "@tokenring-ai/web-host";

const app = new TokenRingApp({
  webHost: {
    port: 3000,
    auth: {
      users: {
        "admin": {
          password: "secret123",
          bearerToken: "admin-token"
        }
      }
    }
  }
});

await app.addPlugin(webHostPackage);

// Add custom resource
const webHostService = app.getService(WebHostService);
webHostService.registerResource("api", new StaticResource({
  type: "static",
  root: "./api-docs",
  description: "API documentation",
  indexFile: "index.html",
  prefix: "/docs"
}));

await app.start();
```

### Registering Custom Resources Programmatically

```typescript
import { WebHostService } from "@tokenring-ai/web-host";
import type { WebResource } from "@tokenring-ai/web-host/types";

// Get the web host service
const webHost = app.getServiceByType(WebHostService);

if (webHost) {
  // Create a custom API resource
  const apiResource: WebResource = {
    async register(server) {
      server.get("/api/health", async () => {
        return { status: "ok" };
      });

      server.post("/api/data", async (request, reply) => {
        const data = request.body;
        return { received: data };
      });

      // Access authenticated user if authentication is enabled
      server.get("/api/whoami", async (request) => {
        return { user: (request as any).user };
      });
    }
  };

  webHost.registerResource("customAPI", apiResource);
}
```

### JSON-RPC API Example

```typescript
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import { JsonRpcResource } from "@tokenring-ai/web-host";
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

// Register RPC endpoint
const endpoint = createRPCEndpoint(calculatorSchema, calculator);
rpcService.registerEndpoint("calculator", endpoint);

// The web-host plugin will automatically create resources
```

### Plugin Configuration Example

```typescript
import { TokenRingApp } from "@tokenring-ai/app";
import webHostPackage from "@tokenring-ai/web-host";
import { StaticResource } from "@tokenring-ai/web-host";

const app = new TokenRingApp({
  webHost: {
    port: 3000,
    host: "0.0.0.0",
    auth: {
      users: {
        "admin": { password: "secret123" }
      }
    },
    resources: {
      "public": {
        type: "static",
        root: "./public",
        description: "Public files",
        indexFile: "index.html",
        prefix: "/"
      }
    }
  }
});

await app.addPlugin(webHostPackage);
await app.start();
```

## Best Practices

1. **Use Resource Registration**: Register resources at startup or through the plugin system for consistent initialization.

2. **Validate Configuration**: Use the provided Zod schemas to validate configuration before creating resources.

3. **Handle Streaming Properly**: When implementing stream methods, always check the `AbortSignal` to support graceful shutdown.

4. **Use Type Safety**: Leverage the type utilities (`FunctionTypeOfRPCCall`, `ResultOfRPCCall`, `ParamsOfRPCCall`) for type-safe RPC interactions.

5. **Configure Authentication**: Use authentication for all production deployments to secure your APIs.

6. **Automatic Endpoint Registration**: Let the web-host plugin automatically create JSON-RPC and WebSocket RPC resources from RpcService endpoints.

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

- `@tokenring-ai/app` (0.2.0) - Base application framework with service management and plugin architecture
- `@tokenring-ai/agent` (0.2.0) - Agent system with state management
- `@tokenring-ai/chat` (0.2.0) - Chat service for human interaction
- `@tokenring-ai/utility` (0.2.0) - Shared utilities and helpers
- `@tokenring-ai/rpc` (0.2.0) - RPC endpoint registration and execution
- `fastify` (^5.7.4) - High-performance web server
- `@fastify/websocket` (^11.2.0) - WebSocket support for Fastify
- `@fastify/static` (^9.0.0) - Static file serving for Fastify
- `zod` (^4.3.6) - Schema validation
- `ws` (^8.19.0) - WebSocket implementation

### Development Dependencies

- `vitest` (^4.0.18) - Testing framework
- `typescript` (^5.9.3) - TypeScript compiler
- `@types/ws` (^8.18.1) - WebSocket type definitions

## License

MIT License - see [LICENSE](./LICENSE) file for details.
