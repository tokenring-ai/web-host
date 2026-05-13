import createTestingApp from "@tokenring-ai/app/test/createTestingApp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebResource } from "./types";
import WebHostService from "./WebHostService";

// Mock Bun globally before anything else
const mockServer = {
  hostname: "127.0.0.1",
  port: 3000,
  stop: vi.fn()
};

// Define Bun global for the test environment
(global as any).Bun = {
  serve: vi.fn(() => mockServer),
  file: vi.fn((path: string) => ({
    exists: vi.fn().mockResolvedValue(true)
  }))
};

describe("WebHostService", () => {
  let service: WebHostService;
  let mockApp: any;
  let mockConfig: any;

  beforeEach(() => {
    mockApp = createTestingApp();

    mockConfig = {
      host: "127.0.0.1",
      port: 3000,
      auth: undefined,
      resources: {}
    };
    service = new WebHostService(mockApp, mockConfig);

    vi.clearAllMocks();
    // Reset mock server state
    mockServer.stop.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
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
      vi.spyOn(mockApp, "serviceOutput");
    });

    it("should start server and log URL", async () => {
      const abortController = new AbortController();

      await service.start(abortController.signal);

      expect(mockApp.serviceOutput).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Web Host listening at")
      );
    });

    it("should register resources", async () => {
      const mockResource: WebResource = {
        register: vi.fn()
      };

      service.registerResource("test", mockResource);

      const abortController = new AbortController();
      await service.start(abortController.signal);

      expect(mockResource.register).toHaveBeenCalled();
    });

    it("should configure auth when provided", async () => {
      const configWithAuth = {
        ...mockConfig,
        auth: {
          users: {
            testuser: { password: "testpass" }
          }
        }
      };

      const serviceWithAuth = new WebHostService(mockApp, configWithAuth);

      const abortController = new AbortController();
      await serviceWithAuth.start(abortController.signal);

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("stop method", () => {
    it("should stop the server", async () => {
      const abortController = new AbortController();
      await service.start(abortController.signal);

      await service.stop();

      expect(mockServer.stop).toHaveBeenCalled();
    });
  });

  describe("getURL method", () => {
    it("should return URL when server is started", async () => {
      const abortController = new AbortController();
      await service.start(abortController.signal);

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
        register: vi.fn()
      };

      service.registerResource("test", mockResource);
      const entries = service.getResourceEntries();
      const resources = Object.fromEntries(entries);

      expect(resources.test).toBe(mockResource);
    });

    it("should handle multiple resources", () => {
      const resource1: WebResource = { register: vi.fn() };
      const resource2: WebResource = { register: vi.fn() };

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
