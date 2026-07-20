import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import { z } from "zod";
import FallbackResource, { FallbackResourceConfigSchema } from "./FallbackResource.ts";
import StaticResource, { staticResourceConfigSchema } from "./StaticResource";
import WebHostService from "./WebHostService";

const mockServer = {
  hostname: "127.0.0.1",
  port: 3000,
  stop: mock(),
};

describe("WebHost Integration Tests", () => {
  let service: WebHostService;
  let mockApp: TokenRingApp;

  beforeEach(() => {
    mock.clearAllMocks();
    mockServer.stop.mockClear();

    // Bun.serve / Bun.file are readonly on global Bun — spy instead of reassigning
    spyOn(Bun, "serve").mockImplementation((() => mockServer) as unknown as typeof Bun.serve);
    spyOn(Bun, "file").mockImplementation(((_path: string) => ({
      exists: mock().mockResolvedValue(true),
    })) as unknown as typeof Bun.file);

    mockApp = createTestingApp();
    spyOn(mockApp, "serviceOutput");
  });

  afterEach(() => {
    mock.restore();
  });

  describe("Complete WebHost Setup", () => {
    it("should setup web host with all resource types", async () => {
      const config = {
        host: "127.0.0.1",
        port: 3000,
        auth: {
          users: {
            testuser: { password: "testpass" },
          },
        },
        resources: {
          static: staticResourceConfigSchema.parse({
            type: "static",
            root: "/path/to/static",
            description: "Static files",
            indexFile: "index.html",
            notFoundFile: "404.html",
            prefix: "/static",
          }),
          spa: FallbackResourceConfigSchema.parse({
            type: "spa",
            file: "/path/to/app/index.html",
            description: "SPA application",
            prefix: "/app",
          }),
        },
      };

      service = new WebHostService(mockApp, config);

      // Register resources
      service.registerResource("static", new StaticResource(config.resources.static));
      service.registerResource("spa", new FallbackResource(config.resources.spa));

      await service.listen();

      expect(mockApp.serviceOutput).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("Web Host listening at"));
    });

    it("should integrate JSON-RPC with complete endpoint", () => {
      const schemas = {
        name: "TestService" as const,
        path: "/api/rpc",
        methods: {
          ping: {
            type: "query" as const,
            input: z.object({ message: z.string() }),
            result: z.object({ pong: z.string() }),
          },
          double: {
            type: "mutation" as const,
            input: z.object({ number: z.number() }),
            result: z.object({ result: z.number() }),
          },
          stream: {
            type: "stream" as const,
            input: z.object({ count: z.number() }),
            result: z.object({ value: z.number() }),
          },
        },
      };

      const implementation = {
        ping: async (args: any, _app: any) => ({
          pong: `Hello ${args.message}`,
        }),
        double: async (args: any, _app: any) => ({
          result: args.number * 2,
        }),
        stream: async function* (args: any, _app: any, signal: AbortSignal) {
          for (let i = 0; i < args.count; i++) {
            if (signal.aborted) break;
            yield { value: i };
          }
        },
      };

      const endpoint = createRPCEndpoint(schemas, implementation);

      expect(endpoint.path).toBe("/api/rpc");
      expect(Object.keys(endpoint.methods)).toHaveLength(3);
      expect(endpoint.methods.ping!.type).toBe("query");
      expect(endpoint.methods.double!.type).toBe("mutation");
      expect(endpoint.methods.stream!.type).toBe("stream");
    });
  });

  describe("Error Handling Integration", () => {
    it("should handle resource registration failures", async () => {
      const config = {
        host: "127.0.0.1",
        port: 3000,
        auth: {
          users: {
            testuser: { password: "testpass" },
          },
        },
      };

      service = new WebHostService(mockApp, config);

      const failingResource = {
        register: mock().mockRejectedValue(new Error("Registration failed")),
      };

      service.registerResource("failing", failingResource);

      await expect(service.listen()).rejects.toThrow("Registration failed");
    });
  });

  describe("URL Generation Integration", () => {
    it("should generate correct URLs when server is started", async () => {
      const config = {
        host: "127.0.0.1",
        port: 3000,
        auth: {
          users: {
            testuser: { password: "testpass" },
          },
        },
      };

      const service1 = new WebHostService(mockApp, config);
      await service1.listen();
      // Note: The mock server always returns 127.0.0.1:3000
      expect(service1.getURL().toString()).toBe("http://127.0.0.1:3000/");
    });
  });

  describe("Resource Management Integration", () => {
    it("should manage multiple resources correctly", () => {
      service = new WebHostService(mockApp, {
        host: "127.0.0.1",
        port: 3000,
        auth: {
          users: {
            testuser: { password: "testpass" },
          },
        },
      });

      const resource1 = { register: mock() };
      const resource2 = { register: mock() };
      const resource3 = { register: mock() };

      service.registerResource("resource1", resource1);
      service.registerResource("resource2", resource2);
      service.registerResource("resource3", resource3);

      const entries = service.getResourceEntries();
      const resources = Object.fromEntries(entries);

      expect(Object.keys(resources)).toHaveLength(3);
      expect(resources.resource1).toBe(resource1);
      expect(resources.resource2).toBe(resource2);
      expect(resources.resource3).toBe(resource3);
    });
  });

  describe("Configuration Schema Validation", () => {
    it("should validate complete web host configuration", () => {
      const validConfig = {
        host: "127.0.0.1",
        port: 3000,
        auth: {
          users: {
            user1: { password: "pass1" },
          },
        },
        resources: {
          static: {
            type: "static" as const,
            root: "/path",
            description: "Static",
            indexFile: "index.html",
            prefix: "/static",
          },
        },
      };

      expect(() => new WebHostService(mockApp, validConfig)).not.toThrow();
    });

    it("should handle minimal configuration", () => {
      const minimalConfig = {
        host: "127.0.0.1",
        port: 3000,
        auth: {
          users: {
            testuser: { password: "testpass" },
          },
        },
      };

      expect(() => new WebHostService(mockApp, minimalConfig)).not.toThrow();
    });
  });
});
