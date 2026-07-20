import { z } from "zod";
import type { BunRequest, BunResponse, BunRouter, WebResource } from "./types.ts";

export const FallbackResourceConfigSchema = z.object({
  file: z.string(),
});

export default class FallbackResource implements WebResource {
  constructor(public config: z.output<typeof FallbackResourceConfigSchema>) {}

  register(router: BunRouter) {
    router.fallback(async (_request: BunRequest, response: BunResponse) => {
      return await response.file(this.config.file);
    });
  }
}
