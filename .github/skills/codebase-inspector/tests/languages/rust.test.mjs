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

describe("vendored Rust extraction", () => {
  test("separates impl methods from free functions", async () => {
    const result = await registry.analyzeFile({
      path: "sample.rs",
      language: "rust",
      content: "use std::fmt; pub struct A { pub value: i32 } impl A { pub fn run(&self, item: i32) { helper(); } } pub fn free(value: i32) -> i32 { value }"
    });

    expect(result.types).toEqual([expect.objectContaining({
      name: "A",
      properties: [expect.objectContaining({ name: "value", type: null })]
    })]);
    expect(result.methods).toEqual([expect.objectContaining({
      name: "run",
      ownerName: "A",
      parameters: [{ name: "item", type: null }]
    })]);
    expect(result.functions).toEqual([expect.objectContaining({
      name: "free",
      parameters: [{ name: "value", type: null }],
      returnType: "i32"
    })]);
    expect(result.importCandidates).toEqual([{ source: "std", specifiers: ["fmt"], lineNumber: 1, kind: "module" }]);
    expect(result.callCandidates).toContainEqual({ callerName: "run", callerOwnerName: null, calleeText: "helper", lineNumber: 1 });
    expect(result.warnings).toEqual([]);
  });
});
