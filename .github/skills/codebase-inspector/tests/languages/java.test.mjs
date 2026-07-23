import { fileURLToPath, URL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildSymbolIndex } from "../../lib/normalize/symbol-index.mjs";
import { createParserRegistry } from "../../lib/parsers/registry.mjs";

const skillDir = fileURLToPath(new URL("../..", import.meta.url));
let registry;

beforeAll(async () => { registry = await createParserRegistry(skillDir); });
afterAll(async () => { await registry.close(); });

test("keeps Java overload artifacts distinct and deterministic", async () => {
  const file = {
    path: "Runner.java",
    language: "java",
    category: "source",
    lineCount: 4,
    bytes: 100,
    content: "class Runner {\n  void run() {}\n  void run(int value) {}\n}\n"
  };
  const analysis = await registry.analyzeFile(file);
  const input = {
    project: { name: "fixture", root: null, gitCommitHash: "abc123", workingTreeDirty: false, languages: ["java"] },
    scan: { files: [file], unsupportedFiles: [], warnings: [], git: {} },
    analyses: [analysis],
    skillVersion: "0.2.0"
  };

  const first = buildSymbolIndex(input).symbolIndex;
  const second = buildSymbolIndex(input).symbolIndex;

  expect(analysis.functions).toEqual([]);
  expect(first.methods).toHaveLength(2);
  expect(new Set(first.methods.map((method) => method.id)).size).toBe(2);
  expect(first.methods.map((method) => method.parameters)).toEqual([
    [],
    [expect.objectContaining({ position: 0, name: "value", type: null, typeStatus: "unsupported" })]
  ]);
  expect(second).toEqual(first);
});
