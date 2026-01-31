# @tokenring-ai/web-host

Fastify-based web hosting service for TokenRing applications, providing a pluggable system for serving web resources, static content, SPAs, and JSON-RPC APIs.

## Overview

The `@tokenring-ai/web-host` package serves as the web foundation for TokenRing applications. It provides a high-performance web server built on Fastify with a resource registration system that allows different packages to extend web functionality through plugins. The package supports static file serving, SPA routing, JSON-RPC endpoints, WebSocket RPC, and authentication.

## Features

- **Fastify Server**: High-performance, low-latency web server with plugin architecture
- **Resource Registration System**: Pluggable architecture for registering web resources
- **Static File Serving**: Support for serving static files with custom routing
- **SPA Support**: Single Page Application routing with fallback handling
- **JSON-RPC API**: Built-in JSON-RPC 2.0 support with streaming capabilities
- **WebSocket RPC**: WebSocket-based RPC endpoints for real-time communication
- **Authentication**: Basic and Bearer token authentication
- **Plugin Integration**: Seamless integration with TokenRing plugin system
- **Configuration Validation**: Zod-based configuration schemas
- **Service Integration**: Deep integration with TokenRing service architecture

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
await app.addPackages([webHostPackage]);

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

Serves Single Page Applications with fallback routing:

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

#### JsonRpcResource

Provides JSON-RPC 2.0 API endpoints:

```typescript
import { JsonRpcResource } from "@tokenring-ai/web-host/JsonRpcResource";
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

#### WsRpcResource

Provides WebSocket-based RPC endpoints for real-time communication:

```typescript
import { WsRpcResource } from "@tokenring-ai/web-host/WsRpcResource";

// WsRpcResource is automatically created from RPC endpoints
// by the plugin during startup
```

### Configuration Schema

```typescript
import { z } from "zod";

const staticResourceConfigSchema = z.object({
  type: z.literal("static"),
  root: z.string(),
  description: z.string(),
  indexFile: z.string(),
  notFoundFile: z.string().optional(),
  prefix: z.string()
});

const spaResourceConfigSchema = z.object({
  type: z.literal("spa"),
  file: z.string(),
  description: z.string(),
  prefix: z.string()
});

const AuthConfigSchema = z.object({
  users: z.record(z.string(), z.object({
    password: z.string().optional(),
    bearerToken: z.string().optional(),
  }))
});

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

**Configuration Options:**

- `host`: Host address to bind to (default: "127.0.0.1")
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

## JSON-RPC Implementation

### RPC Method Types

The RPC system supports three method types:

- **query**: Read-only operations that return a result
- **mutation**: Operations that modify state and return a result
- **stream**: Operations that emit a sequence of results

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
```

### JSON-RPC Client

```typescript
import { createJsonRPCClient } from "@tokenring-ai/web-host/createJsonRPCClient";

const client = createJsonRPCClient(new URL("http://localhost:3000"), calculatorSchema);

// Call query/mutation methods
const result = await client.add({ a: 5, b: 3 });

// Stream methods return async generators
for await (const update of client.streamResult({ steps: 5 })) {
  console.log(update);
}
```

### WebSocket RPC Client

```typescript
import { createWsRPCClient } from "@tokenring-ai/web-host/createWsRPCClient";

const client = createWsRPCClient(new URL("http://localhost:3000"), calculatorSchema);

// Call methods on WebSocket
const result = await client.add({ a: 5, b: 3 });
console.log(result);

// Stream methods return async generators
for await (const update of client.streamResult({ steps: 5 })) {
  console.log(update);
}
```

## API Reference

### WebHostService Class

```typescript
class WebHostService implements TokenRingService {
  name: string;
  description: string;
  
  resources: KeyedRegistry<WebResource>;
  registerResource: (name: string, resource: WebResource) => void;
  getResources: () => WebResource[];
  
  constructor(app: TokenRingApp, config: WebHostConfig);
  
  getURL(): URL;
  
  async run(signal: AbortSignal): Promise<void>;
}
```

**Methods:**

- `registerResource(name, resource)`: Register a new web resource
- `getResources()`: Get all registered resources
- `getURL()`: Get the current server URL
- `run(signal)`: Start the server (usually called automatically)

### WebResource Interface

```typescript
interface WebResource {
  register(server: FastifyInstance): Promise<void>;
}
```

**Methods:**

- `register(server)`: Register routes, handlers, or other Fastify functionality

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

#### SPAResource Config

```typescript
const spaResourceConfigSchema = z.object({
  type: z.literal("spa"),
  file: z.string(),
  description: z.string(),
  prefix: z.string()
});
```

### AuthConfig Schema

```typescript
const AuthConfigSchema = z.object({
  users: z.record(z.string(), z.object({
    password: z.string().optional(),
    bearerToken: z.string().optional(),
  }))
});
```

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

### Type Exports

The package exports the following types:

- `WebResource`: Interface for web resources
- `ResultOfRPCCall<T, K>`: Type utility for RPC result types
- `ParamsOfRPCCall<T, K>`: Type utility for RPC parameter types
- `FunctionTypeOfRPCCall<T, K>`: Type utility for RPC function types

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

## Integration with Other Packages

The web-host package works seamlessly with other TokenRing packages:

- **@tokenring-ai/agent**: Provides RPC endpoints for agent management
- **@tokenring-ai/app**: Service registration and lifecycle management
- **@tokenring-ai/rpc**: RPC endpoint registration and execution
- **@tokenring-ai/utility**: Registry and utility functions

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

await app.addPackages([webHostPackage]);

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

### JSON-RPC API Example

```typescript
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import { JsonRpcResource } from "@tokenring-ai/web-host/JsonRpcResource";
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

await app.addPackages([webHostPackage]);
await app.start();
```

## License

MIT License - see [LICENSE](./LICENSE) file for details.
