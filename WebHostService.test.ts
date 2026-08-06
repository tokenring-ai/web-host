import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import type { WebResource } from "./types";
import WebHostService from "./WebHostService";

const mockServer = {
  hostname: "127.0.0.1",
  port: 3000,
  stop: mock(),
};

describe("WebHostService", () => {
  let service: WebHostService;
  let mockApp: any;
  let mockConfig: any;

  beforeEach(() => {
    mock.clearAllMocks();
    mockServer.stop.mockClear();

    // Bun.serve / Bun.file are readonly on global Bun — spy instead of reassigning
    spyOn(Bun, "serve").mockImplementation((() => mockServer) as unknown as typeof Bun.serve);
    spyOn(Bun, "file").mockImplementation(((_path: string) => ({
      exists: mock().mockResolvedValue(true),
    })) as unknown as typeof Bun.file);

    mockApp = createTestingApp();

    mockConfig = {
      host: "127.0.0.1",
      port: 3000,
      auth: {
        users: {
          testuser: { password: "testpass" },
        },
      },
      resources: {},
    };
    service = new WebHostService(mockApp, mockConfig);
  });

  afterEach(() => {
    mock.restore();
  });

  describe("constructor", () => {
    it("should initialize with correct properties", () => {
      expect(service.name).toBe("WebHostService");
      expect(service.description).toBe("Bun web host for serving resources and APIs");
    });

    it("should initialize resources registry", () => {
      expect(service.resources).toBeDefined();
      expect(service.registerResource).toBeDefined();
      expect(service.getResourceEntries).toBeDefined();
    });
  });

  describe("start method", () => {
    beforeEach(() => {
      spyOn(mockApp, "serviceOutput");
    });

    it("should start server and log URL", async () => {
      await service.listen();

      expect(mockApp.serviceOutput).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("Web Host listening at"));
    });

    it("should include resource routes when starting server", async () => {
      const routeHandler = mock(() => new Response("ok"));
      const mockResource: WebResource = {
        routes: {
          "/test": routeHandler,
        },
      };

      service.registerResource("test", mockResource);

      await service.listen();

      expect(Bun.serve).toHaveBeenCalledWith(
        expect.objectContaining({
          routes: expect.objectContaining({
            "/test": routeHandler,
          }),
        }),
      );
    });

    it("should configure auth when provided", async () => {
      const configWithAuth = {
        ...mockConfig,
        auth: {
          users: {
            testuser: { password: "testpass" },
          },
        },
      };

      const serviceWithAuth = new WebHostService(mockApp, configWithAuth);

      await serviceWithAuth.listen();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("stop method", () => {
    it("should stop the server", async () => {
      await service.listen();

      service.stop();

      expect(mockServer.stop).toHaveBeenCalled();
    });
  });

  describe("getURL method", () => {
    it("should return URL when server is started", async () => {
      await service.listen();

      const url = service.getURL();
      expect(url.toString()).toBe("http://127.0.0.1:3000/");
    });

    it("should throw error when server is not started", () => {
      expect(() => service.getURL()).toThrow("Server not started");
    });
  });

  describe("resource registration", () => {
    it("should register and retrieve resources", () => {
      const mockResource: WebResource = {
        routes: {
          "/test": () => new Response("ok"),
        },
      };

      service.registerResource("test", mockResource);
      const entries = service.getResourceEntries();
      const resources = Object.fromEntries(entries);

      expect(resources.test).toBe(mockResource);
    });

    it("should handle multiple resources", () => {
      const resource1: WebResource = {
        routes: {
          "/one": () => new Response("one"),
        },
      };
      const resource2: WebResource = {
        wsRoutes: {
          "/ws": {
            open: mock(),
          },
        },
      };

      service.registerResource("resource1", resource1);
      service.registerResource("resource2", resource2);

      const entries = service.getResourceEntries();
      const resources = Object.fromEntries(entries);

      expect(Object.keys(resources)).toHaveLength(2);
      expect(resources.resource1).toBe(resource1);
      expect(resources.resource2).toBe(resource2);
    });
  });
});
