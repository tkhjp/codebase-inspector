import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { ensureRuntime } from "../../scripts/setup.mjs";
import { preflight } from "../../lib/runtime/preflight.mjs";
import { createFixtureRepo } from "../helpers/fixture-repo.mjs";

const execFile = promisify(execFileCallback);
const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runScript = join(skillDir, "scripts/run.mjs");
const artifactNames = [
  "analysis-report.json",
  "classes.md",
  "code-graph.json",
  "functions.md",
  "methods.md",
  "symbol-index.json"
];

async function runCli(root, args = []) {
  return execFile(process.execPath, [runScript, root, ...args], { encoding: "utf8" });
}

test("runs the standalone analysis and writes exactly six deterministic artifacts", async () => {
  const root = await createFixtureRepo({
    "src/greeter.ts": "export class Greeter {}\n",
    "tools/helper.py": "def helper(value: int) -> int:\n    return value + 1\n"
  });
  const commitTimestamp = (await execFile("git", ["-C", root, "show", "-s", "--format=%cI", "HEAD"], { encoding: "utf8" })).stdout.trim();

  const first = await runCli(root);
  const outputPath = join(root, ".code-understanding");
  const firstArtifacts = new Map(await Promise.all(artifactNames.map(async (name) => [name, await readFile(join(outputPath, name), "utf8")])));

  expect(first.stderr).toBe("");
  expect(first.stdout).toMatch(/Codebase Inspector: complete; output=/);
  expect((await readdir(outputPath)).sort()).toEqual(artifactNames);

  const symbolIndex = JSON.parse(firstArtifacts.get("symbol-index.json"));
  const codeGraph = JSON.parse(firstArtifacts.get("code-graph.json"));
  expect(symbolIndex.project).toMatchObject({
    name: basename(root),
    root: null,
    languages: ["python", "typescript"]
  });
  expect(symbolIndex.types.map((type) => type.name)).toContain("Greeter");
  expect(symbolIndex.functions.map((func) => func.name)).toContain("helper");
  expect(codeGraph.project.analyzedAt).toBe(commitTimestamp);

  await runCli(root);
  for (const name of artifactNames) {
    const rerun = await readFile(join(outputPath, name), "utf8");
    expect(rerun).toBe(firstArtifacts.get(name));
    expect(rerun).not.toContain(root);
    expect(rerun).not.toMatch(/\.tmp-|\.backup-/);
  }
});

test("enforces Node 22 before running npm and keeps npm scoped to the Skill", async () => {
  const calls = [];
  await expect(ensureRuntime({
    skillDir,
    nodeVersion: "21.9.0",
    runProcess: async (...args) => {
      calls.push(args);
      return 0;
    }
  })).rejects.toThrow(/Node\.js 22 or newer/);
  expect(calls).toEqual([]);

  await ensureRuntime({
    skillDir,
    nodeVersion: "22.0.0",
    runProcess: async (command, args, options) => {
      calls.push([command, args, options]);
      return 0;
    }
  });
  expect(calls.at(-1)).toEqual(expect.arrayContaining([
    expect.stringMatching(/^npm(?:\.cmd)?$/),
    ["ls", "--omit=dev", "--silent"],
    { cwd: skillDir, stdio: "ignore" }
  ]));

  const installCalls = [];
  await ensureRuntime({
    skillDir,
    nodeVersion: "22.0.0",
    runProcess: async (command, args, options) => {
      installCalls.push([command, args, options]);
      return installCalls.length === 1 ? 1 : 0;
    }
  });
  expect(installCalls).toEqual([
    [expect.stringMatching(/^npm(?:\.cmd)?$/), ["ls", "--omit=dev", "--silent"], { cwd: skillDir, stdio: "ignore" }],
    [expect.stringMatching(/^npm(?:\.cmd)?$/), ["ci", "--omit=dev"], { cwd: skillDir, stdio: "inherit" }],
    [expect.stringMatching(/^npm(?:\.cmd)?$/), ["ls", "--omit=dev", "--silent"], { cwd: skillDir, stdio: "ignore" }]
  ]);
});

test("preflight resolves Git metadata and rejects output outside the target root", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const canonicalRoot = await realpath(root);
  const nested = join(root, "src");
  const config = await preflight({ targetPath: nested, tracked: false, output: "generated", keepIntermediate: false }, skillDir);

  expect(config).toMatchObject({
    skillDir,
    targetRoot: canonicalRoot,
    outputPath: join(canonicalRoot, "generated"),
    gitDir: join(canonicalRoot, ".git"),
    options: { tracked: false, output: "generated", keepIntermediate: false }
  });
  expect(config.gitCommitHash).toMatch(/^[0-9a-f]{40}$/);
  expect(config.gitCommitTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  await expect(preflight({
    targetPath: root,
    tracked: false,
    output: "../outside",
    keepIntermediate: false
  }, skillDir)).rejects.toThrow(/output path must stay inside target root/i);

  await expect(preflight({
    targetPath: root,
    tracked: false,
    output: ".git/generated",
    keepIntermediate: false
  }, skillDir)).rejects.toThrow(/output path must not be inside the Git directory/i);
});
