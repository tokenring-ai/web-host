import type {ParsedAuthConfig} from "./schema.ts";
import type {BunRequest, BunResponse} from "./types.ts";

/**
 * Check authentication for a request
 * Returns the authenticated username or null if auth fails
 */
export function checkAuth(
  request: BunRequest,
  config: ParsedAuthConfig,
): string | null {
  const auth = request.headers.get("authorization");

  if (!auth) {
    return null;
  }

  if (auth.startsWith("Bearer ")) {
    const token = auth.substring(7);
    for (const [username, creds] of Object.entries(config.users)) {
      if (creds.bearerToken === token) {
        return username;
      }
    }
  } else if (auth.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.substring(6), "base64").toString();
    if (!decoded.includes(":")) {
      return null;
    }
    const [username, password] = decoded.split(":");
    const user = config.users[username];
    if (user?.password === password) {
      return username;
    }
  }

  return null;
}

/**
 * Create unauthorized response
 */
export function unauthorizedResponse(response: BunResponse): Response {
  return response.json({error: "Unauthorized"}, 401);
}
