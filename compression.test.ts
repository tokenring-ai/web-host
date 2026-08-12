import { describe, expect, it } from "bun:test";
import { isCompressiblePath, negotiateCompression } from "./compression.ts";

describe("negotiateCompression", () => {
  it("prefers br when listed first and accepted", () => {
    const choice = negotiateCompression("gzip, deflate, br", ["br", "gzip"]);
    expect(choice).toEqual({ contentEncoding: "br", streamFormat: "brotli" });
  });

  it("falls back to gzip when br is not accepted", () => {
    const choice = negotiateCompression("gzip, deflate", ["br", "gzip"]);
    expect(choice).toEqual({ contentEncoding: "gzip", streamFormat: "gzip" });
  });

  it("respects algorithm preference order", () => {
    const choice = negotiateCompression("br, gzip", ["gzip", "br"]);
    expect(choice).toEqual({ contentEncoding: "gzip", streamFormat: "gzip" });
  });

  it("returns null when nothing matches", () => {
    expect(negotiateCompression("identity", ["br", "gzip"])).toBeNull();
    expect(negotiateCompression(null, ["br", "gzip"])).toBeNull();
    expect(negotiateCompression("br", [])).toBeNull();
  });

  it("honors q=0 (not acceptable)", () => {
    expect(negotiateCompression("br;q=0, gzip;q=1", ["br", "gzip"])).toEqual({
      contentEncoding: "gzip",
      streamFormat: "gzip",
    });
  });

  it("accepts wildcard *", () => {
    expect(negotiateCompression("*", ["br", "gzip"])).toEqual({
      contentEncoding: "br",
      streamFormat: "brotli",
    });
  });
});

describe("isCompressiblePath", () => {
  it("detects common text assets", () => {
    expect(isCompressiblePath("/app/main.js")).toBe(true);
    expect(isCompressiblePath("/app/styles.CSS")).toBe(true);
    expect(isCompressiblePath("/app/index.html")).toBe(true);
    expect(isCompressiblePath("/app/data.json")).toBe(true);
    expect(isCompressiblePath("/app/icon.svg")).toBe(true);
  });

  it("skips already-compressed media", () => {
    expect(isCompressiblePath("/app/photo.png")).toBe(false);
    expect(isCompressiblePath("/app/video.mp4")).toBe(false);
    expect(isCompressiblePath("/app/font.woff2")).toBe(false);
    expect(isCompressiblePath("/app/archive.zip")).toBe(false);
  });

  it("skips wasm (already compact binary)", () => {
    expect(isCompressiblePath("/app/module.wasm")).toBe(false);
  });
});
