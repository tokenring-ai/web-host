import fastifyStatic from "@fastify/static";
import type {WebResource} from "@tokenring-ai/web-host/types";
import type {FastifyInstance} from "fastify";
import {join} from 'path';
import {z} from "zod";

export const staticResourceConfigSchema = z.object({
  type: z.literal("static"),
  root: z.string(),
  description: z.string(),
  indexFile: z.string(),
  notFoundFile: z.string().optional(),
  prefix: z.string()
});

export default class StaticResource implements WebResource {
  name = "StaticResource";

  constructor(private config: z.output<typeof staticResourceConfigSchema>) {}

  async register(server: FastifyInstance): Promise<void> {
    await server.register(fastifyStatic, {
      root: this.config.root,
      prefix: this.config.prefix,
      index: this.config.indexFile
    });

    if (this.config.notFoundFile) {
      server.setNotFoundHandler((request, reply) => {
        reply.sendFile(this.config.notFoundFile!); //, this.config.root);
      });
    }
  }
}
