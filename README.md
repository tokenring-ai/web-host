# @tokenring-ai/web-host

Fastify-based web host for serving resources and APIs in TokenRing.

## Features

- **Fastify Server**: High-performance web server
- **WebSocket Support**: Built-in WebSocket capabilities
- **Resource Registration**: Pluggable system for registering web resources
- **Static File Serving**: Serve static files and SPAs

## Usage

```typescript
import { AgentTeam } from "@tokenring-ai/agent";
import { packageInfo, WebHostService } from "@tokenring-ai/web-host";

const team = new AgentTeam({
  webHost: {
    enabled: true,
    port: 3000
  }
});

await team.addPackages([packageInfo]);

// Register custom resources
const webHost = team.services.getItemByType(WebHostService);
webHost.registerResource("myResource", {
  name: "My Resource",
  async register(server) {
    server.get("/api/hello", async () => ({ hello: "world" }));
  }
});
```

## WebResource Interface

```typescript
interface WebResource {
  name: string;
  register(server: FastifyInstance): Promise<void> | void;
}
```

Resources can register routes, static files, WebSocket endpoints, or any other Fastify functionality.

## License

MIT License - Copyright (c) 2025 Mark Dierolf
