import { expect, test } from "vitest";
import { createUpstreamAdapter } from "../../lib/extractors/upstream-adapter.mjs";

const callable = (name, lineRange, params = []) => ({ name, lineRange, params });

test("consumes class callables one-to-one and preserves a same-name free function", () => {
  const adapter = createUpstreamAdapter({
    extractStructure() {
      return {
        classes: [{ name: "Runner", lineRange: [1, 5], methods: ["run"], properties: [] }],
        functions: [callable("run", [2, 3], ["value"]), callable("run", [8, 9], ["freeValue"])],
        imports: [],
        exports: []
      };
    },
    extractCallGraph() { return []; }
  });

  const result = adapter.extract({}, { filePath: "sample.ts", language: "typescript" });

  expect(result.methods).toEqual([expect.objectContaining({
    name: "run",
    ownerName: "Runner",
    lineRange: [2, 3],
    parameters: [{ name: "value", type: null }]
  })]);
  expect(result.functions).toEqual([expect.objectContaining({
    name: "run",
    lineRange: [8, 9],
    parameters: [{ name: "freeValue", type: null }]
  })]);
});

test("consumes overload callable details once in source order", () => {
  const adapter = createUpstreamAdapter({
    extractStructure() {
      return {
        classes: [{ name: "Runner", lineRange: [1, 8], methods: ["run", "run"], properties: [] }],
        functions: [callable("run", [2, 2]), callable("run", [4, 6], ["value"])],
        imports: [],
        exports: []
      };
    },
    extractCallGraph() { return []; }
  });

  const result = adapter.extract({}, { filePath: "Runner.java", language: "java" });

  expect(result.methods.map((method) => ({ lineRange: method.lineRange, parameters: method.parameters }))).toEqual([
    { lineRange: [2, 2], parameters: [] },
    { lineRange: [4, 6], parameters: [{ name: "value", type: null }] }
  ]);
  expect(result.functions).toEqual([]);
});

test("keeps an out-of-range sole callable free for non-Go languages", () => {
  const adapter = createUpstreamAdapter({
    extractStructure() {
      return {
        classes: [{ name: "Runner", lineRange: [1, 5], methods: ["run"], properties: [] }],
        functions: [callable("run", [8, 9], ["freeValue"])],
        imports: [],
        exports: []
      };
    },
    extractCallGraph() { return []; }
  });

  const result = adapter.extract({}, { filePath: "sample.ts", language: "typescript" });

  expect(result.methods).toEqual([expect.objectContaining({
    name: "run",
    ownerName: "Runner",
    lineRange: [1, 5],
    parameters: []
  })]);
  expect(result.functions).toEqual([expect.objectContaining({
    name: "run",
    lineRange: [8, 9],
    parameters: [{ name: "freeValue", type: null }]
  })]);
  expect(result.warnings).toEqual(["Upstream method Runner.run has no callable detail record"]);
});

test("uses the out-of-range sole callable fallback for Go receiver methods", () => {
  const adapter = createUpstreamAdapter({
    extractStructure() {
      return {
        classes: [{ name: "Runner", lineRange: [2, 2], methods: ["run"], properties: [] }],
        functions: [callable("run", [4, 4], ["value"])],
        imports: [],
        exports: []
      };
    },
    extractCallGraph() { return []; }
  });

  const result = adapter.extract({}, { filePath: "sample.go", language: "go" });

  expect(result.methods).toEqual([expect.objectContaining({
    name: "run",
    ownerName: "Runner",
    lineRange: [4, 4],
    parameters: [{ name: "value", type: null }]
  })]);
  expect(result.functions).toEqual([]);
  expect(result.warnings).toEqual([]);
});
