import { execFile as execFileCallback } from "node:child_process";
import { access, cp, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { createFixtureRepo } from "../helpers/fixture-repo.mjs";

const execFile = promisify(execFileCallback);
const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactNames = [
  "analysis-report.json",
  "classes.md",
  "code-graph.json",
  "functions.md",
  "methods.md",
  "symbol-index.json"
];

async function exists(path) {
  return access(path).then(() => true, () => false);
}

test("a copied Skill installs production dependencies and produces all six artifacts", async () => {
  expect(await exists(join(skillDir, "SKILL.md"))).toBe(true);

  const root = await createFixtureRepo({
    "src/example.ts": [
      "export class Example {",
      "  run() {}",
      "}",
      "export function helper(value: number) { return value; }",
      ""
    ].join("\n")
  });
  const copiedSkill = join(root, ".github/skills/codebase-inspector");

  for (let ancestor = resolve(root); ancestor !== parse(ancestor).root; ancestor = dirname(ancestor)) {
    expect(basename(ancestor)).not.toBe("node_modules");
  }

  await mkdir(dirname(copiedSkill), { recursive: true });
  await cp(skillDir, copiedSkill, {
    recursive: true,
    filter: (source) => !source.includes(`${join(skillDir, "node_modules")}/`) && !source.endsWith("node_modules")
  });
  await execFile("npm", ["ci", "--omit=dev"], { cwd: copiedSkill, encoding: "utf8" });
  await execFile(process.execPath, [
    ".github/skills/codebase-inspector/scripts/run.mjs",
    "--skill-arguments",
    ""
  ], { cwd: root, encoding: "utf8" });

  const output = join(root, ".code-understanding");
  const artifacts = Object.fromEntries(await Promise.all(artifactNames.map(async (name) => [name, await readFile(join(output, name), "utf8")])));
  const { parseCodeGraph } = await import(pathToFileURL(join(copiedSkill, "lib/schema/code-graph.mjs")).href);
  const { parseSymbolIndex } = await import(pathToFileURL(join(copiedSkill, "lib/schema/symbol-index.mjs")).href);
  const { parseAnalysisReport } = await import(pathToFileURL(join(copiedSkill, "lib/schema/analysis-report.mjs")).href);

  expect(() => parseCodeGraph(JSON.parse(artifacts["code-graph.json"]))).not.toThrow();
  expect(() => parseSymbolIndex(JSON.parse(artifacts["symbol-index.json"]))).not.toThrow();
  expect(() => parseAnalysisReport(JSON.parse(artifacts["analysis-report.json"]))).not.toThrow();
  expect(artifacts["classes.md"]).toContain("| Name | Kind | File | Lines | Methods | Properties |");
  expect(artifacts["classes.md"]).toContain("| Example | class | src/example.ts |");
  expect(artifacts["methods.md"]).toContain("| Owner | Method | File | Lines | Parameters | Return |");
  expect(artifacts["methods.md"]).toContain("| Example | run | src/example.ts |");
  expect(artifacts["functions.md"]).toContain("| Function | File | Lines | Parameters | Return |");
  expect(artifacts["functions.md"]).toContain("| helper | src/example.ts |");
});
