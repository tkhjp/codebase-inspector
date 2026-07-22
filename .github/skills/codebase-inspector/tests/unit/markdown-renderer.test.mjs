import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { expect, test } from "vitest";
import { serializeArtifacts } from "../../lib/output/artifacts.mjs";
import { renderMarkdownIndexes } from "../../lib/reports/render-markdown.mjs";

const symbolIndex = {
  schemaVersion: "1.0.0",
  project: { name: "fixture", root: null, gitCommitHash: "abc123", workingTreeDirty: false, languages: ["typescript"], skillVersion: "0.1.0" },
  files: [{ id: "file:src%2Fa.ts", path: "src/a.ts", language: "typescript", category: "source", lineCount: 12, parseStatus: "parsed", typeIds: ["type:src%2Fa.ts:class:Example%7CType:2"], methodIds: ["method:src%2Fa.ts:Example%7CType:run:4"], functionIds: ["function:src%2Fa.ts:helper:10"] }],
  types: [{ id: "type:src%2Fa.ts:class:Example%7CType:2", kind: "class", name: "Example|Type", filePath: "src/a.ts", lineRange: [2, 8], properties: [{ name: "value", type: null, visibility: null, static: null, lineRange: [3, 3] }], methodIds: ["method:src%2Fa.ts:Example%7CType:run:4"], extends: [], implements: [], exported: true }],
  methods: [{ id: "method:src%2Fa.ts:Example%7CType:run:4", name: "run", ownerTypeId: "type:src%2Fa.ts:class:Example%7CType:2", filePath: "src/a.ts", lineRange: [4, 6], parameters: [{ name: "label|line\nvalue", type: null }], returnType: "Result\nType", visibility: null, static: null, async: null, exported: null }],
  functions: [{ id: "function:src%2Fa.ts:helper:10", name: "helper", filePath: "src/a.ts", lineRange: [10, 11], parameters: [{ name: "count", type: "number" }], returnType: null, visibility: null, async: null, exported: true }],
  imports: [], calls: [], unresolvedCalls: [],
  coverage: { trackedFiles: 1, supportedFiles: 1, parsedFiles: 1, warningFiles: 0, unsupportedFiles: 0 }
};

async function golden(name) {
  return readFile(new URL(`../fixtures/golden/${name}`, import.meta.url), "utf8");
}

test("renders sorted LF-normalized fact-only Markdown indexes matching golden files", async () => {
  const markdown = renderMarkdownIndexes(symbolIndex);

  expect(markdown["classes.md"]).toBe(await golden("classes.md"));
  expect(markdown["methods.md"]).toBe(await golden("methods.md"));
  expect(markdown["functions.md"]).toBe(await golden("functions.md"));
  expect(Object.values(markdown).every((value) => value.endsWith("\n") && !value.endsWith("\n\n"))).toBe(true);
  expect(Object.values(markdown).join("\n")).not.toMatch(/2026|generated|timestamp/i);
});

test("serializes exactly the validated JSON and Markdown artifact names", () => {
  const markdown = renderMarkdownIndexes(symbolIndex);
  const codeGraph = {
    version: "1.0.0", kind: "codebase",
    project: { name: "fixture", languages: ["typescript"], frameworks: [], description: "", analyzedAt: "2026-07-23T01:02:03Z", gitCommitHash: "abc123" },
    nodes: [], edges: [], layers: [], tour: []
  };
  const report = {
    schemaVersion: "1.0.0", skillVersion: "0.1.0", status: "complete", coverage: symbolIndex.coverage,
    warnings: [], parserFailures: [], unsupportedFiles: [],
    relationships: { internalImports: 0, externalImports: 0, unresolvedImports: 0, resolvedCalls: 0, unresolvedCalls: 0 },
    options: { tracked: false, output: ".code-understanding", keepIntermediate: false }
  };

  const artifacts = serializeArtifacts({ symbolIndex, codeGraph, report, markdown: { ...markdown, "extra.md": "nope" } });

  expect([...artifacts.keys()]).toEqual(["symbol-index.json", "code-graph.json", "analysis-report.json", "classes.md", "methods.md", "functions.md"]);
  expect([...artifacts.values()].every((value) => value.endsWith("\n") && !value.endsWith("\n\n"))).toBe(true);
});
