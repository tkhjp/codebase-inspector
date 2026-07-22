import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParserRegistry } from "../../lib/parsers/registry.mjs";

const skillDir = fileURLToPath(new URL("../..", import.meta.url));
const fixturePath = new URL("../fixtures/languages/rust/sample.rs", import.meta.url);

let registry;

beforeAll(async () => {
  registry = await createParserRegistry(skillDir);
});

afterAll(async () => {
  await registry.close();
});

describe("Rust rich symbol extraction", () => {
  it("keeps trait and impl methods owned with Rust visibility and types", async () => {
    const result = await registry.analyzeFile({
      path: "src/sample.rs",
      language: "rust",
      content: await readFile(fixturePath, "utf8")
    });

    expect(result.warnings).toEqual([]);
    expect(result.types).toEqual([
      {
        kind: "struct",
        name: "Greeter",
        lineRange: [3, 6],
        properties: [
          { name: "prefix", type: "String", visibility: "public", static: false, lineRange: [4, 4] },
          { name: "count", type: "usize", visibility: "private", static: false, lineRange: [5, 5] }
        ],
        extends: [],
        implements: [],
        exported: true
      },
      {
        kind: "enum",
        name: "Status",
        lineRange: [8, 12],
        properties: [
          { name: "Ready", type: null, visibility: "public", static: true, lineRange: [9, 9] },
          { name: "Error", type: "String", visibility: "public", static: true, lineRange: [10, 10] },
          { name: "Named", type: "{ code: i32 }", visibility: "public", static: true, lineRange: [11, 11] }
        ],
        extends: [],
        implements: [],
        exported: true
      },
      {
        kind: "trait",
        name: "Runner",
        lineRange: [14, 16],
        properties: [],
        extends: [],
        implements: [],
        exported: true
      }
    ]);

    expect(result.methods).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "run",
        ownerName: "Runner",
        parameters: [{ name: "input", type: "&str" }],
        returnType: "String",
        visibility: "public",
        static: false,
        async: false
      }),
      expect.objectContaining({
        name: "new",
        ownerName: "Greeter",
        parameters: [{ name: "prefix", type: "String" }],
        returnType: "Self",
        visibility: "public",
        static: true,
        async: false,
        exported: true
      }),
      expect.objectContaining({
        name: "run",
        ownerName: "Greeter",
        parameters: [{ name: "input", type: "&str" }],
        returnType: "String",
        visibility: "public",
        static: false,
        async: true,
        exported: true
      })
    ]));
    expect(result.methods.flatMap(({ parameters }) => parameters.map(({ name }) => name))).not.toContain("self");
    expect(result.functions).toEqual([{
      name: "add",
      lineRange: [28, 30],
      parameters: [
        { name: "left", type: "i32" },
        { name: "right", type: "i32" }
      ],
      returnType: "i32",
      visibility: "public",
      async: false,
      exported: true
    }]);
    expect(result.functions.map(({ name }) => name)).not.toEqual(expect.arrayContaining(["new", "run"]));
    expect(result.importCandidates).toEqual([{
      source: "crate::format",
      specifiers: ["format_name"],
      lineNumber: 1,
      kind: "module"
    }]);
    expect(result.callCandidates).toContainEqual({
      callerName: "run",
      callerOwnerName: "Greeter",
      calleeText: "format_name",
      lineNumber: 24
    });
  });

  it("renders structural Rust forms and warns without leaking dynamic expressions", async () => {
    const result = await registry.analyzeFile({
      path: "src/privacy.rs",
      language: "rust",
      content: [
        "use crate::collections::{self, Item as Renamed};",
        "pub struct Shapes<T> {",
        "    pub values: Vec<Option<T>>,",
        "    safe: [u8; 16],",
        "    skipped: [u8; dynamic_len(\"type-secret\")],",
        "}",
        "impl<T> Shapes<T> {",
        "    pub fn probe(&self, value: Option<&T>) -> Result<&T, Error> {",
        "        registry[CALL_SECRET](value);",
        "        helper(value)",
        "    }",
        "}",
        ""
      ].join("\n")
    });

    expect(result.types).toContainEqual(expect.objectContaining({
      name: "Shapes",
      properties: [
        expect.objectContaining({ name: "values", type: "Vec<Option<T>>" }),
        expect.objectContaining({ name: "safe", type: "[u8; 16]" }),
        expect.objectContaining({ name: "skipped", type: null })
      ]
    }));
    expect(result.methods).toContainEqual(expect.objectContaining({
      name: "probe",
      ownerName: "Shapes",
      parameters: [{ name: "value", type: "Option<&T>" }],
      returnType: "Result<&T, Error>"
    }));
    expect(result.importCandidates).toEqual([{
      source: "crate::collections",
      specifiers: ["self", "Renamed"],
      lineNumber: 1,
      kind: "module"
    }]);
    expect(result.callCandidates).toContainEqual({
      callerName: "probe",
      callerOwnerName: "Shapes",
      calleeText: "helper",
      lineNumber: 10
    });
    expect(result.warnings).toEqual([
      "Skipped dynamic Rust type at line 5",
      "Skipped dynamic Rust call target at line 9"
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("type-secret");
    expect(serialized).not.toContain("CALL_SECRET");
    expect(serialized).not.toContain("dynamic_len");
  });
});
