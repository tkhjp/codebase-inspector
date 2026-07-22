import { expect, it } from "vitest";
import { parseRawFileAnalysis } from "../../lib/schema/raw-analysis.mjs";
import { parseSymbolIndex } from "../../lib/schema/symbol-index.mjs";

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
