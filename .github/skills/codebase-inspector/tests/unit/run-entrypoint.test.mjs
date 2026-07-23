import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { isDirectExecution } from "../../scripts/run.mjs";

test("recognizes a direct invocation through an equivalent filesystem alias", async () => {
  const aliases = new Map([
    ["/tmp/skill/scripts/run.mjs", "/private/tmp/skill/scripts/run.mjs"],
    ["/private/tmp/skill/scripts/run.mjs", "/private/tmp/skill/scripts/run.mjs"]
  ]);
  const realpathImpl = async (path) => aliases.get(path) ?? path;

  await expect(isDirectExecution(
    "/tmp/skill/scripts/run.mjs",
    pathToFileURL("/private/tmp/skill/scripts/run.mjs"),
    realpathImpl
  )).resolves.toBe(true);
});

test("rejects an unrelated executable path", async () => {
  await expect(isDirectExecution(
    "/tmp/other.mjs",
    pathToFileURL("/tmp/skill/scripts/run.mjs"),
    async (path) => path
  )).resolves.toBe(false);
});
