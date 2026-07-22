import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParserRegistry } from "../../lib/parsers/registry.mjs";

const skillDir = fileURLToPath(new URL("../..", import.meta.url));
const fixturePath = new URL("../fixtures/languages/typescript/sample.ts", import.meta.url);

let registry;

beforeAll(async () => {
  registry = await createParserRegistry(skillDir);
});

afterAll(async () => {
  await registry.close();
});

describe("TypeScript rich symbol extraction", () => {
  it("keeps type members owned and omits source defaults", async () => {
    const result = await registry.analyzeFile({
      path: "src/sample.ts",
      language: "typescript",
      content: await readFile(fixturePath, "utf8")
    });

    expect(result.warnings).toEqual([]);
    expect(result.types).toEqual([
      {
        kind: "interface",
        name: "Runner",
        lineRange: [2, 2],
        properties: [],
        extends: [],
        implements: [],
        exported: true
      },
      {
        kind: "class",
        name: "Greeter",
        lineRange: [3, 8],
        properties: [{
          name: "prefix",
          type: "string",
          visibility: "private",
          static: false,
          lineRange: [4, 4]
        }],
        extends: [],
        implements: ["Runner"],
        exported: true
      }
    ]);

    const greeterMethods = result.methods.filter(({ ownerName }) => ownerName === "Greeter");
    expect(greeterMethods).toHaveLength(3);
    expect(greeterMethods).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "constructor",
        ownerName: "Greeter",
        parameters: [{ name: "prefix", type: "string" }],
        returnType: null,
        visibility: "public",
        static: false,
        async: false,
        exported: false
      }),
      expect.objectContaining({
        name: "run",
        ownerName: "Greeter",
        parameters: [{ name: "input", type: "string" }],
        returnType: "Promise<string>",
        visibility: "public",
        static: false,
        async: true,
        exported: false
      }),
      expect.objectContaining({
        name: "create",
        ownerName: "Greeter",
        parameters: [],
        returnType: "Greeter",
        visibility: "public",
        static: true,
        async: false,
        exported: false
      })
    ]));
    expect(result.functions).toEqual([{
      name: "add",
      lineRange: [9, 9],
      parameters: [
        { name: "left", type: "number" },
        { name: "right", type: "number" }
      ],
      returnType: "number",
      visibility: null,
      async: false,
      exported: true
    }]);
    expect(result.functions.map(({ name }) => name)).not.toEqual(expect.arrayContaining(["constructor", "run", "create"]));
    expect(result.importCandidates).toEqual([{
      source: "./format.js",
      specifiers: ["format"],
      lineNumber: 1,
      kind: "module"
    }]);
    expect(result.callCandidates).toContainEqual({
      callerName: "run",
      callerOwnerName: "Greeter",
      calleeText: "format",
      lineNumber: 6
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("uses TypeScript export syntax instead of CommonJS assignments", async () => {
    const defaultResult = await registry.analyzeFile({
      path: "src/exports.ts",
      language: "typescript",
      content: [
        "function commonJsOnly() {}",
        "module.exports = { commonJsOnly };",
        "function actualDefault() {}",
        "export default actualDefault;",
        ""
      ].join("\n")
    });
    const equalsResult = await registry.analyzeFile({
      path: "src/export-equals.ts",
      language: "typescript",
      content: "function assigned() {}\nexport = assigned;\n"
    });

    expect(defaultResult.functions).toEqual([
      expect.objectContaining({ name: "commonJsOnly", exported: false }),
      expect.objectContaining({ name: "actualDefault", exported: true })
    ]);
    expect(equalsResult.functions).toEqual([
      expect.objectContaining({ name: "assigned", exported: true })
    ]);
  });

  it("keeps abstract class methods owned and call candidates contextualized", async () => {
    const result = await registry.analyzeFile({
      path: "src/abstract.ts",
      language: "typescript",
      content: "export abstract class Base { abstract run(): void; call(): void { helper(); } }\n"
    });

    expect(result.types).toEqual([expect.objectContaining({
      kind: "class",
      name: "Base",
      exported: true
    })]);
    expect(result.methods).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "run", ownerName: "Base", returnType: "void" }),
      expect.objectContaining({ name: "call", ownerName: "Base", returnType: "void" })
    ]));
    expect(result.callCandidates).toContainEqual({
      callerName: "call",
      callerOwnerName: "Base",
      calleeText: "helper",
      lineNumber: 1
    });
  });
});

describe("JavaScript rich symbol extraction", () => {
  it("uses explicit CommonJS exports and preserves caller context", async () => {
    const result = await registry.analyzeFile({
      path: "src/sample.js",
      language: "javascript",
      content: [
        "function hidden(value = 'secret') { return value; }",
        "function shown(value) { return hidden(value); }",
        "module.exports = { shown };",
        ""
      ].join("\n")
    });

    expect(result.warnings).toEqual([]);
    expect(result.functions).toEqual([
      expect.objectContaining({
        name: "hidden",
        parameters: [{ name: "value", type: null }],
        exported: false
      }),
      expect.objectContaining({
        name: "shown",
        parameters: [{ name: "value", type: null }],
        exported: true
      })
    ]);
    expect(result.callCandidates).toContainEqual({
      callerName: "shown",
      callerOwnerName: null,
      calleeText: "hidden",
      lineNumber: 2
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("extracts directly assigned CommonJS functions without serializing invoked bodies", async () => {
    const result = await registry.analyzeFile({
      path: "src/commonjs.js",
      language: "javascript",
      content: [
        "exports.build = function build(value = 'secret') {",
        "  (() => 'body-secret')();",
        "  return helper(value);",
        "};",
        ""
      ].join("\n")
    });

    expect(result.warnings).toEqual([]);
    expect(result.functions).toEqual([expect.objectContaining({
      name: "build",
      parameters: [{ name: "value", type: null }],
      exported: true
    })]);
    expect(result.callCandidates).toContainEqual({
      callerName: "build",
      callerOwnerName: null,
      calleeText: "helper",
      lineNumber: 3
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
