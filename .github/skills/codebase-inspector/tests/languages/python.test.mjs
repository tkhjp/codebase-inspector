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

describe("vendored Python extraction", () => {
  test("keeps upstream method ownership limits explicit", async () => {
    const result = await registry.analyzeFile({
      path: "sample.py",
      language: "python",
      content: "import os\nclass A:\n    value = 1\n    def run(self, item):\n        helper(item)\ndef free(value):\n    return value\n"
    });

    expect(result.types).toEqual([expect.objectContaining({ name: "A", kind: "class", exported: true })]);
    expect(result.methods).toEqual([expect.objectContaining({
      name: "run",
      ownerName: "A",
      parameters: [],
      lineRange: [2, 5]
    })]);
    expect(result.functions).toEqual([expect.objectContaining({
      name: "free",
      parameters: [{ name: "value", type: null }],
      exported: true
    })]);
    expect(result.importCandidates).toEqual([{ source: "os", specifiers: ["os"], lineNumber: 1, kind: "module" }]);
    expect(result.callCandidates).toContainEqual({ callerName: "run", callerOwnerName: null, calleeText: "helper", lineNumber: 5 });
    expect(result.warnings).toEqual(["Upstream method A.run has no callable detail record"]);
  });
});
