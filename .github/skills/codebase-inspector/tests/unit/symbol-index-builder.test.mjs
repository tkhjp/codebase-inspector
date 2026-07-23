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
  const result = buildSymbolIndex({ project, scan, analyses: [analysis], skillVersion: "0.2.0" });

  expect(result.symbolIndex.files.map((file) => file.path)).toEqual(["README.md", "src/z.ts"]);
  const sourceFile = result.symbolIndex.files.find((file) => file.path === "src/z.ts");
  expect(sourceFile).toEqual(expect.objectContaining({
    parseStatus: "warning",
    typeIds: [result.symbolIndex.types[0].id],
    propertyIds: [result.symbolIndex.properties[0].id],
    methodIds: [result.symbolIndex.methods[0].id],
    functionIds: [result.symbolIndex.functions[0].id]
  }));
  expect(result.symbolIndex.types[0]).toEqual(expect.objectContaining({
    kind: "class",
    name: "Greeter",
    qualifiedName: "Greeter",
    filePath: "src/z.ts",
    extends: ["Base"],
    exported: true
  }));
  expect(result.symbolIndex.properties[0]).toEqual(expect.objectContaining({
    name: "message",
    ownerTypeId: result.symbolIndex.types[0].id,
    typeStatus: "unsupported"
  }));
  expect(result.symbolIndex.methods[0]).toEqual(expect.objectContaining({
    kind: "method",
    name: "run",
    ownerTypeId: result.symbolIndex.types[0].id,
    filePath: "src/z.ts"
  }));
  expect(result.symbolIndex.functions[0]).toEqual(expect.objectContaining({
    kind: "function",
    name: "helper",
    filePath: "src/z.ts",
    exported: true
  }));
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
    unresolvedCalls: 0,
    ambiguousCalls: 0,
    dynamicCalls: 0
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
    "function:typescript:function:src%2Fz.ts%23run:",
    "function:typescript:function:src%2Fz.ts%23run:%3F",
    "function:typescript:function:src%2Fz.ts%23helper:"
  ]);
  expect(second.functions).toEqual(first.functions);
});
