import {z} from "zod";
import type {BunRouter, WebResource} from "./types.ts";

export const staticResourceConfigSchema = z.object({
  type: z.literal("static"),
  root: z.string(),
  description: z.string(),
  indexFile: z.string(),
  notFoundFile: z.string().optional(),
  prefix: z.string(),
});

export default class StaticResource implements WebResource {
  constructor(private config: z.output<typeof staticResourceConfigSchema>) {
  }

  register(router: BunRouter) {
    // Register static file serving
    router.static(this.config.prefix, this.config.root, {
      index: this.config.indexFile,
      notFound: this.config.notFoundFile,
    });
  }
}
