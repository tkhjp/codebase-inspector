import { expect, test } from "vitest";
import { buildSymbolIndex } from "../../lib/normalize/symbol-index.mjs";
import { parseSymbolIndex } from "../../lib/schema/symbol-index.mjs";

const callable = (name, lineRange) => ({
  name,
  lineRange,
  parameters: [],
  returnType: null,
  visibility: null,
  async: null,
  exported: null
});

const project = {
  name: "fixture",
  root: null,
  gitCommitHash: "abc123",
  workingTreeDirty: false,
  languages: ["typescript"]
};

const scan = {
  files: [
    { path: "src/z.ts", language: "typescript", category: "source", lineCount: 20, bytes: 100, content: "ignored" }
  ],
  unsupportedFiles: [
    { path: "README.md", language: "unknown", category: "unsupported", lineCount: 3, bytes: 30 }
  ],
  warnings: [],
  git: {}
};

const analysis = {
  filePath: "src/z.ts",
  language: "typescript",
  types: [{
    kind: "class",
    name: "Greeter",
    lineRange: [2, 14],
    properties: [{ name: "message", type: null, visibility: null, static: null, lineRange: [3, 3] }],
    extends: ["Base"],
    implements: [],
    exported: true
  }],
  methods: [{ ...callable("run", [5, 9]), ownerName: "Greeter", static: null }],
  functions: [{ ...callable("helper", [16, 18]), exported: true }],
  importCandidates: [],
  callCandidates: [],
  warnings: ["upstream warning"]
};

test("builds schema-valid symbols with stable bidirectional memberships", () => {
  const result = buildSymbolIndex({ project, scan, analyses: [analysis], skillVersion: "0.1.0" });

  expect(result.symbolIndex.files.map((file) => file.path)).toEqual(["README.md", "src/z.ts"]);
  expect(result.symbolIndex.files).toEqual([
    {
      id: "file:README.md",
      path: "README.md",
      language: "unknown",
      category: "unsupported",
      lineCount: 3,
      parseStatus: "unsupported",
      typeIds: [],
      methodIds: [],
      functionIds: []
    },
    {
      id: "file:src%2Fz.ts",
      path: "src/z.ts",
      language: "typescript",
      category: "source",
      lineCount: 20,
      parseStatus: "warning",
      typeIds: ["type:src%2Fz.ts:class:Greeter:2"],
      methodIds: ["method:src%2Fz.ts:Greeter:run:5"],
      functionIds: ["function:src%2Fz.ts:helper:16"]
    }
  ]);
  expect(result.symbolIndex.types).toEqual([{
    id: "type:src%2Fz.ts:class:Greeter:2",
    kind: "class",
    name: "Greeter",
    filePath: "src/z.ts",
    lineRange: [2, 14],
    properties: analysis.types[0].properties,
    methodIds: ["method:src%2Fz.ts:Greeter:run:5"],
    extends: ["Base"],
    implements: [],
    exported: true
  }]);
  expect(result.symbolIndex.methods).toEqual([{
    id: "method:src%2Fz.ts:Greeter:run:5",
    name: "run",
    ownerTypeId: "type:src%2Fz.ts:class:Greeter:2",
    filePath: "src/z.ts",
    lineRange: [5, 9],
    parameters: [],
    returnType: null,
    visibility: null,
    async: null,
    exported: null,
    static: null
  }]);
  expect(result.symbolIndex.functions).toEqual([{
    id: "function:src%2Fz.ts:helper:16",
    name: "helper",
    filePath: "src/z.ts",
    lineRange: [16, 18],
    parameters: [],
    returnType: null,
    visibility: null,
    async: null,
    exported: true
  }]);
  expect(result.symbolIndex.coverage).toEqual({
    trackedFiles: 2,
    supportedFiles: 1,
    parsedFiles: 0,
    warningFiles: 1,
    unsupportedFiles: 1
  });
  expect(result.relationshipCounts).toEqual({
    internalImports: 0,
    externalImports: 0,
    unresolvedImports: 0,
    resolvedCalls: 0,
    unresolvedCalls: 0
  });
  expect(parseSymbolIndex(result.symbolIndex)).toEqual(result.symbolIndex);
});

test("produces the same canonical index for reordered scan and analysis inputs", () => {
  const secondScanFile = { path: "src/a.ts", language: "typescript", category: "source", lineCount: 1, bytes: 1, content: "x" };
  const secondAnalysis = {
    filePath: "src/a.ts",
    language: "typescript",
    types: [],
    methods: [],
    functions: [{ ...callable("alpha", [1, 1]) }],
    importCandidates: [],
    callCandidates: [],
    warnings: []
  };
  const left = buildSymbolIndex({ project, scan: { ...scan, files: [scan.files[0], secondScanFile] }, analyses: [analysis, secondAnalysis], skillVersion: "0.1.0" });
  const right = buildSymbolIndex({ project, scan: { ...scan, files: [secondScanFile, scan.files[0]] }, analyses: [secondAnalysis, analysis], skillVersion: "0.1.0" });

  expect(right).toEqual(left);
});

test("uses deterministic unique IDs when overloads share a start line", () => {
  const overloaded = {
    ...analysis,
    warnings: [],
    methods: [
      { ...callable("run", [5, 9]), ownerName: "Greeter", static: null },
      { ...callable("run", [5, 10]), ownerName: "Greeter", static: null, parameters: [{ name: "value", type: null }] }
    ],
    functions: []
  };

  const first = buildSymbolIndex({ project, scan, analyses: [overloaded], skillVersion: "0.1.0" }).symbolIndex;
  const second = buildSymbolIndex({ project, scan, analyses: [overloaded], skillVersion: "0.1.0" }).symbolIndex;

  expect(first.methods).toHaveLength(2);
  expect(new Set(first.methods.map((method) => method.id)).size).toBe(2);
  expect(second.methods).toEqual(first.methods);
});

test("uses deterministic collision-only IDs when free functions share a start line", () => {
  const overloaded = {
    ...analysis,
    warnings: [],
    methods: [],
    functions: [
      { ...callable("run", [5, 5]), parameters: [{ name: "value", type: null }] },
      { ...callable("run", [5, 5]) },
      { ...callable("helper", [8, 8]) }
    ]
  };

  const first = buildSymbolIndex({ project, scan, analyses: [overloaded], skillVersion: "0.1.0" }).symbolIndex;
  const reordered = { ...overloaded, functions: [...overloaded.functions].reverse() };
  const second = buildSymbolIndex({ project, scan, analyses: [reordered], skillVersion: "0.1.0" }).symbolIndex;

  expect(first.functions.map((func) => func.id)).toEqual([
    "function:src%2Fz.ts:run:5",
    "function:src%2Fz.ts:run:5:overload:2",
    "function:src%2Fz.ts:helper:8"
  ]);
  expect(second.functions).toEqual(first.functions);
});
