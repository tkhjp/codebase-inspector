import { expect, test } from "vitest";
import { buildCodeGraph } from "../../lib/graph/build-code-graph.mjs";
import { parseCodeGraph } from "../../lib/schema/code-graph.mjs";

const symbolIndex = {
  schemaVersion: "1.0.0",
  project: { name: "fixture", root: null, gitCommitHash: "abc123", workingTreeDirty: false, languages: ["typescript"], skillVersion: "0.1.0" },
  files: [{ id: "file:src%2Fa.ts", path: "src/a.ts", language: "typescript", category: "source", lineCount: 12, parseStatus: "parsed", typeIds: ["type:src%2Fa.ts:class:Example:2"], methodIds: ["method:src%2Fa.ts:Example:run:4"], functionIds: ["function:src%2Fa.ts:helper:10"] }],
  types: [{ id: "type:src%2Fa.ts:class:Example:2", kind: "class", name: "Example", filePath: "src/a.ts", lineRange: [2, 8], properties: [{ name: "value", type: null, visibility: null, static: null, lineRange: [3, 3] }], methodIds: ["method:src%2Fa.ts:Example:run:4"], extends: [], implements: [], exported: true }],
  methods: [{ id: "method:src%2Fa.ts:Example:run:4", name: "run", ownerTypeId: "type:src%2Fa.ts:class:Example:2", filePath: "src/a.ts", lineRange: [4, 6], parameters: [], returnType: null, visibility: null, static: null, async: null, exported: null }],
  functions: [{ id: "function:src%2Fa.ts:helper:10", name: "helper", filePath: "src/a.ts", lineRange: [10, 11], parameters: [], returnType: null, visibility: null, async: null, exported: true }],
  imports: [{ sourceFileId: "file:src%2Fa.ts", targetFileId: "file:src%2Fa.ts", source: "./a", lineNumber: 1 }],
  calls: [{ callerId: "method:src%2Fa.ts:Example:run:4", calleeId: "function:src%2Fa.ts:helper:10", filePath: "src/a.ts", lineNumber: 5 }],
  unresolvedCalls: [{ callerId: "method:src%2Fa.ts:Example:run:4", calleeText: "missing", filePath: "src/a.ts", lineNumber: 6, reason: "callee-not-found" }],
  coverage: { trackedFiles: 1, supportedFiles: 1, parsedFiles: 1, warningFiles: 0, unsupportedFiles: 0 }
};

test("projects canonical symbols and resolved relationships without semantic enrichment", () => {
  const graph = buildCodeGraph(symbolIndex, { analyzedAt: "2026-07-23T01:02:03Z" });

  expect(graph.nodes).toEqual([
    { id: "file:src%2Fa.ts", type: "file", name: "src/a.ts", filePath: "src/a.ts", lineRange: null, summary: "", tags: [], complexity: "simple" },
    { id: "type:src%2Fa.ts:class:Example:2", type: "class", name: "Example", filePath: "src/a.ts", lineRange: [2, 8], summary: "", tags: [], complexity: "simple" },
    { id: "method:src%2Fa.ts:Example:run:4", type: "function", name: "run", filePath: "src/a.ts", lineRange: [4, 6], summary: "", tags: [], complexity: "simple" },
    { id: "function:src%2Fa.ts:helper:10", type: "function", name: "helper", filePath: "src/a.ts", lineRange: [10, 11], summary: "", tags: [], complexity: "simple" }
  ]);
  expect(graph.edges).toEqual([
    { source: "file:src%2Fa.ts", target: "type:src%2Fa.ts:class:Example:2", type: "contains", direction: "forward", weight: 1 },
    { source: "file:src%2Fa.ts", target: "method:src%2Fa.ts:Example:run:4", type: "contains", direction: "forward", weight: 1 },
    { source: "file:src%2Fa.ts", target: "function:src%2Fa.ts:helper:10", type: "contains", direction: "forward", weight: 1 },
    { source: "file:src%2Fa.ts", target: "file:src%2Fa.ts", type: "imports", direction: "forward", weight: 0.8 },
    { source: "method:src%2Fa.ts:Example:run:4", target: "function:src%2Fa.ts:helper:10", type: "calls", direction: "forward", weight: 0.7 }
  ]);
  expect(graph.project).toEqual({ name: "fixture", languages: ["typescript"], frameworks: [], description: "", analyzedAt: "2026-07-23T01:02:03Z", gitCommitHash: "abc123" });
  expect(graph.layers).toEqual([]);
  expect(graph.tour).toEqual([]);
  expect(parseCodeGraph(graph)).toEqual(graph);
});
