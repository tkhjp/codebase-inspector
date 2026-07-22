import { fileURLToPath, URL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createParserRegistry } from "../../lib/parsers/registry.mjs";

const skillDir = fileURLToPath(new URL("../..", import.meta.url));
let registry;

beforeAll(async () => {
  registry = await createParserRegistry(skillDir);
});

afterAll(async () => {
  await registry.close();
});

describe("vendored Go extraction", () => {
  test("adapts receiver methods and package functions", async () => {
    const result = await registry.analyzeFile({
      path: "sample.go",
      language: "go",
      content: "package sample\nimport \"fmt\"\ntype A struct { Value int }\nfunc (a A) Run(value int) { fmt.Println(value) }\nfunc Free(value int) int { return value }\n"
    });

    expect(result.types).toEqual([expect.objectContaining({
      name: "A",
      properties: [expect.objectContaining({ name: "Value", type: null })]
    })]);
    expect(result.methods).toEqual([expect.objectContaining({
      name: "Run",
      ownerName: "A",
      parameters: [{ name: "value", type: null }]
    })]);
    expect(result.functions).toEqual([expect.objectContaining({
      name: "Free",
      parameters: [{ name: "value", type: null }],
      returnType: "int"
    })]);
    expect(result.importCandidates).toEqual([{ source: "fmt", specifiers: ["fmt"], lineNumber: 2, kind: "module" }]);
    expect(result.callCandidates).toContainEqual({ callerName: "Run", callerOwnerName: null, calleeText: "fmt.Println", lineNumber: 4 });
    expect(result.warnings).toEqual([]);
  });
});
