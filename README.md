# @tokenring-ai/web-host

Fastify-based web hosting service for TokenRing applications, providing a pluggable system for serving web resources, static content, SPAs, and JSON-RPC APIs.

## Overview

The `@tokenring-ai/web-host` package serves as the web foundation for TokenRing applications. It provides a high-performance web server built on Fastify with a resource registration system that allows different packages to extend web functionality through plugins. The package supports static file serving, SPA routing, JSON-RPC endpoints, and authentication.

## Features

- **Fastify Server**: High-performance, low-latency web server with plugin architecture
- **Resource Registration System**: Pluggable architecture for registering web resources
- **Static File Serving**: Support for serving static files with custom routing
- **SPA Support**: Single Page Application routing with fallback handling
- **JSON-RPC API**: Built-in JSON-RPC 2.0 support with streaming capabilities
- **Authentication**: Basic and Bearer token authentication
- **Plugin Integration**: Seamless integration with TokenRing plugin system
- **Configuration Validation**: Zod-based configuration schemas
- **Service Integration**: Deep integration with TokenRing service architecture

## Installation

```bash
bun install @tokenring-ai/web-host
```

## Dependencies

- `@tokenring-ai/app`: ^0.2.0
- `@tokenring-ai/agent`: ^0.2.0
- `@tokenring-ai/chat`: ^0.2.0
- `@tokenring-ai/utility`: ^0.2.0
- `fastify`: ^5.6.2
- `@fastify/static`: ^8.3.0
- `zod`: catalog

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

#### JSON-RPC Resource
Provides JSON-RPC 2.0 API endpoints:

```typescript
import { JsonRpcResource } from "@tokenring-ai/web-host";
import { createJsonRPCEndpoint } from "@tokenring-ai/web-host/jsonrpc/createJsonRPCEndpoint";

const rpcSchema = {
  path: "/api/rpc",
  methods: {
    getStatus: {
      type: "query" as const,
      input: z.object({}),
      result: z.object({ status: z.string() })
    },
    streamData: {
      type: "stream" as const,
      input: z.object({ message: z.string() }),
      result: z.object({ data: z.string() })
    }
  }
};

const implementation = {
  getStatus: async () => ({ status: "ok" }),
  streamData: async function* (params: { message: string }) {
    yield { data: `Echo: ${params.message}` };
  }
};

const endpoint = createJsonRPCEndpoint(rpcSchema, implementation);
const rpcResource = new JsonRpcResource(app, endpoint);

webHostService.registerResource("api", rpcResource);
```

### Configuration Schema

```typescript
import { z } from "zod";

const WebHostConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().optional(),
  auth: z.object({
    users: z.record(z.string(), z.object({
      password: z.string().optional(),
      bearerToken: z.string().optional(),
    }))
  }).optional(),
  resources: z.record(z.string(), z.discriminatedUnion("type", [
    staticResourceConfigSchema,
    spaResourceConfigSchema,
    jsonRpcResourceConfigSchema // Note: JSON-RPC resources can also be configured
  ])).optional(),
});

// Note: JSON-RPC resources can be configured through the resources array
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

### Defining RPC Schemas

```typescript
import { z } from "zod";

const myRpcSchema = {
  path: "/api/rpc",
  methods: {
    getUser: {
      type: "query" as const,
      input: z.object({ id: z.number() }),
      result: z.object({ 
        id: z.number(),
        name: z.string(),
        email: z.string()
      })
    },
    createPost: {
      type: "mutation" as const,
      input: z.object({ 
        title: z.string(),
        content: z.string()
      }),
      result: z.object({ 
        id: z.number(),
        title: z.string()
      })
    },
    streamUpdates: {
      type: "stream" as const,
      input: z.object({ 
        userId: z.number()
      }),
      result: z.object({ 
        type: z.string(),
        data: z.string()
      })
    }
  }
};
```

### Implementing RPC Methods

```typescript
const implementation = {
  getUser: async (params: { id: number }) => {
    // Query method - returns a single result
    return { 
      id: params.id,
      name: "John Doe",
      email: "john@example.com"
    };
  },
  
  createPost: async (params: { title: string; content: string }) => {
    // Mutation method - creates/modifies data
    return { 
      id: Date.now(),
      title: params.title
    };
  },
  
  streamUpdates: async function* (params: { userId: number }, signal: AbortSignal) {
    // Stream method - yields multiple results over time
    for (let i = 0; i < 5; i++) {
      if (signal.aborted) break;
      
      yield { 
        type: "update",
        data: `Update ${i + 1} for user ${params.userId}`
      };
      
      // Wait between updates
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
};
```

### JSON-RPC Client

```typescript
import { createJsonRPCClient } from "@tokenring-ai/web-host/jsonrpc/createJsonRPCClient";

const client = createJsonRPCClient(new URL("http://localhost:3000"), myRpcSchema);

// Call query/mutation methods
const user = await client.getUser({ id: 123 });

// Stream methods return async generators
for await (const update of client.streamUpdates({ userId: 123 })) {
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

#### JSON-RPC Resource Config

```typescript
const jsonRpcResourceConfigSchema = z.object({
  type: z.literal("jsonrpc"),
  path: z.string(),
  methods: z.record(z.string(), z.object({
    type: z.enum(["query", "mutation", "stream"]),
    input: z.ZodType,
    result: z.ZodType
  }))
});
```

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
#   - api
```

## Integration with Other Packages

The web-host package works seamlessly with other TokenRing packages:

- **@tokenring-ai/agent**: Provides RPC endpoints for agent management
- **@tokenring-ai/chat**: Integration with chat services
- **@tokenring-ai/app**: Service registration and lifecycle management
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
import { createJsonRPCEndpoint } from "@tokenring-ai/web-host/jsonrpc/createJsonRPCEndpoint";
import { JsonRpcResource } from "@tokenring-ai/web-host/jsonrpc/JsonRpcResource";
import { z } from "zod";

const calculatorSchema = {
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

const calculator = {
  add: async (params: { a: number; b: number }) => ({
    result: params.a + params.b
  }),
  
  streamResult: async function* (params: { steps: number }) {
    let value = 0;
    for (let i = 0; i < params.steps; i++) {
      value += Math.random();
      yield { step: i, value };
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
};

const endpoint = createJsonRPCEndpoint(calculatorSchema, calculator);
const rpcResource = new JsonRpcResource(app, endpoint);

webHostService.registerResource("calculator", rpcResource);
```

## License

MIT License - Copyright (c) 2025 Mark Dierolf

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions, please refer to the main TokenRing repository or create an issue in the appropriate package.