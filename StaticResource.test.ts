import { beforeEach, describe, expect, it, mock } from "bun:test";
import StaticResource, { staticResourceConfigSchema } from "./StaticResource";
import type { BunRouter } from "./types";

describe("StaticResource", () => {
  let mockRouter: BunRouter;

  beforeEach(() => {
    mockRouter = {
      get: mock(),
      post: mock(),
      put: mock(),
      delete: mock(),
      ws: mock(),
      static: mock(),
      fallback: mock(),
    };
  });

  describe("constructor", () => {
    it("should create instance with valid config", () => {
      const config = {
        type: "static" as const,
        root: "/path/to/static",
        description: "Static files",
        indexFile: "index.html",
        notFoundFile: "404.html",
        prefix: "/static",
      };

      const resource = new StaticResource(config);
      expect(resource).toBeInstanceOf(StaticResource);
    });
  });

  describe("register method", () => {
    it("should register static file serving", async () => {
      const config = {
        type: "static" as const,
        root: "/path/to/static",
        description: "Static files",
        indexFile: "index.html",
        notFoundFile: "404.html",
        prefix: "/static",
      };

      const resource = new StaticResource(config);
      resource.register(mockRouter);

      expect(mockRouter.static).toHaveBeenCalledWith("/static", "/path/to/static", {
        index: "index.html",
        notFound: "404.html",
      });
    });

    it("should register without not found handler when notFoundFile is not provided", async () => {
      const config = {
        type: "static" as const,
        root: "/path/to/static",
        description: "Static files",
        indexFile: "index.html",
        prefix: "/static",
      };

      const resource = new StaticResource(config);
      resource.register(mockRouter);

      expect(mockRouter.static).toHaveBeenCalledWith("/static", "/path/to/static", {
        index: "index.html",
        notFound: undefined,
      });
    });
  });

  describe("staticResourceConfigSchema", () => {
    it("should validate valid config", () => {
      const validConfig = {
        root: "/path/to/static",
        indexFile: "index.html",
        notFoundFile: "404.html",
        prefix: "/static",
      } as const;

      const result = staticResourceConfigSchema.parse(validConfig);
      expect(result).toEqual(validConfig);
    });

    it("should reject invalid config", () => {
      const invalidConfig = {
        root: 123,
        indexFile: "index.html",
        prefix: "/static",
      };

      expect(() => staticResourceConfigSchema.parse(invalidConfig)).toThrow();
    });

    it("should require all required fields", () => {
      const partialConfig = {
        root: "/path/to/static",
        prefix: "/static",
      };

      expect(() => staticResourceConfigSchema.parse(partialConfig)).toThrow();
    });
  });
});
