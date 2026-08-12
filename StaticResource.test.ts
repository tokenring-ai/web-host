import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import StaticResource from "./StaticResource.ts";

describe("StaticResource compression", () => {
  let tmpDir: string;
  let largeJsPath: string;
  let smallJsPath: string;
  let pngPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-host-static-"));
    // > 1KB compressible content
    largeJsPath = path.join(tmpDir, "app.js");
    fs.writeFileSync(largeJsPath, `console.log(${JSON.stringify("x".repeat(2048))});\n`);
    // below default minSize
    smallJsPath = path.join(tmpDir, "tiny.js");
    fs.writeFileSync(smallJsPath, "export default 1;\n");
    // non-compressible binary-ish
    pngPath = path.join(tmpDir, "pixel.png");
    fs.writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(100)]));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function handlerFor(compress?: { enabled?: boolean; minSize?: number; algorithms?: ("br" | "gzip")[] }) {
    const resource = new StaticResource({
      root: tmpDir,
      prefix: "/static",
      compress: {
        enabled: compress?.enabled ?? true,
        minSize: compress?.minSize ?? 1024,
        algorithms: compress?.algorithms ?? ["br", "gzip"],
      },
    });
    const route = resource.routes["/static/*"];
    if (typeof route !== "function") {
      throw new Error("expected route handler function");
    }
    return route as (request: Request) => Promise<Response>;
  }

  it("compresses large JS with brotli when accepted", async () => {
    const handle = handlerFor();
    const response = await handle(
      new Request("http://localhost/static/app.js", {
        headers: { "Accept-Encoding": "br, gzip" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Encoding")).toBe("br");
    expect(response.headers.get("Vary")).toContain("Accept-Encoding");
    const body = await response.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
    // Compressed should be smaller than raw source
    expect(body.byteLength).toBeLessThan(fs.statSync(largeJsPath).size);
  });

  it("falls back to gzip when br is not accepted", async () => {
    const handle = handlerFor();
    const response = await handle(
      new Request("http://localhost/static/app.js", {
        headers: { "Accept-Encoding": "gzip" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Encoding")).toBe("gzip");
  });

  it("skips compression below minSize", async () => {
    const handle = handlerFor({ minSize: 1024 });
    const response = await handle(
      new Request("http://localhost/static/tiny.js", {
        headers: { "Accept-Encoding": "br, gzip" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Encoding")).toBeNull();
    // Non-compressed path must still set Content-Type
    expect(response.headers.get("Content-Type")).toMatch(/javascript|ecmascript|text\/plain/);
  });

  it("skips compression for non-compressible extensions", async () => {
    const handle = handlerFor({ minSize: 0 });
    const response = await handle(
      new Request("http://localhost/static/pixel.png", {
        headers: { "Accept-Encoding": "br, gzip" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Encoding")).toBeNull();
  });

  it("can disable compression entirely", async () => {
    const handle = handlerFor({ enabled: false });
    const response = await handle(
      new Request("http://localhost/static/app.js", {
        headers: { "Accept-Encoding": "br, gzip" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Encoding")).toBeNull();
  });

  it("sets Content-Encoding on HEAD without a body", async () => {
    const handle = handlerFor();
    const response = await handle(
      new Request("http://localhost/static/app.js", {
        method: "HEAD",
        headers: { "Accept-Encoding": "gzip" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    expect(response.headers.get("Content-Length")).toBeTruthy();
    expect(await response.arrayBuffer()).toHaveLength(0);
  });
});
