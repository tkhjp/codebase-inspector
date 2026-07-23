import { expect, test } from "vitest";
import { resolve } from "node:path";
import { parseRenderArgs } from "../../lib/cli/render-args.mjs";

test("parses deterministic structure render filters", () => {
  const result = parseRenderArgs([
    "--snapshot", ".analysis/symbol-index.json",
    "--path", "src\\orders",
    "--language", "typescript",
    "--type-kind", "class",
    "--include-non-public",
    "--omit-diagram-members",
    "--max-types", "25",
    "--split-size", "10",
    "--split-by", "namespace",
    "--output", ".docs"
  ], "/repo");

  expect(result.snapshotPath).toBe(resolve("/repo/.analysis/symbol-index.json"));
  expect(result.outputPath).toBe(resolve("/repo/.docs"));
  expect(result.filters).toEqual({
    path: "src/orders",
    language: "typescript",
    typeKind: "class",
    visibility: null,
    name: null,
    includeNonPublic: true,
    omitDiagramMembers: true,
    maxTypes: 25,
    splitSize: 10,
    splitBy: "namespace"
  });
});

test.each([
  ["--max-types", "0"],
  ["--split-size", "0"],
  ["--type-kind", "unknown"],
  ["--visibility", "unknown"],
  ["--split-by", "unknown"],
  ["--path", "../outside"],
  ["--path", "/absolute"],
  ["--definition-output", "not-markdown.txt"],
  ["--diagram-output", "nested/クラス図.md"],
  ["--definition-output", "CON.md"]
])("rejects invalid %s values", (option, value) => {
  expect(() => parseRenderArgs([option, value], "/repo")).toThrow(/Usage/);
});
