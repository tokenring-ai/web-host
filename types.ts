import type {FastifyInstance} from "fastify";

export interface WebResource {
  register(server: FastifyInstance): Promise<void>;
}
