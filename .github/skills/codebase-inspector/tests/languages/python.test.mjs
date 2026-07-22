import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParserRegistry } from "../../lib/parsers/registry.mjs";

const skillDir = fileURLToPath(new URL("../..", import.meta.url));
const fixturePath = new URL("../fixtures/languages/python/sample.py", import.meta.url);

let registry;

beforeAll(async () => {
  registry = await createParserRegistry(skillDir);
});

afterAll(async () => {
  await registry.close();
});

describe("Python rich symbol extraction", () => {
  it("keeps methods owned and omits source defaults", async () => {
    const result = await registry.analyzeFile({
      path: "src/sample.py",
      language: "python",
      content: await readFile(fixturePath, "utf8")
    });

    expect(result.warnings).toEqual([]);
    expect(result.types).toEqual([{
      kind: "class",
      name: "Greeter",
      lineRange: [3, 10],
      properties: [{
        name: "prefix",
        type: "str",
        visibility: null,
        static: null,
        lineRange: [4, 4]
      }],
      extends: ["BaseGreeter"],
      implements: [],
      exported: null
    }]);
    expect(result.methods).toEqual([
      {
        name: "__init__",
        ownerName: "Greeter",
        lineRange: [6, 7],
        parameters: [{ name: "prefix", type: "str" }],
        returnType: null,
        visibility: null,
        static: null,
        async: false,
        exported: null
      },
      {
        name: "greet",
        ownerName: "Greeter",
        lineRange: [9, 10],
        parameters: [{ name: "name", type: "str" }],
        returnType: "str",
        visibility: null,
        static: null,
        async: true,
        exported: null
      }
    ]);
    expect(result.functions).toEqual([{
      name: "add",
      lineRange: [12, 13],
      parameters: [
        { name: "left", type: "int" },
        { name: "right", type: "int" }
      ],
      returnType: "int",
      visibility: null,
      async: false,
      exported: null
    }]);
    expect(result.functions.map(({ name }) => name)).not.toEqual(expect.arrayContaining(["__init__", "greet"]));
    expect(result.importCandidates).toEqual([{
      source: ".formatting",
      specifiers: ["format_name"],
      lineNumber: 1,
      kind: "module"
    }]);
    expect(result.callCandidates).toContainEqual({
      callerName: "greet",
      callerOwnerName: "Greeter",
      calleeText: "format_name",
      lineNumber: 10
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("does not assign decorator calls or lambda bodies to the decorated method", async () => {
    const result = await registry.analyzeFile({
      path: "src/decorated.py",
      language: "python",
      content: [
        "class Decorated:",
        "    @decorate(factory())",
        "    def run(self):",
        "        (lambda: 'body-secret')()",
        ""
      ].join("\n")
    });

    expect(result.warnings).toEqual([]);
    expect(result.callCandidates).toEqual(expect.arrayContaining([
      {
        callerName: null,
        callerOwnerName: "Decorated",
        calleeText: "decorate",
        lineNumber: 2
      },
      {
        callerName: null,
        callerOwnerName: "Decorated",
        calleeText: "factory",
        lineNumber: 2
      }
    ]));
    expect(JSON.stringify(result)).not.toContain("body-secret");
  });

  it("normalizes annotated constructors and preserves typed variadic parameters", async () => {
    const result = await registry.analyzeFile({
      path: "src/variadic.py",
      language: "python",
      content: [
        "class Collector:",
        "    def __init__(self) -> None: pass",
        "    def collect(self, *args: int, **kwargs: str): pass",
        ""
      ].join("\n")
    });

    expect(result.methods).toEqual([
      expect.objectContaining({ name: "__init__", returnType: null }),
      expect.objectContaining({
        name: "collect",
        parameters: [
          { name: "*args", type: "int" },
          { name: "**kwargs", type: "str" }
        ]
      })
    ]);
  });
});
