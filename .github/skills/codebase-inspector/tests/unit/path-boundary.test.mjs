import { resolve } from "node:path";
import { expect, test } from "vitest";
import { rebasePathWithin } from "../../lib/runtime/path-boundary.mjs";

test("rebases a cwd-relative path onto the canonical cwd", () => {
  expect(rebasePathWithin("/short/repo/.docs", "/short/repo", "/canonical/repo"))
    .toBe(resolve("/canonical/repo/.docs"));
});

test("does not rebase a path outside the lexical cwd", () => {
  expect(rebasePathWithin("/outside/.docs", "/short/repo", "/canonical/repo"))
    .toBe(resolve("/outside/.docs"));
});
