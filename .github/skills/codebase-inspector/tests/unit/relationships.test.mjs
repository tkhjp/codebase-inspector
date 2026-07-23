import { expect, test } from "vitest";
import { resolveRelationships } from "../../lib/normalize/relationships.mjs";

const file = (path) => ({ id: `file:${path}`, path });
const func = (id, name, filePath) => ({ id, name, filePath });
const method = (id, name, filePath, ownerTypeId) => ({ id, name, filePath, ownerTypeId });

function draft({ files, functions = [], methods = [], types = [] }) {
  return { files, functions, methods, types };
}

function raw(filePath, { imports = [], calls = [] } = {}) {
  return {
    filePath,
    importCandidates: imports,
    callCandidates: calls
  };
}

test("resolves only unique tracked relative imports through the bounded candidates", () => {
  const indexDraft = draft({ files: [
    file("src/main.ts"),
    file("src/exact"),
    file("src/module.ts"),
    file("src/pkg/index.ts"),
    file("src/ambiguous.js"),
    file("src/ambiguous.ts")
  ] });
  const analyses = [raw("src/main.ts", { imports: [
    { source: "./exact", specifiers: [], lineNumber: 1, kind: "module" },
    { source: "./module", specifiers: [], lineNumber: 2, kind: "module" },
    { source: "./pkg", specifiers: [], lineNumber: 3, kind: "module" },
    { source: "./ambiguous", specifiers: [], lineNumber: 4, kind: "module" },
    { source: "external-package", specifiers: [], lineNumber: 5, kind: "module" },
    { source: "./missing", specifiers: [], lineNumber: 6, kind: "module" }
  ] })];

  expect(resolveRelationships(indexDraft, analyses)).toEqual({
    imports: [
      { sourceFileId: "file:src/main.ts", targetFileId: "file:src/exact", source: "./exact", lineNumber: 1 },
      { sourceFileId: "file:src/main.ts", targetFileId: "file:src/module.ts", source: "./module", lineNumber: 2 },
      { sourceFileId: "file:src/main.ts", targetFileId: "file:src/pkg/index.ts", source: "./pkg", lineNumber: 3 }
    ],
    calls: [],
    unresolvedCalls: [],
    relationshipCounts: {
      internalImports: 3,
      externalImports: 1,
      unresolvedImports: 2,
      resolvedCalls: 0,
      unresolvedCalls: 0
    }
  });
});

test("uses the upstream-resolved import map for non-relative language imports", () => {
  const indexDraft = draft({ files: [
    file("app/main.py"),
    file("app/services/__init__.py"),
    file("app/services/worker.py")
  ] });
  const analyses = [raw("app/main.py", { imports: [
    { source: "app.services", specifiers: ["worker"], lineNumber: 1, kind: "module" },
    { source: "requests", specifiers: [], lineNumber: 2, kind: "module" }
  ] })];
  const resolvedImports = new Map([["app/main.py", [
    { targetPath: "app/services/__init__.py", source: "app.services", lineNumber: 1 },
    { targetPath: "app/services/worker.py", source: "app.services", lineNumber: 1 }
  ]]]);

  const result = resolveRelationships(indexDraft, analyses, resolvedImports);

  expect(result.imports).toEqual([
    { sourceFileId: "file:app/main.py", targetFileId: "file:app/services/__init__.py", source: "app.services", lineNumber: 1 },
    { sourceFileId: "file:app/main.py", targetFileId: "file:app/services/worker.py", source: "app.services", lineNumber: 1 }
  ]);
  expect(result.relationshipCounts).toMatchObject({
    internalImports: 2,
    externalImports: 1,
    unresolvedImports: 0
  });
});

