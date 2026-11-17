import { describe, expect, it } from "bun:test";
import { canonicalUsername, usernameProblem } from "./usernames.ts";

describe("usernameProblem", () => {
  it("accepts ordinary names", () => {
    for (const name of ["al", "mark", "front-desk", "a.b_c-9", "x".repeat(32)]) expect(usernameProblem(name)).toBeNull();
  });

  it("rejects names that are too short, too long, or use other characters", () => {
    for (const name of [
      "",
      "a",
      "x".repeat(33),
      "Mark",
      "has space",
      "tab\t",
      "slash/name",
      "dot..",
      "..",
      "a\u0000b",
      "émile",
      "a@b",
      "-lead",
      ".lead",
      "_lead",
    ]) {
      expect(usernameProblem(name)).not.toBeNull();
    }
  });

  it("rejects names that are dangerous as object keys or paths", () => {
    for (const name of ["__proto__", "constructor", "prototype", "hasownproperty", "../etc", "a/../b"]) {
      expect(usernameProblem(name)).not.toBeNull();
    }
  });

  it("canonicalizes case and surrounding space", () => {
    expect(canonicalUsername("  MaRk ")).toBe("mark");
  });
});
