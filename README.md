# @tokenring-ai/web-host

A Fastify-based web hosting service for TokenRing applications, providing a pluggable system for serving web resources, APIs, and static content.

## Overview

The `@tokenring-ai/web-host` package serves as the web foundation for TokenRing applications. It provides a high-performance web server built on Fastify with support for WebSocket connections, static file serving, and a resource registration system that allows different packages to extend web functionality.

## Features

- **Fastify Server**: High-performance, low-latency web server with plugin architecture
- **WebSocket Support**: Built-in WebSocket capabilities for real-time communication
- **Resource Registration System**: Pluggable architecture for registering web resources
- **Static File Serving**: Support for serving static files and Single Page Applications (SPAs)
- **Automatic Port Assignment**: Supports dynamic port allocation (port 0 for automatic assignment)
- **Service Integration**: Seamlessly integrates with the TokenRing service architecture

## Installation

```bash
npm install @tokenring-ai/web-host
```

## Dependencies

- `@tokenring-ai/agent`: ^0.1.0
- `@tokenring-ai/utility`: ^0.1.0
- `fastify`: ^5.6.2
- `@fastify/websocket`: ^11.2.0
- `@fastify/static`: ^8.3.0

## Usage

### Basic Configuration

The web-host package integrates with TokenRing applications as a plugin. Configure it through the main application config:

```typescript
import { TokenRingApp } from "@tokenring-ai/app";
import webHostPackage from "@tokenring-ai/web-host";

const app = new TokenRingApp({
  webHost: {
    port: 3000  // Optional, defaults to 0 (automatic port assignment)
  }
});

// Install the package
await app.addPackages([webHostPackage]);

// Start the application
await app.start();
```

### Registering Web Resources

Web resources can be registered to extend the web server functionality. Resources must implement the `WebResource` interface:

```typescript
import type { WebResource } from "@tokenring-ai/web-host/types";
import type { FastifyInstance } from "fastify";

class MyResource implements WebResource {
  name = "MyResource";

  async register(server: FastifyInstance): Promise<void> {
    // Register HTTP routes
    server.get("/api/hello", async () => ({
      message: "Hello from TokenRing!"
    }));

    // Register WebSocket endpoints
    server.get("/ws", { websocket: true }, (socket, req) => {
      socket.on("message", (data) => {
        console.log("Received:", data.toString());
        socket.send("Echo: " + data.toString());
      });
    });
  }
}

// Register the resource
const webHostService = app.getService(WebHostService);
webHostService.registerResource(new MyResource());
```

### Working with the WebHostService

The `WebHostService` provides the core functionality:

```typescript
import { WebHostService } from "@tokenring-ai/web-host";

// Get the web host service
const webHostService = app.requireService(WebHostService);

// Access the underlying Fastify instance
const fastifyServer = webHostService.getServer();

// Start the server (usually called automatically)
await webHostService.start();

// Stop the server
await webHostService.stop();
```

## API Reference

### WebResource Interface

```typescript
interface WebResource {
  name: string;
  register(server: FastifyInstance): Promise<void> | void;
}
```

**Properties:**
- `name`: A unique identifier for the resource
- `register(server)`: A method that registers routes, WebSocket endpoints, or other Fastify functionality

### WebHostService Class

```typescript
class WebHostService implements TokenRingService {
  name: string;
  description: string;
  
  private server: FastifyInstance;
  private port: number;
  private resources: KeyedRegistry<WebResource>;
  
  registerResource = this.resources.register;
  
  constructor(config: { port?: number });
  async start(): Promise<void>;
  async stop(): Promise<void>;
  getServer(): FastifyInstance;
}
```

**Methods:**
- `registerResource(resource: WebResource)`: Register a new web resource
- `start()`: Start the web server and register all resources
- `stop()`: Stop the web server
- `getServer()`: Get access to the underlying Fastify instance

### Configuration Schema

```typescript
const WebHostConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().optional(),
  auth: z.object({
    users: z.record(z.string(), z.object({
      password: z.string().optional(),
      bearerToken: z.string().optional(),
    }))
  }).optional(),
  resources: z.record(z.string(), ...).optional()
});
```

**Configuration Options:**
- `host`: Host address to bind to (default: "127.0.0.1")
- `port`: Port number to listen on. If 0 or not specified, the system will automatically assign an available port.
- `auth`: Optional authentication configuration with per-user credentials
  - `users`: Record of username to credentials mapping
    - `password`: Optional password for Basic authentication
    - `bearerToken`: Optional bearer token for Bearer authentication
- `resources`: Optional web resources to register

## Authentication

The web-host supports both Basic and Bearer token authentication on a per-user basis.

### Configuration Example

```typescript
const app = new TokenRingApp({
  webHost: {
    port: 3000,
    auth: {
      users: {
        "admin": {
          password: "secret123",
          bearerToken: "admin-token-xyz"
        },
        "api-user": {
          bearerToken: "api-key-abc123"
        },
        "basic-user": {
          password: "password456"
        }
      }
    }
  }
});
```

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
class MyResource implements WebResource {
  name = "MyResource";

  async register(server: FastifyInstance): Promise<void> {
    server.get("/api/whoami", async (request) => {
      return { user: (request as any).user };
    });
  }
}
```

## Examples

### Static File Serving

```typescript
import fastifyStatic from "@fastify/static";
import { join } from "path";

class StaticFileResource implements WebResource {
  name = "StaticFiles";

  async register(server: FastifyInstance): Promise<void> {
    await server.register(fastifyStatic, {
      root: join(import.meta.dirname, "public"),
      prefix: "/static/"
    });

    // Handle SPA routing
    server.setNotFoundHandler((request, reply) => {
      reply.sendFile("index.html");
    });
  }
}
```

### API Resource

```typescript
class APIResource implements WebResource {
  name = "API";

  async register(server: FastifyInstance): Promise<void> {
    // REST API endpoints
    server.get("/api/status", async () => ({
      status: "ok",
      timestamp: new Date().toISOString()
    }));

    // POST endpoint
    server.post("/api/data", async (request) => {
      const data = request.body;
      return { received: data, processed: true };
    });
  }
}
```

### WebSocket Resource

```typescript
class WebSocketResource implements WebResource {
  name = "WebSocket";

  async register(server: FastifyInstance): Promise<void> {
    server.get("/ws/chat", { websocket: true }, (socket, req) => {
      const clientId = Date.now().toString();
      
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        // Broadcast to all connected clients
        server.websocketServer.clients.forEach(client => {
          if (client !== socket) {
            client.send(JSON.stringify({
              type: "message",
              from: clientId,
              content: message.content
            }));
          }
        });
      });

      socket.on("close", () => {
        console.log(`Client ${clientId} disconnected`);
      });
    });
  }
}
```

## Integration with Other Packages

The web-host package works seamlessly with other TokenRing packages:

- **@tokenring-ai/web-frontend**: Provides a default frontend resource for serving React/Vite applications
- **@tokenring-ai/agent-api**: WebSocket API for agent management and interaction
- **@tokenring-ai/filesystem**: File serving and management capabilities

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