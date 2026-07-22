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

  it("skips dynamic member names and heritage without serializing expression text", async () => {
    const result = await registry.analyzeFile({
      path: "src/privacy.ts",
      language: "typescript",
      content: [
        "class Unsafe extends factory('heritage-secret') {",
        "  ['computed-secret']() { helper(); }",
        "  [key] = 1;",
        "}",
        "class Safe extends Namespace.Base<Thing> implements Contracts.Runner, Plain {}",
        "interface Child extends Contracts.Parent<Thing>, Plain {}",
        ""
      ].join("\n")
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("computed-secret");
    expect(serialized).not.toContain("heritage-secret");
    expect(result.warnings).toEqual([
      "Skipped dynamic TypeScript heritage at line 1",
      "Skipped dynamic TypeScript member name at line 2",
      "Skipped dynamic TypeScript member name at line 3"
    ]);
    expect(result.types).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Unsafe", extends: [], implements: [] }),
      expect.objectContaining({
        name: "Safe",
        extends: ["Namespace.Base<Thing>"],
        implements: ["Contracts.Runner", "Plain"]
      }),
      expect.objectContaining({
        name: "Child",
        extends: ["Contracts.Parent<Thing>", "Plain"]
      })
    ]));
    expect(result.methods).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerName: "Unsafe" })
    ]));
    expect(result.callCandidates).toContainEqual({
      callerName: null,
      callerOwnerName: "Unsafe",
      calleeText: "helper",
      lineNumber: 2
    });
  });

  it("canonicalizes complete binding patterns without default right-hand sides", async () => {
    const result = await registry.analyzeFile({
      path: "src/patterns.ts",
      language: "typescript",
      content: [
        "export function bindings(",
        "  { a, b: alias = 'default-secret', nested: { c, d = makeDefault() }, ...rest }: Options,",
        "  [first, , second = 'array-default', ...tail]: Items",
        ") {}",
        ""
      ].join("\n")
    });

    expect(result.functions).toEqual([expect.objectContaining({
      name: "bindings",
      parameters: [
        { name: "{a, b: alias, nested: {c, d}, ...rest}", type: "Options" },
        { name: "[first, , second, ...tail]", type: "Items" }
      ]
    })]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("default-secret");
    expect(serialized).not.toContain("array-default");
    expect(serialized).not.toContain("makeDefault");
  });

  it("extracts ambient declarations and all enum members", async () => {
    const result = await registry.analyzeFile({
      path: "src/ambient.ts",
      language: "typescript",
      content: [
        "declare function ambient(input: string): void;",
        "declare class Ambient { method(input: string): void; field: string; }",
        "enum Color { Red, Blue = compute('enum-secret') }",
        ""
      ].join("\n")
    });

    expect(result.functions).toContainEqual(expect.objectContaining({
      name: "ambient",
      parameters: [{ name: "input", type: "string" }],
      returnType: "void",
      exported: false
    }));
    expect(result.types).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Ambient", kind: "class" }),
      expect.objectContaining({
        name: "Color",
        kind: "enum",
        properties: [
          expect.objectContaining({ name: "Red", static: true }),
          expect.objectContaining({ name: "Blue", static: true })
        ]
      })
    ]));
    expect(result.methods).toContainEqual(expect.objectContaining({
      name: "method",
      ownerName: "Ambient",
      parameters: [{ name: "input", type: "string" }],
      returnType: "void"
    }));
    expect(result.types.find(({ name }) => name === "Ambient")?.properties).toEqual([
      expect.objectContaining({ name: "field", type: "string" })
    ]);
    expect(JSON.stringify(result)).not.toContain("enum-secret");
  });

  it("names anonymous default exports and records re-export sources", async () => {
    const functionResult = await registry.analyzeFile({
      path: "src/default-function.ts",
      language: "typescript",
      content: [
        "export default function (value: string = 'default-secret') { helper(value); }",
        "export { thing as other } from './source.js';",
        "export * from './all.js';",
        ""
      ].join("\n")
    });
    const arrowResult = await registry.analyzeFile({
      path: "src/default-arrow.ts",
      language: "typescript",
      content: "export default (value: string = 'arrow-secret') => helper(value);\n"
    });

    expect(functionResult.functions).toEqual([expect.objectContaining({
      name: "default",
      parameters: [{ name: "value", type: "string" }],
      exported: true
    })]);
    expect(functionResult.callCandidates).toContainEqual({
      callerName: "default",
      callerOwnerName: null,
      calleeText: "helper",
      lineNumber: 1
    });
    expect(functionResult.importCandidates).toEqual([
      { source: "./source.js", specifiers: ["other"], lineNumber: 2, kind: "module" },
      { source: "./all.js", specifiers: ["*"], lineNumber: 3, kind: "module" }
    ]);
    expect(arrowResult.functions).toEqual([expect.objectContaining({
      name: "default",
      parameters: [{ name: "value", type: "string" }],
      exported: true
    })]);
    expect(arrowResult.callCandidates).toContainEqual({
      callerName: "default",
      callerOwnerName: null,
      calleeText: "helper",
      lineNumber: 1
    });
    expect(JSON.stringify(functionResult)).not.toContain("default-secret");
    expect(JSON.stringify(arrowResult)).not.toContain("arrow-secret");
  });

  it("handles anonymous default classes, comments in bindings, and namespace re-exports", async () => {
    const result = await registry.analyzeFile({
      path: "src/edge-exports.ts",
      language: "typescript",
      content: [
        "export default class { method() { helper(); } }",
        "export function commented([first, /* array-note */ second]: Pair, {left, /* object-note */ right}: Options) {}",
        "export * as utilities from './utilities.js';",
        "module.exports = function () { commonJsOnly(); };",
        ""
      ].join("\n")
    });

    expect(result.types).toContainEqual(expect.objectContaining({ name: "default", kind: "class", exported: true }));
    expect(result.methods).toContainEqual(expect.objectContaining({ name: "method", ownerName: "default" }));
    expect(result.functions).toContainEqual(expect.objectContaining({
      name: "commented",
      parameters: [
        { name: "[first, second]", type: "Pair" },
        { name: "{left, right}", type: "Options" }
      ]
    }));
    expect(result.importCandidates).toContainEqual({
      source: "./utilities.js",
      specifiers: ["* as utilities"],
      lineNumber: 3,
      kind: "module"
    });
    expect(result.callCandidates).toContainEqual({
      callerName: "method",
      callerOwnerName: "default",
      calleeText: "helper",
      lineNumber: 1
    });
    expect(result.callCandidates).toContainEqual({
      callerName: null,
      callerOwnerName: null,
      calleeText: "commonJsOnly",
      lineNumber: 4
    });
  });

  it("warns when computed call targets are skipped without leaking their source", async () => {
    const result = await registry.analyzeFile({
      path: "src/computed-call.ts",
      language: "typescript",
      content: "obj[CALL_SECRET]();\n"
    });

    expect(result.callCandidates).toEqual([]);
    expect(result.warnings).toEqual(["Skipped dynamic TypeScript call target at line 1"]);
    expect(JSON.stringify(result)).not.toContain("CALL_SECRET");
  });

  it("keeps source-bearing named and namespace re-exports from exporting colliding locals", async () => {
    const result = await registry.analyzeFile({
      path: "src/reexport-collisions.ts",
      language: "typescript",
      content: [
        "function local() {}",
        "function namespaceCollision() {}",
        "export { local as remote } from './dep.js';",
        "export * as namespaceCollision from './namespace.js';",
        ""
      ].join("\n")
    });

    expect(result.functions).toEqual([
      expect.objectContaining({ name: "local", exported: false }),
      expect.objectContaining({ name: "namespaceCollision", exported: false })
    ]);
    expect(result.importCandidates).toEqual([
      { source: "./dep.js", specifiers: ["remote"], lineNumber: 3, kind: "module" },
      { source: "./namespace.js", specifiers: ["* as namespaceCollision"], lineNumber: 4, kind: "module" }
    ]);
  });

  it("renders common structural TypeScript parameter return and property types", async () => {
    const result = await registry.analyzeFile({
      path: "src/type-shapes.ts",
      language: "typescript",
      content: [
        "export class TypeShapes {",
        "  callback: (value: Namespace.Input) => Promise<Result>;",
        "  tuple: [string, Namespace.Item];",
        "  object: { value: string; nested: ReadonlyArray<Namespace.Item | null>; handler(input: Thing): Result };",
        "  state: 'ready' | 404 | true | null;",
        "}",
        "export function transform(",
        "  callback: (value: Namespace.Input) => Promise<Result>,",
        "  tuple: [string, Namespace.Item],",
        "  object: { value: string; nested: ReadonlyArray<Namespace.Item | null> },",
        "  state: 'ready' | 404 | true | null = 'default-type-secret'",
        "): (item: Namespace.Item) => Result { helper('source-body-secret'); return item => item; }",
        ""
      ].join("\n")
    });

    const expectedTypes = {
      callback: "(value: Namespace.Input) => Promise<Result>",
      tuple: "[string, Namespace.Item]",
      object: "{ value: string; nested: ReadonlyArray<Namespace.Item | null>; handler(input: Thing): Result }",
      state: "\"ready\" | 404 | true | null"
    };
    expect(Object.fromEntries(result.types[0].properties.map(({ name, type }) => [name, type]))).toEqual(expectedTypes);
    expect(result.functions).toContainEqual(expect.objectContaining({
      name: "transform",
      parameters: [
        { name: "callback", type: expectedTypes.callback },
        { name: "tuple", type: expectedTypes.tuple },
        { name: "object", type: "{ value: string; nested: ReadonlyArray<Namespace.Item | null> }" },
        { name: "state", type: expectedTypes.state }
      ],
      returnType: "(item: Namespace.Item) => Result"
    }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("default-type-secret");
    expect(serialized).not.toContain("source-body-secret");
  });

  it("extracts TypeScript generator declarations and values with caller context", async () => {
    const result = await registry.analyzeFile({
      path: "src/generators.ts",
      language: "typescript",
      content: [
        "export function* declared(): Iterable<Result> { helper(); }",
        "export const valued = function* (): Iterable<Result> { helper(); };",
        "export default function* (): Iterable<Result> { helper(); }",
        ""
      ].join("\n")
    });

    expect(result.functions).toEqual([
      expect.objectContaining({ name: "declared", returnType: "Iterable<Result>", exported: true }),
      expect.objectContaining({ name: "valued", returnType: "Iterable<Result>", exported: true }),
      expect.objectContaining({ name: "default", returnType: "Iterable<Result>", exported: true })
    ]);
    expect(result.callCandidates).toEqual([
      { callerName: "declared", callerOwnerName: null, calleeText: "helper", lineNumber: 1 },
      { callerName: "valued", callerOwnerName: null, calleeText: "helper", lineNumber: 2 },
      { callerName: "default", callerOwnerName: null, calleeText: "helper", lineNumber: 3 }
    ]);
  });

  it("preserves static string and numeric binding keys and rejects computed keys", async () => {
    const result = await registry.analyzeFile({
      path: "src/binding-keys.ts",
      language: "typescript",
      content: [
        "function staticKeys({'display-name': label, 7: lucky}: Input) {}",
        "function dynamicKey({[makeKey('binding-secret')]: hidden}: Input) {}",
        ""
      ].join("\n")
    });

    expect(result.functions).toEqual([
      expect.objectContaining({
        name: "staticKeys",
        parameters: [{ name: "{\"display-name\": label, 7: lucky}", type: "Input" }]
      }),
      expect.objectContaining({ name: "dynamicKey", parameters: [] })
    ]);
    expect(result.warnings).toEqual(["Skipped dynamic TypeScript binding key at line 2"]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("binding-secret");
    expect(serialized).not.toContain("makeKey");
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

  it("extracts explicit CommonJS object callables by safe key with caller context", async () => {
    const result = await registry.analyzeFile({
      path: "src/commonjs-object.js",
      language: "javascript",
      content: [
        "module.exports = {",
        "  arrow: (value = 'object-default') => helper(value),",
        "  named: function inner(value) { return helper(value); },",
        "  method(value) { return helper(value); },",
        "  ['computed-secret']() { return hidden(); }",
        "};",
        ""
      ].join("\n")
    });

    expect(result.functions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "arrow", exported: true }),
      expect.objectContaining({ name: "named", exported: true }),
      expect.objectContaining({ name: "method", exported: true })
    ]));
    expect(result.callCandidates).toEqual(expect.arrayContaining([
      { callerName: "arrow", callerOwnerName: null, calleeText: "helper", lineNumber: 2 },
      { callerName: "named", callerOwnerName: null, calleeText: "helper", lineNumber: 3 },
      { callerName: "method", callerOwnerName: null, calleeText: "helper", lineNumber: 4 }
    ]));
    expect(result.warnings).toContain("Skipped dynamic JavaScript export name at line 5");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("computed-secret");
    expect(serialized).not.toContain("object-default");
  });

  it("warns when a computed CommonJS export target is skipped", async () => {
    const result = await registry.analyzeFile({
      path: "src/computed-export.js",
      language: "javascript",
      content: "exports[EXPORT_SECRET] = function () { helper(); };\n"
    });

    expect(result.functions).toEqual([]);
    expect(result.warnings).toEqual(["Skipped dynamic JavaScript export name at line 1"]);
    expect(result.callCandidates).toContainEqual({
      callerName: null,
      callerOwnerName: null,
      calleeText: "helper",
      lineNumber: 1
    });
    expect(JSON.stringify(result)).not.toContain("EXPORT_SECRET");
  });

  it("extracts JavaScript generator declarations and CommonJS values with caller context", async () => {
    const result = await registry.analyzeFile({
      path: "src/generators.js",
      language: "javascript",
      content: [
        "function* local() { helper(); }",
        "exports.local = local;",
        "exports.assigned = function* () { helper(); };",
        "module.exports = { object: function* () { helper(); }, *method() { helper(); } };",
        "module.exports.direct = function* () { helper(); };",
        ""
      ].join("\n")
    });

    expect(result.functions).toEqual([
      expect.objectContaining({ name: "local", exported: true }),
      expect.objectContaining({ name: "assigned", exported: true }),
      expect.objectContaining({ name: "object", exported: true }),
      expect.objectContaining({ name: "method", exported: true }),
      expect.objectContaining({ name: "direct", exported: true })
    ]);
    expect(result.callCandidates).toEqual([
      { callerName: "local", callerOwnerName: null, calleeText: "helper", lineNumber: 1 },
      { callerName: "assigned", callerOwnerName: null, calleeText: "helper", lineNumber: 3 },
      { callerName: "object", callerOwnerName: null, calleeText: "helper", lineNumber: 4 },
      { callerName: "method", callerOwnerName: null, calleeText: "helper", lineNumber: 4 },
      { callerName: "direct", callerOwnerName: null, calleeText: "helper", lineNumber: 5 }
    ]);
  });
});
