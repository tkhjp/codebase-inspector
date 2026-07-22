import { expect, it } from "vitest";
import { parseAnalysisReport } from "../../lib/schema/analysis-report.mjs";
import { parseCodeGraph } from "../../lib/schema/code-graph.mjs";
import { parseRawFileAnalysis } from "../../lib/schema/raw-analysis.mjs";
import { parseSymbolIndex } from "../../lib/schema/symbol-index.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validSymbolIndex() {
  return {
    schemaVersion: "1.0.0",
    project: { name: "x", root: null, gitCommitHash: "a", workingTreeDirty: false, languages: ["typescript"], skillVersion: "0.1.0" },
    files: [
      { id: "file:a.ts", path: "a.ts", language: "typescript", category: "source", lineCount: 1, parseStatus: "parsed", typeIds: ["type:a.ts:class:A:1"], methodIds: ["method:a.ts:A:m:1"], functionIds: ["function:a.ts:f:1"] },
      { id: "file:b.ts", path: "b.ts", language: "typescript", category: "source", lineCount: 1, parseStatus: "parsed", typeIds: ["type:b.ts:class:B:1"], methodIds: ["method:b.ts:B:n:1"], functionIds: ["function:b.ts:g:1"] }
    ],
    types: [
      { id: "type:a.ts:class:A:1", kind: "class", name: "A", filePath: "a.ts", lineRange: [1, 1], properties: [], methodIds: ["method:a.ts:A:m:1"], extends: [], implements: [], exported: true },
      { id: "type:b.ts:class:B:1", kind: "class", name: "B", filePath: "b.ts", lineRange: [1, 1], properties: [], methodIds: ["method:b.ts:B:n:1"], extends: [], implements: [], exported: true }
    ],
    methods: [
      { id: "method:a.ts:A:m:1", name: "m", ownerTypeId: "type:a.ts:class:A:1", filePath: "a.ts", lineRange: [1, 1], parameters: [], returnType: null, visibility: null, static: null, async: null, exported: null },
      { id: "method:b.ts:B:n:1", name: "n", ownerTypeId: "type:b.ts:class:B:1", filePath: "b.ts", lineRange: [1, 1], parameters: [], returnType: null, visibility: null, static: null, async: null, exported: null }
    ],
    functions: [
      { id: "function:a.ts:f:1", name: "f", filePath: "a.ts", lineRange: [1, 1], parameters: [], returnType: null, visibility: null, async: null, exported: null },
      { id: "function:b.ts:g:1", name: "g", filePath: "b.ts", lineRange: [1, 1], parameters: [], returnType: null, visibility: null, async: null, exported: null }
    ],
    imports: [],
    calls: [{ callerId: "function:a.ts:f:1", calleeId: "method:a.ts:A:m:1", filePath: "a.ts", lineNumber: 1 }],
    unresolvedCalls: [{ callerId: "method:a.ts:A:m:1", calleeText: "missing", filePath: "a.ts", lineNumber: 1, reason: "callee-not-found" }],
    coverage: { trackedFiles: 2, supportedFiles: 2, parsedFiles: 2, warningFiles: 0, unsupportedFiles: 0 }
  };
}

function validCodeGraph() {
  return {
    version: "1.0.0",
    kind: "codebase",
    project: { name: "x", languages: ["typescript"], frameworks: [], description: "", analyzedAt: "2026-01-01T00:00:00Z", gitCommitHash: "a" },
    nodes: [{ id: "file:a.ts", type: "file", name: "a.ts", filePath: "a.ts", lineRange: null, summary: "", tags: [], complexity: "simple" }],
    edges: [],
    layers: [],
    tour: []
  };
}

function validAnalysisReport() {
  return {
    schemaVersion: "1.0.0",
    skillVersion: "0.1.0",
    status: "complete",
    coverage: { trackedFiles: 1, supportedFiles: 1, parsedFiles: 1, warningFiles: 0, unsupportedFiles: 0 },
    warnings: [],
    parserFailures: [],
    unsupportedFiles: [],
    relationships: { internalImports: 0, externalImports: 0, unresolvedImports: 0, resolvedCalls: 0, unresolvedCalls: 0 },
    options: { tracked: true, output: ".code-understanding", keepIntermediate: false }
  };
}

