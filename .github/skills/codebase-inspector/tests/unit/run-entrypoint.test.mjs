import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { isDirectExecution } from "../../scripts/run.mjs";

test("recognizes a direct invocation through an equivalent filesystem alias", async () => {
  const aliasPath = resolve("temporary-alias/skill/scripts/run.mjs");
  const canonicalPath = resolve("temporary-canonical/skill/scripts/run.mjs");
  const aliases = new Map([
    [aliasPath, canonicalPath],
    [canonicalPath, canonicalPath]
  ]);
  const realpathImpl = async (path) => aliases.get(path) ?? path;

  await expect(isDirectExecution(
    aliasPath,
    pathToFileURL(canonicalPath),
    realpathImpl
  )).resolves.toBe(true);
});

test("rejects an unrelated executable path", async () => {
  const unrelatedPath = resolve("temporary-other/run.mjs");
  const modulePath = resolve("temporary-skill/scripts/run.mjs");
  await expect(isDirectExecution(
    unrelatedPath,
    pathToFileURL(modulePath),
    async (path) => path
  )).resolves.toBe(false);
});
