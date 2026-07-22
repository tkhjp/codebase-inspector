import { expect, it } from "vitest";
import { fileURLToPath, URL } from "node:url";
import { createParserRegistry } from "../../lib/parsers/registry.mjs";
import { createTreeSitterRuntime } from "../../lib/parsers/tree-sitter-runtime.mjs";
import { buildSymbolIndex } from "../../lib/normalize/symbol-index.mjs";
import { buildAnalysisReport } from "../../lib/reports/build-analysis-report.mjs";

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

it("retains conservative facts and reports malformed TypeScript and Python as partial", async () => {
  const registry = await createParserRegistry(skillDir);
  const files = [
    {
      path: "broken.ts",
      language: "typescript",
      category: "source",
      lineCount: 2,
      bytes: 45,
      content: "export function valid() {}\nfunction broken(\n"
    },
    {
      path: "broken.py",
      language: "python",
      category: "source",
      lineCount: 4,
      bytes: 48,
      content: "def valid():\n    return 1\n\ndef broken(:\n"
    }
  ];
  try {
    const analyses = await Promise.all(files.map((file) => registry.analyzeFile(file)));
    expect(analyses.map((analysis) => analysis.warnings)).toEqual([
      ["Tree-sitter syntax errors in broken.ts"],
      ["Tree-sitter syntax errors in broken.py"]
    ]);
    expect(analyses[0].functions.map((entry) => entry.name)).toContain("valid");
    expect(analyses[1].functions.map((entry) => entry.name)).toContain("valid");

    const { symbolIndex, relationshipCounts } = buildSymbolIndex({
      project: { name: "fixture", root: null, gitCommitHash: "abc123", workingTreeDirty: false, languages: ["python", "typescript"] },
      scan: { files, unsupportedFiles: [], warnings: [], git: {} },
      analyses,
      skillVersion: "0.1.0"
    });
    const report = buildAnalysisReport({
      symbolIndex,
      scan: { files, unsupportedFiles: [], warnings: [] },
      analyses,
      relationshipCounts,
      options: { tracked: false, output: ".code-understanding", keepIntermediate: false }
    });

    expect(symbolIndex.files.map((file) => file.parseStatus)).toEqual(["warning", "warning"]);
    expect(report.status).toBe("partial");
    expect(report.parserFailures).toEqual([
      { filePath: "broken.py", warnings: ["Tree-sitter syntax errors in broken.py"] },
      { filePath: "broken.ts", warnings: ["Tree-sitter syntax errors in broken.ts"] }
    ]);
  } finally {
    await registry.close();
  }
});