it("rejects source bodies and parameter defaults at the extractor boundary", () => {
  expect(() => parseRawFileAnalysis({ filePath: "a.ts", language: "typescript", types: [], methods: [], functions: [], importCandidates: [], callCandidates: [], warnings: [], sourceBody: "secret" })).toThrow();
  expect(() => parseRawFileAnalysis({ filePath: "a.ts", language: "typescript", types: [], methods: [], functions: [{ name: "f", lineRange: [1, 1], parameters: [{ name: "x", type: null, defaultValue: "secret" }], returnType: null, visibility: null, async: null, exported: null }], importCandidates: [], callCandidates: [], warnings: [] })).toThrow();
});

it("requires methods to reference an existing owner type", () => {
  const invalid = { schemaVersion: "1.0.0", project: { name: "x", root: null, gitCommitHash: "a", workingTreeDirty: false, languages: [], skillVersion: "0.1.0" }, files: [], types: [], methods: [{ id: "method:a:X:m:1", name: "m", ownerTypeId: "type:a:class:X:1", filePath: "a", lineRange: [1, 1], parameters: [], returnType: null, visibility: null, static: null, async: null, exported: null }], functions: [], imports: [], calls: [], unresolvedCalls: [], coverage: { trackedFiles: 0, supportedFiles: 0, parsedFiles: 0, warningFiles: 0, unsupportedFiles: 0 } };
  expect(() => parseSymbolIndex(invalid)).toThrow(/ownerTypeId/);
});

it("rejects dangling file, membership, import, and call references", () => {
  const invalid = {
    schemaVersion: "1.0.0",
    project: { name: "x", root: null, gitCommitHash: "a", workingTreeDirty: false, languages: [], skillVersion: "0.1.0" },
    files: [{ id: "file:a", path: "a", language: "typescript", category: "source", lineCount: 1, parseStatus: "parsed", typeIds: ["type:missing"], methodIds: ["method:missing"], functionIds: ["function:missing"] }],
    types: [],
    methods: [],
    functions: [],
    imports: [{ sourceFileId: "file:a", targetFileId: "file:missing", source: "./missing", lineNumber: 1 }],
    calls: [{ callerId: "function:missing", calleeId: "function:missing", filePath: "a", lineNumber: 1 }],
    unresolvedCalls: [],
    coverage: { trackedFiles: 1, supportedFiles: 1, parsedFiles: 1, warningFiles: 0, unsupportedFiles: 0 }
  };
  expect(() => parseSymbolIndex(invalid)).toThrow(/typeIds|methodIds|functionIds|targetFileId|callerId/);
});

it.each([
  ["File", "files"],
  ["Type", "types"],
  ["Method", "methods"],
  ["Function", "functions"]
])("rejects duplicate %s IDs", (recordName, collectionName) => {
  const invalid = validSymbolIndex();
  invalid[collectionName].push(clone(invalid[collectionName][0]));
  expect(() => parseSymbolIndex(invalid)).toThrow(new RegExp(`Duplicate ${recordName} ID`));
});

it("rejects a Method and Function ID collision", () => {
  const invalid = validSymbolIndex();
  const id = invalid.methods[0].id;
  invalid.functions[0].id = id;
  invalid.files[0].functionIds = [id];
  invalid.calls[0].callerId = id;
  expect(() => parseSymbolIndex(invalid)).toThrow(/Duplicate global ID/);
});

it("rejects a File and Type ID collision", () => {
  const invalid = validSymbolIndex();
  const id = invalid.files[0].id;
  invalid.types[0].id = id;
  invalid.files[0].typeIds = [id];
  invalid.methods[0].ownerTypeId = id;
  expect(() => parseSymbolIndex(invalid)).toThrow(/Duplicate global ID/);
});

it.each([
  ["types", "Type"],
  ["methods", "Method"],
  ["functions", "Function"]
])("requires every %s filePath to match a File path", (collectionName, recordName) => {
  const invalid = validSymbolIndex();
  invalid[collectionName][0].filePath = "missing.ts";
  expect(() => parseSymbolIndex(invalid)).toThrow(new RegExp(`${recordName} filePath`));
});

it("accepts a fully coherent SymbolIndex", () => {
  expect(parseSymbolIndex(validSymbolIndex())).toEqual(validSymbolIndex());
});

it("rejects duplicate File paths", () => {
  const invalid = validSymbolIndex();
  invalid.files[1].path = "a.ts";
  expect(() => parseSymbolIndex(invalid)).toThrow(/Duplicate File path/);
});

