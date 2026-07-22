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

describe("vendored TypeScript extraction", () => {
  test("adapts upstream classes methods functions imports and calls", async () => {
    const result = await registry.analyzeFile({
      path: "sample.ts",
      language: "typescript",
      content: "import { x } from './x.js'; export class A { value: string; run(input: string): void { x(); } } export function free(a: number): string { return String(a); }"
    });

    expect(result.types).toEqual([expect.objectContaining({
      kind: "class",
      name: "A",
      properties: [expect.objectContaining({ name: "value", type: null })],
      exported: true
    })]);
    expect(result.methods).toEqual([expect.objectContaining({
      name: "run",
      ownerName: "A",
      parameters: [],
      static: null
    })]);
    expect(result.functions).toEqual([expect.objectContaining({
      name: "free",
      parameters: [{ name: "a", type: null }],
      returnType: "string",
      exported: true
    })]);
    expect(result.importCandidates).toEqual([{ source: "./x.js", specifiers: ["x"], lineNumber: 1, kind: "module" }]);
    expect(result.callCandidates).toContainEqual({ callerName: "run", callerOwnerName: null, calleeText: "x", lineNumber: 1 });
    expect(result.warnings).toEqual(["Upstream method A.run has no callable detail record"]);
  });
});
