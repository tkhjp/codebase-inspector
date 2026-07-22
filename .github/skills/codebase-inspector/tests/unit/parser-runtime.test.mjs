import { expect, it } from "vitest";
import { fileURLToPath, URL } from "node:url";
import { createParserRegistry } from "../../lib/parsers/registry.mjs";
import { createTreeSitterRuntime } from "../../lib/parsers/tree-sitter-runtime.mjs";

const skillDir = fileURLToPath(new URL("../..", import.meta.url));

it("loads JavaScript grammar and returns strict raw analysis", async () => {
  const registry = await createParserRegistry(skillDir);
  try {
    const result = await registry.analyzeFile({
      path: "a.js",
      language: "javascript",
      content: "function a() {}\n"
    });

    expect(result).toEqual({
      filePath: "a.js",
      language: "javascript",
      types: [],
      methods: [],
      functions: [{
        name: "a",
        lineRange: [1, 1],
        parameters: [],
        returnType: null,
        visibility: null,
        async: null,
        exported: null
      }],
      importCandidates: [],
      callCandidates: [],
      warnings: []
    });
  } finally {
    await registry.close();
  }
});

it("returns a strict warning analysis when an extractor fails", async () => {
  const runtime = await createTreeSitterRuntime(skillDir, new Map([["javascript", {
    extract() {
      throw new Error("fixture failure");
    }
  }]]));

  try {
    await expect(runtime.analyzeFile({
      path: "a.js",
      language: "javascript",
      content: "function a() {}\n"
    })).resolves.toEqual({
      filePath: "a.js",
      language: "javascript",
      types: [],
      methods: [],
      functions: [],
      importCandidates: [],
      callCandidates: [],
      warnings: ["Tree-sitter analysis failed for a.js"]
    });
  } finally {
    await runtime.close();
  }
});

it("loads the vendored Dart grammar without a sibling checkout", async () => {
  const runtime = await createTreeSitterRuntime(skillDir, new Map([["dart", {
    extract(_rootNode, context) {
      return {
        filePath: context.filePath,
        language: context.language,
        types: [],
        methods: [],
        functions: [],
        importCandidates: [],
        callCandidates: [],
        warnings: []
      };
    }
  }]]));

  try {
    await expect(runtime.analyzeFile({
      path: "main.dart",
      language: "dart",
      content: "void main() {}\n"
    })).resolves.toMatchObject({
      filePath: "main.dart",
      language: "dart",
      warnings: []
    });
  } finally {
    await runtime.close();
  }
});
