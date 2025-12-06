import type {FastifyInstance, FastifyRequest, FastifyReply} from "fastify";
import {z} from "zod";

export const AuthConfigSchema = z.object({
  users: z.record(z.string(), z.object({
    password: z.string().optional(),
    bearerToken: z.string().optional(),
  }))
});

export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export function registerAuth(server: FastifyInstance, config: AuthConfig) {
  server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization;
    
    if (!auth) {
      reply.code(401).send({error: "Unauthorized"});
      return;
    }

    if (auth.startsWith("Bearer ")) {
      const token = auth.substring(7);
      for (const [username, creds] of Object.entries(config.users)) {
        if (creds.bearerToken === token) {
          (request as any).user = username;
          return;
        }
      }
    } else if (auth.startsWith("Basic ")) {
      const decoded = Buffer.from(auth.substring(6), "base64").toString();
      const [username, password] = decoded.split(":");
      const user = config.users[username];
      if (user?.password === password) {
        (request as any).user = username;
        return;
      }
    }

    reply.code(401).send({error: "Unauthorized"});
  });
}
