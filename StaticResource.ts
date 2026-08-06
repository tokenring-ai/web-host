import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { WebResource } from "./types.ts";

export const staticResourceConfigSchema = z.object({
  root: z.string(),
  indexFile: z.string().exactOptional(),
  notFoundFile: z.string().exactOptional(),
  prefix: z.string(),
  headers: z.record(z.string(), z.string()).exactOptional(),
});

/** True if `target` is `root` itself or lives underneath it. */
function isInside(root: string, target: string): boolean {
  if (target === root) return true;
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export default class StaticResource implements WebResource {
  routes: NonNullable<WebResource["routes"]> = {};

  constructor({ prefix, root, indexFile, notFoundFile, headers = {} }: z.output<typeof staticResourceConfigSchema>) {
    // Resolve the root exactly once, up front.
    const rootDir = path.resolve(root);

    /** Resolves symlinks, re-checks containment, and only serves regular files. */
    const serveFile = async (absPath: string, status: number): Promise<Response | null> => {
      if (!isInside(rootDir, absPath)) return null;

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

      return new Response(Bun.file(realPath), { status, headers });
    };

    const notFound = async (): Promise<Response> => {
      if (notFoundFile) {
        const fallback = await serveFile(path.resolve(rootDir, notFoundFile), 404);
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

      if (!pathname.startsWith(prefix)) return notFound();

      let relative = pathname.slice(prefix.length);
      if (relative !== "" && !relative.startsWith("/")) return notFound(); // e.g. /assetsevil

      // Collapse ".", ".." and duplicate slashes *after* decoding.
      relative = path.posix.normalize(relative || "/");
      if (relative.startsWith("../")) return new Response("Forbidden", { status: 403 });

      if (relative.endsWith("/")) {
        if (!indexFile) return notFound();
        relative += indexFile;
      }

      const fullPath = path.resolve(rootDir, `.${relative}`);
      return (await serveFile(fullPath, 200)) ?? (await notFound());
    };
  }
}
