import { expect, test } from "vitest";
import { buildSymbolIndex } from "../../lib/normalize/symbol-index.mjs";
import { parseSymbolIndexV2 } from "../../lib/schema/symbol-index.mjs";

const project = {
  name: "fixture",
  root: null,
  gitCommitHash: "abc123",
  workingTreeDirty: false,
  languages: ["typescript"]
};

function build(startLine, { returnType = "Order", propertyType = "string", propertyNames = ["id"] } = {}) {
  const file = { path: "src/order.ts", language: "typescript", category: "source", lineCount: 30, bytes: 100, content: "ignored" };
  return buildSymbolIndex({
    project,
    scan: { files: [file], unsupportedFiles: [], warnings: [], git: {} },
    analyses: [{
      filePath: file.path,
      language: file.language,
      namespace: "sales",
      package: null,
      module: null,
      types: [{
        kind: "class",
        name: "Order",
        qualifiedName: "sales.Order",
        lineRange: [startLine, startLine + 10],
        visibility: "public",
        modifiers: ["export"],
        typeParameters: [],
        properties: propertyNames.map((name, index) => ({
          name,
          kind: "property",
          type: propertyType,
          typeStatus: "known",
          defaultValue: null,
          defaultStatus: "not-declared",
          visibility: "public",
          visibilityStatus: "known",
          modifiers: [],
          static: false,
          lineRange: [startLine + index + 1, startLine + index + 1],
          explicitValue: null
        })),
        extends: [],
        implements: ["Identifiable"],
        mixins: [],
        exported: true
      }],
      methods: [{
        kind: "method",
        name: "find",
        ownerName: "Order",
        lineRange: [startLine + 2, startLine + 4],
        parameters: [{
          position: 0,
          name: "id",
          type: "string",
          typeStatus: "known",
          defaultValue: null,
          defaultStatus: "not-declared",
          optional: false,
          variadic: false
        }],
        returnType,
        returnTypeStatus: "known",
        visibility: "public",
        visibilityStatus: "known",
        modifiers: [],
        typeParameters: [],
        async: false,
        exported: false,
        static: false
      }],
      functions: [],
      importCandidates: [],
      callCandidates: [],
      warnings: []
    }],
    skillVersion: "0.2.0"
  }).symbolIndex;
}

test("builds a schema 2 snapshot with first-class properties and type relations", () => {
  const index = build(2);

  expect(index.schemaVersion).toBe("2.0.0");
  expect(index.properties).toHaveLength(1);
  expect(index.types[0].propertyIds).toEqual([index.properties[0].id]);
  expect(index.typeRelations).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "implements", sourceId: index.types[0].id, targetName: "Identifiable" }),
    expect.objectContaining({ kind: "references", sourceId: index.properties[0].id, targetName: "string", origin: "property-type" }),
    expect.objectContaining({ kind: "references", sourceId: index.methods[0].id, targetName: "Order", origin: "return-type", targetCategory: "internal" })
  ]));
  expect(() => parseSymbolIndexV2(index)).not.toThrow();
});

test("keeps named type and method IDs stable when declarations move", () => {
  const before = build(2);
  const after = build(12);

  expect(after.types[0].id).toBe(before.types[0].id);
  expect(after.methods[0].id).toBe(before.methods[0].id);
  expect(after.properties[0].id).toBe(before.properties[0].id);
  expect(after.types[0].structuralFingerprint).toBe(before.types[0].structuralFingerprint);
});

test("keeps every named property ID stable when properties move or reorder", () => {
  const before = build(2, { propertyNames: ["id", "status"] });
  const after = build(12, { propertyNames: ["status", "id"] });
  const idsByName = (index) => Object.fromEntries(index.properties.map((property) => [property.name, property.id]));

  expect(idsByName(after)).toEqual(idsByName(before));
  expect(after.types[0].structuralFingerprint).toBe(before.types[0].structuralFingerprint);
});

