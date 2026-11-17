import type { RPCSchema } from "@tokenring-ai/rpc/types";
import { z } from "zod";
import { USERNAME_MAX_LENGTH } from "../usernames.ts";

// Browser-safe: the frontend imports this file. No `bun` or `node:` imports here or in anything it imports.

export const UserRoleSchema = z.enum(["admin", "member"]);

const UsernameInput = z
  .string()
  .min(1)
  .max(USERNAME_MAX_LENGTH + 8);

export const UserSummarySchema = z.object({
  username: z.string(),
  role: UserRoleSchema,
  /** "config" accounts come from the configuration file and are read-only here. */
  source: z.enum(["config", "managed"]),
  hasPassword: z.boolean(),
  createdAt: z.number().nullable(),
  createdBy: z.string().nullable(),
  lastLoginAt: z.number().nullable(),
  activeSessions: z.number(),
  pendingAccessLinks: z.number(),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export const AccessLinkSummarySchema = z.object({
  id: z.string(),
  username: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  createdBy: z.string().nullable(),
});

/** Shown exactly once, when it is created. The server keeps only a hash. */
export const IssuedAccessLinkSchema = z.object({
  id: z.string(),
  /** Full link, `<base>/#access=<token>`; this is what a QR code encodes. Treat it like a password. */
  url: z.string(),
  expiresAt: z.number(),
});

const LinkMinutes = z
  .number()
  .int()
  .min(15)
  .max(7 * 24 * 60);

export default {
  name: "Users RPC",
  path: "/rpc/users",
  methods: {
    /** Who the caller is. Open to every signed-in user. */
    getMe: {
      type: "query",
      input: z.object({}),
      result: z.object({ username: z.string(), role: UserRoleSchema, source: z.enum(["config", "managed"]) }),
    },
    getRemoteAccessInfo: {
      type: "query",
      input: z.object({}),
      result: z.object({
        /** Where phones and other computers should point: the configured public URL, else this request's own address. */
        baseUrl: z.string(),
        baseUrlSource: z.enum(["configured", "request", "derived"]),
        /** True when baseUrl is localhost: a link built from it cannot be opened from another device. */
        isLoopback: z.boolean(),
        isHttps: z.boolean(),
        warnings: z.array(z.string()),
        /** Why managed users cannot be created, or null when they can. */
        storeProblem: z.string().nullable(),
      }),
    },
    listUsers: {
      type: "query",
      input: z.object({}),
      result: z.object({ users: z.array(UserSummarySchema), storeProblem: z.string().nullable() }),
    },
    listAccessLinks: {
      type: "query",
      input: z.object({}),
      result: z.object({ links: z.array(AccessLinkSummarySchema) }),
    },
    createUser: {
      type: "mutation",
      input: z.object({
        username: UsernameInput,
        role: UserRoleSchema,
        method: z.enum(["accessLink", "password"]),
        /** Only for method "password". Omit to have a strong one generated. */
        password: z.string().min(1).max(256).exactOptional(),
        /** Only for method "accessLink". 15 minutes to 7 days; default 24 hours. */
        expiresInMinutes: LinkMinutes.exactOptional(),
      }),
      result: z.object({
        user: UserSummarySchema,
        link: IssuedAccessLinkSchema.exactOptional(),
        /** Present only when the server generated the password; shown once. */
        generatedPassword: z.string().exactOptional(),
      }),
    },
    createAccessLink: {
      type: "mutation",
      input: z.object({ username: UsernameInput, expiresInMinutes: LinkMinutes.exactOptional() }),
      result: IssuedAccessLinkSchema,
    },
    /** Signs the caller in on another device, as themselves. Open to every signed-in user. */
    createMyAccessLink: {
      type: "mutation",
      input: z.object({ expiresInMinutes: LinkMinutes.exactOptional() }),
      result: IssuedAccessLinkSchema,
    },
    setPassword: {
      type: "mutation",
      input: z.object({ username: UsernameInput, password: z.string().min(1).max(256).exactOptional() }),
      result: z.object({ generatedPassword: z.string().exactOptional() }),
    },
    setRole: {
      type: "mutation",
      input: z.object({ username: UsernameInput, role: UserRoleSchema }),
      result: z.object({ ok: z.literal(true) }),
    },
    signOutUser: {
      type: "mutation",
      input: z.object({ username: UsernameInput }),
      result: z.object({ ok: z.literal(true) }),
    },
    removeUser: {
      type: "mutation",
      input: z.object({ username: UsernameInput }),
      result: z.object({ ok: z.literal(true) }),
    },
    revokeAccessLink: {
      type: "mutation",
      input: z.object({ id: z.string().min(1).max(64) }),
      result: z.object({ revoked: z.boolean() }),
    },
  },
} satisfies RPCSchema;
