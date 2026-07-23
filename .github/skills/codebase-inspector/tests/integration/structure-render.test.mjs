import { execFileSync, spawnSync } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { afterEach, expect, test } from "vitest";
import { createFixtureRepo } from "../helpers/fixture-repo.mjs";

const skillDir = fileURLToPath(new URL("../..", import.meta.url));
const runScript = fileURLToPath(new URL("../../scripts/run.mjs", import.meta.url));
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function run(root, args) {
  return spawnSync(process.execPath, [runScript, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CODEBASE_INSPECTOR_SKIP_SETUP: "1" }
  });
}

test("analyzes once and renders the two Japanese documents from the saved snapshot", async () => {
  const root = await createFixtureRepo({
    "src/order.ts": [
      "export interface Identifiable { id: string }",
      "export class Order implements Identifiable {",
      "  public id: string;",
      "  constructor(id: string) { this.id = id; }",
      "  public find(input: string): Order { return new Order(input); }",
      "}"
    ].join("\n")
  });
  roots.push(root);
  const analyzed = run(root, ["analyze", ".", "--output", ".analysis", "--tracked"]);
  expect(analyzed.status, analyzed.stderr).toBe(0);
  const snapshotBefore = await readFile(`${root}/.analysis/symbol-index.json`, "utf8");

  const rendered = run(root, [
    "render",
    "--snapshot", ".analysis/symbol-index.json",
    "--output", ".docs",
    "--path", "src",
    "--language", "typescript"
  ]);
  expect(rendered.status, rendered.stderr).toBe(0);
  expect((await readdir(`${root}/.docs`)).sort()).toEqual([
    "structure-render-report.json",
    "クラス図.md",
    "クラス定義書.md"
  ]);
  expect(await readFile(`${root}/.analysis/symbol-index.json`, "utf8")).toBe(snapshotBefore);
  expect(await readFile(`${root}/.docs/クラス定義書.md`, "utf8")).toContain("### `Order`");
  expect(await readFile(`${root}/.docs/クラス図.md`, "utf8")).toContain("classDiagram");
  const report = JSON.parse(await readFile(`${root}/.docs/structure-render-report.json`, "utf8"));
  expect(report.selectedTypeCount).toBe(2);
  expect(report).toEqual(expect.objectContaining({
    outputDirectory: ".docs",
    definitionOutput: ".docs/クラス定義書.md",
    diagramOutput: ".docs/クラス図.md",
    parserIssues: [],
    omittedRelationCount: 0,
    resolvedCallCount: 0,
    unresolvedCallCount: 0,
    ambiguousCallCount: 0,
    dynamicCallCount: 0,
    unresolvedCalls: []
  }));
  expect(report.outputs).toEqual(["structure-render-report.json", "クラス図.md", "クラス定義書.md"]);
  expect(rendered.stdout).toContain("types=2/2");
  expect(rendered.stdout).toContain("definition=.docs/クラス定義書.md");

  execFileSync("git", ["-C", root, "status", "--short"]);
});

test("rejects a schema 1 snapshot with reanalysis guidance", async () => {
  const root = await createFixtureRepo({ "README.md": "fixture\n" });
  roots.push(root);
  await writeFile(`${root}/symbol-index.json`, JSON.stringify({ schemaVersion: "1.0.0" }));
  const rendered = run(root, ["render", "--snapshot", "symbol-index.json", "--output", ".docs"]);

  expect(rendered.status).toBe(1);
  expect(rendered.stderr).toContain("rerun /codebase-inspector analyze");
  expect(skillDir).toContain("codebase-inspector");
});
