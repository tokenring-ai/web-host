import fastifyStatic from "@fastify/static";
import type {WebResource} from "@tokenring-ai/web-host/types";
import type {FastifyInstance} from "fastify";
import path from 'path';
import {z} from "zod";
import fs from 'fs/promises';

export const spaResourceConfigSchema = z.object({
  type: z.literal("spa"),
  file: z.string(),
  description: z.string(),
  prefix: z.string()
});

export default class SPAResource implements WebResource {
  constructor(public config: z.output<typeof spaResourceConfigSchema>) {}

  async register(server: FastifyInstance): Promise<void> {
    try {
      await fs.access(this.config.file);
    } catch (error) {
      console.log(`SPA file does not exist: ${this.config.file}`);
    }

    const root = path.dirname(this.config.file);
    const fileName = path.basename(this.config.file);

    await server.register((childContext, _, done) => {
      // Register static file serving for the SPA directory
      // Static files (JS, CSS, images) will be served by this middleware
      childContext.register(fastifyStatic, {
        root,
        index: false, // Don't automatically serve index.html
      });

      // Handle the root path (both with and without trailing slash)
      // This serves index.html when navigating to /app or /app/
      childContext.get('/', async (request, reply) => {
        return reply.sendFile(fileName, root );
      });

      // Set not-found handler to serve index.html for all SPA routes
      // This handles client-side routing like /app/dashboard, /app/users/123, etc.
      // Static files are already handled by fastifyStatic middleware above
      childContext.setNotFoundHandler(async (request, reply) => {
        const requestPath = request.url;

        // Check if the request looks like a static file (has a file extension)
        const hasExtension = /\.[^/.]+$/.test(path.basename(requestPath));

        if (hasExtension) {
          // It looks like a static file request
          // Check if the file exists
          const filePath = path.join(root, requestPath);
          try {
            await fs.access(filePath);
            // File exists, but fastifyStatic didn't serve it (shouldn't happen, but just in case)
            return reply.sendFile(path.basename(requestPath), root);
          } catch {
            // File doesn't exist, return 404
            return reply.code(404).send('File not found');
          }
        }

        // It's a client-side route, serve index.html
        return reply.sendFile(fileName, root);
      });

      done();
    }, { prefix: this.config.prefix });
  }
}
