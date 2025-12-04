import fastifyStatic from "@fastify/static";
import type {WebResource} from "@tokenring-ai/web-host/types";
import type {FastifyInstance} from "fastify";
import {join} from 'path';
import {z} from "zod";

export const staticResourceConfigSchema = z.object({
  type: z.literal("static"),
  directory: z.string(),
  notFoundFile: z.string().optional(),
  prefix: z.string()
});

export default class StaticResource implements WebResource {
  name = "StaticResource";

  readonly directory: string;
  readonly notFoundFile: string | undefined;
  readonly prefix: string;

  constructor(config: z.output<typeof staticResourceConfigSchema>) {
    this.directory = config.directory;
    this.notFoundFile = config.notFoundFile;
    this.prefix = config.prefix;
  }

  async register(server: FastifyInstance): Promise<void> {
    await server.register(fastifyStatic, {
      root: this.directory,
      prefix: this.prefix,
    });

    if (this.notFoundFile) {
      server.setNotFoundHandler((request, reply) => {
        reply.sendFile(this.notFoundFile!);
      });
    }
  }
}