it.each([
  ["typeIds", "type:a.ts:class:A:1"],
  ["methodIds", "method:a.ts:A:m:1"],
  ["functionIds", "function:a.ts:f:1"]
])("rejects duplicate File %s entries", (membership, id) => {
  const invalid = validSymbolIndex();
  invalid.files[0][membership].push(id);
  expect(() => parseSymbolIndex(invalid)).toThrow(new RegExp(`Duplicate File ${membership} entry`));
});

it.each([
  ["Type", "typeIds", "type:a.ts:class:A:1"],
  ["Function", "functionIds", "function:a.ts:f:1"]
])("requires every %s to appear exactly once in its matching File only", (recordName, membership, id) => {
  const missing = validSymbolIndex();
  missing.files[0][membership] = [];
  expect(() => parseSymbolIndex(missing)).toThrow(new RegExp(`Missing ${recordName} membership`));
  const misplaced = validSymbolIndex();
  misplaced.files[1][membership].push(id);
  expect(() => parseSymbolIndex(misplaced)).toThrow(new RegExp(`${recordName}.*matching File`));
});

it("requires every Method to appear exactly once in its matching File and owner Type", () => {
  const missingFile = validSymbolIndex();
  missingFile.files[0].methodIds = [];
  expect(() => parseSymbolIndex(missingFile)).toThrow(/Missing Method File membership/);
  const misplacedFile = validSymbolIndex();
  misplacedFile.files[1].methodIds.push("method:a.ts:A:m:1");
  expect(() => parseSymbolIndex(misplacedFile)).toThrow(/Method.*matching File/);
  const missingOwner = validSymbolIndex();
  missingOwner.types[0].methodIds = [];
  expect(() => parseSymbolIndex(missingOwner)).toThrow(/Missing Method owner Type membership/);
});

it("rejects duplicate Method membership in an owner Type", () => {
  const duplicateOwner = validSymbolIndex();
  duplicateOwner.types[0].methodIds.push("method:a.ts:A:m:1");
  expect(() => parseSymbolIndex(duplicateOwner)).toThrow(/Duplicate Type methodIds entry/);
});

it("requires Type method membership and Method owners to share the Type file", () => {
  const wrongTypeEntry = validSymbolIndex();
  wrongTypeEntry.types[0].methodIds = ["method:b.ts:B:n:1"];
  expect(() => parseSymbolIndex(wrongTypeEntry)).toThrow(/Type methodIds entry must match Method owner and file/);
  const crossFileOwner = validSymbolIndex();
  crossFileOwner.methods[0].ownerTypeId = "type:b.ts:class:B:1";
  expect(() => parseSymbolIndex(crossFileOwner)).toThrow(/Method owner Type must share Method filePath/);
});

it.each([
  ["calls", "Call"],
  ["unresolvedCalls", "Unresolved call"]
])("requires every %s filePath to reference a File", (collectionName, recordName) => {
  const invalid = validSymbolIndex();
  invalid[collectionName][0].filePath = "missing.ts";
  expect(() => parseSymbolIndex(invalid)).toThrow(new RegExp(`${recordName} filePath`));
});

it.each([
  ["calls", "Call"],
  ["unresolvedCalls", "Unresolved call"]
])("requires every %s filePath to match its known caller", (collectionName, recordName) => {
  const invalid = validSymbolIndex();
  invalid[collectionName][0].filePath = "b.ts";
  expect(() => parseSymbolIndex(invalid)).toThrow(new RegExp(`${recordName} filePath must match caller`));
});

it("parses a valid CodeGraph and rejects an edge to an unknown node", () => {
  expect(parseCodeGraph(validCodeGraph())).toEqual(validCodeGraph());
  const missingTarget = validCodeGraph();
  missingTarget.edges.push({ source: "file:a.ts", target: "function:missing", type: "contains", direction: "forward", weight: 1 });
  expect(() => parseCodeGraph(missingTarget)).toThrow(/target/);
  const missingSource = validCodeGraph();
  missingSource.edges.push({ source: "function:missing", target: "file:a.ts", type: "contains", direction: "forward", weight: 1 });
  expect(() => parseCodeGraph(missingSource)).toThrow(/source/);
});

it("rejects duplicate CodeGraph node IDs", () => {
  const invalid = validCodeGraph();
  invalid.nodes.push(clone(invalid.nodes[0]));
  expect(() => parseCodeGraph(invalid)).toThrow(/Duplicate node ID/);
});

it("parses a minimal AnalysisReport and rejects unknown fields", () => {
  expect(parseAnalysisReport(validAnalysisReport())).toEqual(validAnalysisReport());
  expect(() => parseAnalysisReport({ ...validAnalysisReport(), extra: true })).toThrow();
});