test("resolves calls only for a unique same-file caller and unique project-wide callable name", () => {
  const indexDraft = draft({
    files: [file("src/a.ts"), file("src/b.ts")],
    types: [
      { id: "type:A", name: "A", filePath: "src/a.ts" },
      { id: "type:B", name: "B", filePath: "src/a.ts" }
    ],
    methods: [
      method("method:A.run", "run", "src/a.ts", "type:A"),
      method("method:B.run", "run", "src/a.ts", "type:B")
    ],
    functions: [
      func("function:a.caller", "caller", "src/a.ts"),
      func("function:a.unique", "unique", "src/a.ts"),
      func("function:a.duplicate", "duplicate", "src/a.ts"),
      func("function:b.duplicate", "duplicate", "src/b.ts")
    ]
  });
  const analyses = [raw("src/a.ts", { calls: [
    { callerName: "caller", callerOwnerName: null, calleeText: "unique", lineNumber: 10 },
    { callerName: "run", callerOwnerName: "A", calleeText: "unique", lineNumber: 11 },
    { callerName: "run", callerOwnerName: null, calleeText: "unique", lineNumber: 12 },
    { callerName: "missing", callerOwnerName: null, calleeText: "unique", lineNumber: 13 },
    { callerName: "caller", callerOwnerName: null, calleeText: "missing", lineNumber: 14 },
    { callerName: "caller", callerOwnerName: null, calleeText: "duplicate", lineNumber: 15 },
    { callerName: null, callerOwnerName: null, calleeText: "unique", lineNumber: 16 },
    { callerName: "caller", callerOwnerName: null, calleeText: "service.unique", lineNumber: 17 }
  ] })];

  expect(resolveRelationships(indexDraft, analyses)).toEqual({
    imports: [],
    calls: [
      { callerId: "function:a.caller", calleeId: "function:a.unique", filePath: "src/a.ts", lineNumber: 10 },
      { callerId: "method:A.run", calleeId: "function:a.unique", filePath: "src/a.ts", lineNumber: 11 }
    ],
    unresolvedCalls: [
      { callerId: null, calleeText: "unique", filePath: "src/a.ts", lineNumber: 12, reason: "caller-not-found" },
      { callerId: null, calleeText: "unique", filePath: "src/a.ts", lineNumber: 13, reason: "caller-not-found" },
      { callerId: "function:a.caller", calleeText: "missing", filePath: "src/a.ts", lineNumber: 14, reason: "callee-not-found" },
      { callerId: "function:a.caller", calleeText: "duplicate", filePath: "src/a.ts", lineNumber: 15, reason: "ambiguous-callee" },
      { callerId: null, calleeText: "unique", filePath: "src/a.ts", lineNumber: 16, reason: "caller-not-found" },
      { callerId: "function:a.caller", calleeText: "service.unique", filePath: "src/a.ts", lineNumber: 17, reason: "dynamic-call" }
    ],
    relationshipCounts: {
      internalImports: 0,
      externalImports: 0,
      unresolvedImports: 0,
      resolvedCalls: 2,
      unresolvedCalls: 6
    }
  });
});

test("sorts relationships deterministically regardless of raw analysis order", () => {
  const indexDraft = draft({
    files: [file("b.ts"), file("a.ts")],
    functions: [func("function:b", "b", "b.ts"), func("function:a", "a", "a.ts")]
  });
  const a = raw("a.ts", { calls: [{ callerName: "a", callerOwnerName: null, calleeText: "b", lineNumber: 2 }] });
  const b = raw("b.ts", { calls: [{ callerName: "b", callerOwnerName: null, calleeText: "a", lineNumber: 1 }] });

  expect(resolveRelationships(indexDraft, [b, a])).toEqual(resolveRelationships(indexDraft, [a, b]));
});

test("classifies receiver and member calls as dynamic before exact-name lookup", () => {
  const indexDraft = draft({
    files: [file("src/a.ts")],
    functions: [
      func("caller", "caller", "src/a.ts"),
      func("dot", "service.run", "src/a.ts"),
      func("scope", "A::run", "src/a.ts"),
      func("arrow", "ptr->run", "src/a.ts")
    ]
  });
  const analyses = [raw("src/a.ts", { calls: [
    { callerName: "caller", callerOwnerName: null, calleeText: "service.run", lineNumber: 1 },
    { callerName: "caller", callerOwnerName: null, calleeText: "A::run", lineNumber: 2 },
    { callerName: "caller", callerOwnerName: null, calleeText: "ptr->run", lineNumber: 3 }
  ] })];

  const result = resolveRelationships(indexDraft, analyses);

  expect(result.calls).toEqual([]);
  expect(result.unresolvedCalls).toEqual([
    { callerId: "caller", calleeText: "service.run", filePath: "src/a.ts", lineNumber: 1, reason: "dynamic-call" },
    { callerId: "caller", calleeText: "A::run", filePath: "src/a.ts", lineNumber: 2, reason: "dynamic-call" },
    { callerId: "caller", calleeText: "ptr->run", filePath: "src/a.ts", lineNumber: 3, reason: "dynamic-call" }
  ]);
});
