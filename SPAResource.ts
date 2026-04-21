import path from "node:path";
import { z } from "zod";
import type { BunRequest, BunResponse, BunRouter, WebResource } from "./types.ts";

export const spaResourceConfigSchema = z.object({
  type: z.literal("spa"),
  file: z.string(),
  description: z.string(),
  prefix: z.string(),
});

export default class SPAResource implements WebResource {
  constructor(public config: z.output<typeof spaResourceConfigSchema>) {}

  register(router: BunRouter) {
    const root = path.dirname(this.config.file);

    // Register static file serving for the SPA directory
    router.static(this.config.prefix, root);

    // Handle the root path (both with and without trailing slash)
    router.get(this.config.prefix, async (_request: BunRequest, response: BunResponse) => {
      return await response.file(this.config.file);
    });

    // Handle root path with trailing slash
    router.get(this.config.prefix + "/", async (_request: BunRequest, response: BunResponse) => {
      return await response.file(this.config.file);
    });

    // Set a catch-all handler for SPA client-side routing
    router.fallback(async (request: BunRequest, response: BunResponse) => {
      // Only handle paths under this SPA's prefix
      if (!request.path.startsWith(this.config.prefix)) {
        // Return void to let other handlers process
        return;
      }

      const requestPath = request.path;
      const relativePath = requestPath.slice(this.config.prefix.length);

      // Check if the request looks like a static file (has a file extension)
      const hasExtension = /\.[^/.]+$/.test(path.basename(relativePath));

      if (hasExtension) {
        // It looks like a static file request
        // Check if the file exists
        const filePath = path.join(root, relativePath);
        const file = Bun.file(filePath);

        if (await file.exists()) {
          return new Response(file);
        }

        // File doesn't exist, return 404
        return response.text("File not found", 404);
      }

      // It's a client-side route, serve the SPA entry file
      return await response.file(this.config.file);
    });
  }
}
