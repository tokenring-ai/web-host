/** Browser-safe: no `bun` or `node:` imports, because the Users page validates names with it too. */

export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 32;

/** Lowercase letters, digits, `-` `_` `.`; must start with a letter or digit. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** Names that are harmless as map keys here but dangerous as object keys elsewhere. */
const RESERVED_USERNAMES = new Set(["__proto__", "constructor", "prototype", "hasownproperty", "tostring", "valueof"]);

/** Returns a message when `username` is not allowed for a managed account, otherwise null. */
export function usernameProblem(username: string): string | null {
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    return `Usernames must be ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters long.`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    return "Usernames may contain only lowercase letters, digits, '-', '_' and '.', and must start with a letter or digit.";
  }
  if (username.includes("..")) return "Usernames may not contain two dots in a row.";
  if (RESERVED_USERNAMES.has(username)) return "That username is reserved.";
  return null;
}

/** Managed usernames are case-insensitive: the canonical form is lowercase and trimmed. */
export function canonicalUsername(username: string): string {
  return username.trim().toLowerCase();
}
