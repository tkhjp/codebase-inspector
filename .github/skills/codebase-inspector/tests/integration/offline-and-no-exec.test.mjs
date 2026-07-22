import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { createFixtureRepo } from "../helpers/fixture-repo.mjs";

const execFile = promisify(execFileCallback);
const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function exists(path) {
  return access(path).then(() => true, () => false);
}

test("analysis works offline without executing target package scripts, Makefiles, or source", async () => {
  expect(await exists(join(skillDir, "SKILL.md"))).toBe(true);

  const root = await createFixtureRepo({
    "Makefile": "all:\n\t@touch .sentinel\n",
    "package.json": "{\"scripts\":{\"test\":\"touch .sentinel\",\"build\":\"touch .sentinel\"}}\n",
    "src/dangerous.js": "require('node:fs').writeFileSync('.sentinel', 'executed');\nexport const value = 1;\n"
  });
  const shimDirectory = await mkdtemp(join(tmpdir(), "codebase-inspector-network-shim-"));
  const shimPath = join(shimDirectory, "reject-network.cjs");
  const sentinel = join(root, ".sentinel");

  await writeFile(shimPath, [
    "const reject = () => { throw new Error('network access is forbidden during analysis'); };",
    "require('node:net').connect = reject;",
    "require('node:net').createConnection = reject;",
    "require('node:http').request = reject;",
    "require('node:https').request = reject;",
    "require('node:tls').connect = reject;"
  ].join("\n"));

  await execFile(process.execPath, ["scripts/run.mjs", root], {
    cwd: skillDir,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: `--require=${shimPath}` }
  });

  expect(await exists(sentinel)).toBe(false);
});
