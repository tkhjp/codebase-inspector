import { expect, test } from "vitest";
import { buildSymbolIndex } from "../../lib/normalize/symbol-index.mjs";
import { selectStructure } from "../../lib/query/select-structure.mjs";
import { renderStructureDocuments } from "../../lib/reports/render-structure-documents.mjs";

const project = {
  name: "fixture",
  root: null,
  gitCommitHash: "abc123",
  workingTreeDirty: false,
  languages: ["typescript"]
};

const filters = {
  path: null,
  language: null,
  typeKind: null,
  visibility: null,
  name: null,
  includeNonPublic: false,
  omitDiagramMembers: false,
  maxTypes: 100,
  splitSize: 50,
  splitBy: "none"
};

function parameter(name, type, position) {
  return {
    position,
    name,
    type,
    typeStatus: "known",
    defaultValue: null,
    defaultStatus: "not-declared",
    optional: false,
    variadic: false
  };
}

function indexFixture() {
  const file = { path: "src/orders/models.ts", language: "typescript", category: "source", lineCount: 30, bytes: 100, content: "ignored" };
  const callable = {
    lineRange: [8, 10],
    parameters: [parameter("id", "string", 0)],
    returnType: "Order",
    returnTypeStatus: "known",
    visibility: "public",
    visibilityStatus: "known",
    modifiers: [],
    typeParameters: [],
    async: false,
    exported: false
  };
  return buildSymbolIndex({
    project,
    scan: { files: [file], unsupportedFiles: [], warnings: [], git: {} },
    analyses: [{
      filePath: file.path,
      language: file.language,
      namespace: "orders",
      package: null,
      module: null,
      capabilityLevel: "enriched",
      types: [{
        kind: "interface",
        name: "Identifiable",
        qualifiedName: "orders.Identifiable",
        lineRange: [1, 3],
        visibility: "public",
        visibilityStatus: "known",
        modifiers: ["export"],
        typeParameters: [],
        properties: [{
          name: "id",
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
      }, {
        kind: "class",
        name: "Order",
        qualifiedName: "orders.Order",
        lineRange: [5, 14],
        visibility: "public",
        visibilityStatus: "known",
        modifiers: ["export"],
        typeParameters: [],
        properties: [{
          name: "id",
          kind: "field",
          type: "string",
          typeStatus: "known",
          defaultValue: null,
          defaultStatus: "not-declared",
          visibility: "public",
          visibilityStatus: "known",
          modifiers: [],
          static: false,
          lineRange: [6, 6],
          explicitValue: null
        }],
        extends: [],
        implements: ["Identifiable"],
        mixins: [],
        exported: true
      }],
      methods: [{ ...callable, kind: "constructor", name: "constructor", ownerName: "Order", returnType: null, returnTypeStatus: "not-declared", static: false }, {
        ...callable,
        kind: "method",
        name: "find",
        ownerName: "Order",
        lineRange: [11, 13],
        returnType: "Promise<Order | undefined>",
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

async function parseMermaid(markdown) {
  const source = markdown.match(/```mermaid\n([\s\S]*?)\n```/)?.[1];
  expect(source).toBeTruthy();
  const purify = (await import("dompurify")).default;
  purify.sanitize ??= (value) => value;
  purify.addHook ??= () => {};
  const mermaid = (await import("mermaid")).default;
  return mermaid.parse(source);
}

test("renders definition and Mermaid from the same selected type set", async () => {
  const index = indexFixture();
  const selection = selectStructure(index, filters);
  const files = renderStructureDocuments(index, selection, filters);
  const definition = files.get("クラス定義書.md");
  const diagram = files.get("クラス図.md");

  expect(selection.selectedCount).toBe(2);
  expect(definition).toContain("### `orders.Identifiable`");
  expect(definition).toContain("### `orders.Order`");
  expect(definition).toContain("| constructor | `id: string` | なし |");
  expect(definition).toContain("`Promise<Order \\| undefined>`");
  expect(definition).toContain("| メソッド名 | 引数 | 戻り値 |");
  expect(definition).not.toContain("| メソッド名 | 種別 |");
  expect(definition).not.toContain("責務");
  expect(diagram).toContain("classDiagram");
  expect(diagram).toContain(": implements");
  expect((definition.match(/^### `/gm) ?? [])).toHaveLength(selection.selectedCount);
  expect((diagram.match(/^\s{2}class T_/gm) ?? [])).toHaveLength(selection.selectedCount);
  await expect(parseMermaid(diagram)).resolves.toEqual(expect.objectContaining({ diagramType: "class" }));
});

test("filters deterministically and produces split indexes", () => {
  const index = indexFixture();
  const selected = selectStructure(index, { ...filters, name: "Order", maxTypes: 1, splitBy: "path" });
  const files = renderStructureDocuments(index, selected, { ...filters, name: "Order", maxTypes: 1, splitBy: "path" });

  expect(selected.views.map((view) => view.type.qualifiedName)).toEqual(["orders.Order"]);
  expect(selected.truncated).toBe(false);
  expect(files.get("クラス定義書.md")).toContain("orders.Order");
  expect(files.get("クラス図.md")).toContain("classDiagram");
});

test("automatically splits large selections and records every chunk in the indexes", async () => {
  const index = indexFixture();
  const splitFilters = { ...filters, splitSize: 1 };
  const selected = selectStructure(index, splitFilters);
  const files = renderStructureDocuments(index, selected, splitFilters);

  expect(files.get("クラス定義書.md")).toContain("## 分割一覧");
  expect(files.get("クラス図.md")).toContain("## 分割一覧");
  expect([...files.keys()].filter((name) => name.startsWith("クラス定義書-"))).toHaveLength(2);
  const diagrams = [...files].filter(([name]) => name.startsWith("クラス図-"));
  expect(diagrams).toHaveLength(2);
  for (const [, diagram] of diagrams) {
    await expect(parseMermaid(diagram)).resolves.toEqual(expect.objectContaining({ diagramType: "class" }));
  }
});
