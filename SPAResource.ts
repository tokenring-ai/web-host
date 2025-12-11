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
      childContext.register(fastifyStatic, {root, index: fileName});
      childContext.setNotFoundHandler((request, reply) => {
        reply.sendFile(fileName);
      });
      done();
    }, { prefix: this.config.prefix });
  }
}
