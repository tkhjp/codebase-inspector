import { fileURLToPath, URL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildSymbolIndex } from "../../lib/normalize/symbol-index.mjs";
import { createParserRegistry } from "../../lib/parsers/registry.mjs";

const skillDir = fileURLToPath(new URL("../..", import.meta.url));
let registry;

beforeAll(async () => { registry = await createParserRegistry(skillDir); });
afterAll(async () => { await registry.close(); });

test("keeps same-line C++ free-function overload artifacts distinct and deterministic", async () => {
  const content = "int run() { return 0; } int run(int value) { return value; }\n";
  const file = {
    path: "runner.cpp",
    language: "cpp",
    category: "source",
    lineCount: 1,
    bytes: Buffer.byteLength(content),
    content
  };
  const analysis = await registry.analyzeFile(file);
  const input = {
    project: { name: "fixture", root: null, gitCommitHash: "abc123", workingTreeDirty: false, languages: ["cpp"] },
    scan: { files: [file], unsupportedFiles: [], warnings: [], git: {} },
    analyses: [analysis],
    skillVersion: "0.1.0"
  };

  const first = buildSymbolIndex(input).symbolIndex;
  const second = buildSymbolIndex(input).symbolIndex;

  expect(first.functions).toHaveLength(2);
  expect(first.functions.map((func) => func.id)).toEqual([
    "function:runner.cpp:run:1",
    "function:runner.cpp:run:1:overload:2"
  ]);
  expect(second).toEqual(first);
});
