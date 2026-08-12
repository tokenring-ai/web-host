import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { type CompressAlgorithm, isCompressiblePath, negotiateCompression } from "./compression.ts";
import type { WebResource } from "./types.ts";

export const staticResourceCompressSchema = z
  .object({
    enabled: z.boolean().default(true),
    minSize: z.number().int().min(0).default(1024),
    algorithms: z.array(z.enum(["gzip", "br"])).default(["br", "gzip"]),
  })
  .default({ enabled: true, minSize: 1024, algorithms: ["br", "gzip"] });

export const staticResourceConfigSchema = z.object({
  root: z.string(),
  indexFile: z.string().exactOptional(),
  notFoundFile: z.string().exactOptional(),
  prefix: z.string(),
  headers: z.record(z.string(), z.string()).exactOptional(),
  compress: staticResourceCompressSchema,
});

/** True if `target` is `root` itself or lives underneath it. */
function isInside(root: string, target: string): boolean {
  if (target === root) return true;
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function mergeVary(existing: string | undefined, value: string): string {
  if (!existing) return value;
  const parts = existing.split(",").map(p => p.trim().toLowerCase());
  if (parts.includes(value.toLowerCase())) return existing;
  return `${existing}, ${value}`;
}

export type StaticResourceConfig = z.input<typeof staticResourceConfigSchema>;
export type ParsedStaticResourceConfig = z.output<typeof staticResourceConfigSchema>;

export default class StaticResource implements WebResource {
  routes: NonNullable<WebResource["routes"]> = {};

  constructor(config: StaticResourceConfig) {
    const { prefix, root, indexFile, notFoundFile, headers = {}, compress: compressConfig } = staticResourceConfigSchema.parse(config);

    // Resolve the root once. Prefer the real path so later realpath() checks on
    // files under macOS /tmp (and similar symlink roots) still pass isInside.
    const resolvedRoot = path.resolve(root);
    let rootDir = resolvedRoot;
    try {
      rootDir = fsSync.realpathSync(resolvedRoot);
    } catch {
      rootDir = resolvedRoot;
    }

    /** Resolves symlinks, re-checks containment, and only serves regular files. */
    const serveFile = async (absPath: string, status: number, request: Request): Promise<Response | null> => {
      // Normalize through realpath before containment checks when possible.
      let realPath: string;
      try {
        realPath = await fs.realpath(absPath);
      } catch {
        return null; // ENOENT, ELOOP, EACCES, ...
      }

      // A symlink inside root may point outside of it.
      if (!isInside(rootDir, realPath)) return null;

      const stats = await fs.stat(realPath);
      if (!stats.isFile()) return null;

      const responseHeaders = new Headers(headers);
      const file = Bun.file(realPath);

      const shouldTryCompress =
        compressConfig.enabled &&
        stats.size >= compressConfig.minSize &&
        isCompressiblePath(realPath) &&
        (request.method === "GET" || request.method === "HEAD");

      if (shouldTryCompress) {
        const choice = negotiateCompression(request.headers.get("accept-encoding"), compressConfig.algorithms as CompressAlgorithm[]);

        if (choice) {
          responseHeaders.set("Content-Encoding", choice.contentEncoding);
          responseHeaders.set("Vary", mergeVary(responseHeaders.get("Vary") ?? undefined, "Accept-Encoding"));
          // Content-Type from Bun.file when available
          if (file.type) {
            responseHeaders.set("Content-Type", file.type);
          }

          // Bun accepts "brotli"; DOM CompressionStream typings often only list gzip/deflate.
          const makeCompressor = () => new CompressionStream(choice.streamFormat as unknown as CompressionFormat);

          if (request.method === "HEAD") {
            // Compress to know Content-Length without streaming a body.
            const raw = await file.arrayBuffer();
            const compressed = await new Response(new Blob([raw]).stream().pipeThrough(makeCompressor())).arrayBuffer();
            responseHeaders.set("Content-Length", String(compressed.byteLength));
            return new Response(null, { status, headers: responseHeaders });
          }

          const body = file.stream().pipeThrough(makeCompressor());
          return new Response(body, { status, headers: responseHeaders });
        }
      }

      // Content-Type for non-compressed responses (compressed path sets it above)
      if (file.type && !responseHeaders.has("Content-Type")) {
        responseHeaders.set("Content-Type", file.type);
      }

      return new Response(file, { status, headers: responseHeaders });
    };

    const notFound = async (request: Request): Promise<Response> => {
      if (notFoundFile) {
        const fallback = await serveFile(path.resolve(rootDir, notFoundFile), 404, request);
        if (fallback) return fallback;
      }
      return new Response("Not Found", { status: 404 });
    };

    this.routes[`${prefix}/*`] = async (request: Request) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }

      const url = new URL(request.url);

      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return new Response("Bad Request", { status: 400 }); // malformed %-escape
      }

      // NUL bytes and backslashes can confuse the syscall layer / Windows paths.
      if (pathname.includes("\0") || pathname.includes("\\")) {
        return new Response("Bad Request", { status: 400 });
      }

      if (!pathname.startsWith(prefix)) return notFound(request);

      let relative = pathname.slice(prefix.length);
      if (relative !== "" && !relative.startsWith("/")) return notFound(request); // e.g. /assetsevil

      // Collapse ".", ".." and duplicate slashes *after* decoding.
      relative = path.posix.normalize(relative || "/");
      if (relative.startsWith("../")) return new Response("Forbidden", { status: 403 });

      if (relative.endsWith("/")) {
        if (!indexFile) return notFound(request);
        relative += indexFile;
      }

      const fullPath = path.resolve(rootDir, `.${relative}`);
      return (await serveFile(fullPath, 200, request)) ?? (await notFound(request));
    };
  }
}