test("changes structural fingerprints when member types or signatures change", () => {
  const before = build(2);
  const after = build(2, { returnType: "Promise<Order>", propertyType: "number" });

  expect(after.types[0].id).toBe(before.types[0].id);
  expect(after.properties[0].id).toBe(before.properties[0].id);
  expect(after.properties[0].structuralFingerprint).not.toBe(before.properties[0].structuralFingerprint);
  expect(after.methods[0].structuralFingerprint).not.toBe(before.methods[0].structuralFingerprint);
  expect(after.types[0].structuralFingerprint).not.toBe(before.types[0].structuralFingerprint);
  expect(after.snapshotFingerprint).not.toBe(before.snapshotFingerprint);
});

test("merges explicitly scoped partial type declarations across files", () => {
  const files = ["src/a.cs", "src/b.cs"].map((path) => ({
    path,
    language: "csharp",
    category: "source",
    lineCount: 3,
    bytes: 20,
    content: "ignored"
  }));
  const analyses = files.map((file, index) => ({
    filePath: file.path,
    language: file.language,
    namespace: "Sales",
    types: [{
      kind: "class",
      name: "Order",
      qualifiedName: "Sales.Order",
      lineRange: [1, 3],
      visibility: "public",
      visibilityStatus: "known",
      modifiers: ["partial"],
      typeParameters: [],
      properties: [{
        name: index === 0 ? "Id" : "Status",
        kind: "property",
        type: "string",
        typeStatus: "known",
        defaultValue: null,
        defaultStatus: "not-declared",
        visibility: "public",
        visibilityStatus: "known",
        modifiers: [],
        static: false,
        lineRange: [2, 2],
        explicitValue: null
      }],
      extends: [],
      implements: [],
      mixins: [],
      exported: true
    }],
    methods: [{
      kind: "method",
      name: index === 0 ? "Load" : "Save",
      ownerName: "Order",
      lineRange: [3, 3],
      parameters: [],
      returnType: "void",
      returnTypeStatus: "known",
      visibility: "public",
      visibilityStatus: "known",
      modifiers: [],
      typeParameters: [],
      async: false,
      exported: false,
      static: false
    }],
    functions: [],
    importCandidates: [],
    callCandidates: [],
    warnings: []
  }));
  const index = buildSymbolIndex({
    project: { ...project, languages: ["csharp"] },
    scan: { files, unsupportedFiles: [], warnings: [], git: {} },
    analyses,
    skillVersion: "0.2.0"
  }).symbolIndex;

  expect(index.types).toHaveLength(1);
  expect(index.types[0].declarations.map((declaration) => declaration.filePath)).toEqual(["src/a.cs", "src/b.cs"]);
  expect(index.types[0].propertyIds).toHaveLength(2);
  expect(index.types[0].methodIds).toHaveLength(2);
  expect(index.methods.map((method) => method.filePath)).toEqual(["src/a.cs", "src/b.cs"]);
  expect(index.files.every((file) => file.typeIds[0] === index.types[0].id)).toBe(true);
});

test("keeps unscoped same-name types in different files distinct", () => {
  const files = ["src/a.ts", "src/b.ts"].map((path) => ({
    path,
    language: "typescript",
    category: "source",
    lineCount: 1,
    bytes: 10,
    content: "ignored"
  }));
  const analyses = files.map((file) => ({
    filePath: file.path,
    language: file.language,
    types: [{
      kind: "class",
      name: "Order",
      qualifiedName: "Order",
      lineRange: [1, 1],
      properties: [],
      extends: [],
      implements: [],
      exported: true
    }],
    methods: [],
    functions: [],
    importCandidates: [],
    callCandidates: [],
    warnings: []
  }));
  const index = buildSymbolIndex({
    project,
    scan: { files, unsupportedFiles: [], warnings: [], git: {} },
    analyses,
    skillVersion: "0.2.0"
  }).symbolIndex;

  expect(index.types).toHaveLength(2);
  expect(new Set(index.types.map((type) => type.id)).size).toBe(2);
});
