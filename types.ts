import type { FastifyInstance } from "fastify";

export interface WebResource {
  name: string;
  register(server: FastifyInstance): Promise<void> | void;
}
