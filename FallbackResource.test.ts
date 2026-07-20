import { beforeEach, describe, expect, it, mock } from "bun:test";
import FallbackResource from "./FallbackResource.ts";
import type { BunRouter } from "./types";

// Mock Bun.file
void mock.module("bun", () => ({
  file: mock(() => ({
    exists: mock().mockResolvedValue(true),
  })),
}));

describe("FallbackResource", () => {
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
    describe("register method", () => {
      it("should register SPA with existing file", async () => {
        const config = {
          file: "/path/to/index.html",
        };

        const resource = new FallbackResource(config);
        resource.register(mockRouter);

        // Should register fallback handler
        expect(mockRouter.fallback).toHaveBeenCalledWith(expect.any(Function));
      });

      it("should serve requests to index.html", async () => {
        const config = {
          file: "/path/to/index.html",
        };

        const resource = new FallbackResource(config);
        resource.register(mockRouter);

        // Get the handler for /app
        const rootHandler = (mockRouter.get as any).mock.calls.find((call: any[]) => call[0] === "/app")[1];

        const mockRequest: any = {
          method: "GET",
          url: "http://localhost/app",
          path: "/app",
          headers: new Headers(),
        };

        const mockResponse: any = {
          file: mock().mockResolvedValue(new Response("HTML content")),
        };

        await rootHandler(mockRequest, mockResponse);

        expect(mockResponse.file).toHaveBeenCalledWith("/path/to/index.html");
      });
    });
  });
});
