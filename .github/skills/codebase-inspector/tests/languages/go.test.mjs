import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParserRegistry } from "../../lib/parsers/registry.mjs";

const skillDir = fileURLToPath(new URL("../..", import.meta.url));
const fixturePath = new URL("../fixtures/languages/go/sample.go", import.meta.url);

let registry;

beforeAll(async () => {
  registry = await createParserRegistry(skillDir);
});

afterAll(async () => {
  await registry.close();
});

describe("Go rich symbol extraction", () => {
  it("keeps receiver and interface methods owned without duplicate functions", async () => {
    const result = await registry.analyzeFile({
      path: "sample/sample.go",
      language: "go",
      content: await readFile(fixturePath, "utf8")
    });

    expect(result.warnings).toEqual([]);
    expect(result.types).toEqual([
      {
        kind: "struct",
        name: "Greeter",
        lineRange: [5, 9],
        properties: [
          { name: "Prefix", type: "string", visibility: "public", static: false, lineRange: [6, 6] },
          { name: "count", type: "int", visibility: "private", static: false, lineRange: [7, 7] },
          { name: "Tags", type: "[]string", visibility: "public", static: false, lineRange: [8, 8] }
        ],
        extends: [],
        implements: [],
        exported: true
      },
      {
        kind: "interface",
        name: "Runner",
        lineRange: [11, 14],
        properties: [],
        extends: [],
        implements: [],
        exported: true
      }
    ]);
    expect(result.methods).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Run",
        ownerName: "Runner",
        parameters: [{ name: "input", type: "string" }],
        returnType: "string",
        visibility: "public",
        static: false,
        async: null,
        exported: true
      }),
      expect.objectContaining({
        name: "private",
        ownerName: "Runner",
        parameters: [{ name: "value", type: "int" }],
        returnType: "error",
        visibility: "private",
        static: false,
        async: null,
        exported: false
      }),
      expect.objectContaining({
        name: "Run",
        ownerName: "Greeter",
        parameters: [{ name: "input", type: "string" }],
        returnType: "string",
        visibility: "public",
        static: false,
        async: null,
        exported: true
      }),
      expect.objectContaining({
        name: "private",
        ownerName: "Greeter",
        parameters: [{ name: "value", type: "int" }],
        returnType: "error",
        visibility: "private",
        static: false,
        async: null,
        exported: false
      })
    ]));
    expect(result.functions).toEqual([{
      name: "NewGreeter",
      lineRange: [16, 18],
      parameters: [{ name: "prefix", type: "string" }],
      returnType: "*Greeter",
      visibility: "public",
      async: null,
      exported: true
    }]);
    expect(result.functions.map(({ name }) => name)).not.toEqual(expect.arrayContaining(["Run", "private"]));
    expect(result.importCandidates).toEqual([{
      source: "example.local/project/format",
      specifiers: ["format"],
      lineNumber: 3,
      kind: "module"
    }]);
    expect(result.callCandidates).toContainEqual({
      callerName: "Run",
      callerOwnerName: "Greeter",
      calleeText: "format.Name",
      lineNumber: 21
    });
  });

  it("renders structural Go forms and warns without leaking dynamic expressions", async () => {
    const result = await registry.analyzeFile({
      path: "sample/privacy.go",
      language: "go",
      content: [
        "package sample",
        "import (",
        "    alias \"example.local/project/format\"",
        "    . \"example.local/project/dot\"",
        ")",
        "type Shapes[T any] struct {",
        "    Values map[string][]*T `json:\"field-secret\"`",
        "    Safe [16]byte",
        "    Skipped [dynamicLen(\"type-secret\")]byte",
        "}",
        "func (s *Shapes[T]) Probe(value chan<- *T) (map[string]*T, error) {",
        "    getHandler(\"callee-secret\")(value)",
        "    return alias.Name(value), nil",
        "}",
        ""
      ].join("\n")
    });

    expect(result.types).toContainEqual(expect.objectContaining({
      name: "Shapes",
      properties: [
        expect.objectContaining({ name: "Values", type: "map[string][]*T" }),
        expect.objectContaining({ name: "Safe", type: "[16]byte" }),
        expect.objectContaining({ name: "Skipped", type: null })
      ]
    }));
    expect(result.methods).toContainEqual(expect.objectContaining({
      name: "Probe",
      ownerName: "Shapes",
      parameters: [{ name: "value", type: "chan<- *T" }],
      returnType: "(map[string]*T, error)"
    }));
    expect(result.importCandidates).toEqual([
      { source: "example.local/project/format", specifiers: ["alias"], lineNumber: 3, kind: "module" },
      { source: "example.local/project/dot", specifiers: ["."], lineNumber: 4, kind: "module" }
    ]);
    expect(result.callCandidates).toContainEqual({
      callerName: "Probe",
      callerOwnerName: "Shapes",
      calleeText: "alias.Name",
      lineNumber: 13
    });
    expect(result.warnings).toEqual([
      "Skipped dynamic Go type at line 9",
      "Skipped dynamic Go call target at line 12"
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("field-secret");
    expect(serialized).not.toContain("type-secret");
    expect(serialized).not.toContain("callee-secret");
    expect(serialized).not.toContain("dynamicLen");
  });
});
