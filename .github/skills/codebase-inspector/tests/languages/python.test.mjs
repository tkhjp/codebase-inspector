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
        static: false,
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
        static: false,
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

  it("applies receiver removal and static flags from method semantics", async () => {
    const result = await registry.analyzeFile({
      path: "src/receivers.py",
      language: "python",
      content: [
        "def free(self, cls, value): pass",
        "class Receiver:",
        "    def instance(self, cls, value): pass",
        "    def unconventional(receiver, value): pass",
        "    @classmethod",
        "    def make(klass, self, value): pass",
        "    @staticmethod",
        "    def static(self, cls, value): pass",
        ""
      ].join("\n")
    });

    expect(result.functions).toEqual([expect.objectContaining({
      name: "free",
      parameters: [
        { name: "self", type: null },
        { name: "cls", type: null },
        { name: "value", type: null }
      ]
    })]);
    expect(result.methods).toEqual([
      expect.objectContaining({
        name: "instance",
        parameters: [{ name: "cls", type: null }, { name: "value", type: null }],
        static: false
      }),
      expect.objectContaining({
        name: "unconventional",
        parameters: [{ name: "value", type: null }],
        static: false
      }),
      expect.objectContaining({
        name: "make",
        parameters: [{ name: "self", type: null }, { name: "value", type: null }],
        static: false
      }),
      expect.objectContaining({
        name: "static",
        parameters: [
          { name: "self", type: null },
          { name: "cls", type: null },
          { name: "value", type: null }
        ],
        static: true
      })
    ]);
  });

  it("skips dynamic Python heritage without serializing expression text", async () => {
    const result = await registry.analyzeFile({
      path: "src/privacy.py",
      language: "python",
      content: [
        "class Unsafe(factory('heritage-secret')): pass",
        "class Safe(package.Base, Generic[Item]): pass",
        ""
      ].join("\n")
    });

    expect(result.types).toEqual([
      expect.objectContaining({ name: "Unsafe", extends: [] }),
      expect.objectContaining({ name: "Safe", extends: ["package.Base", "Generic[Item]"] })
    ]);
    expect(result.warnings).toEqual(["Skipped dynamic Python heritage at line 1"]);
    expect(JSON.stringify(result)).not.toContain("heritage-secret");
  });

  it("does not traverse Python parameter default expressions", async () => {
    const result = await registry.analyzeFile({
      path: "src/defaults.py",
      language: "python",
      content: "def configured(value: str = make_default('default-secret')) -> str: return value\n"
    });

    expect(result.functions).toEqual([expect.objectContaining({
      name: "configured",
      parameters: [{ name: "value", type: "str" }],
      returnType: "str"
    })]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("make_default");
    expect(serialized).not.toContain("default-secret");
  });
});
