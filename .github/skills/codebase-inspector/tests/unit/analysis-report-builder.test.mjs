import { expect, test } from "vitest";
import { buildAnalysisReport } from "../../lib/reports/build-analysis-report.mjs";
import { parseAnalysisReport } from "../../lib/schema/analysis-report.mjs";

const symbolIndex = {
  schemaVersion: "1.0.0",
  project: { name: "fixture", root: null, gitCommitHash: "abc123", workingTreeDirty: false, languages: ["typescript"], skillVersion: "0.1.0" },
  files: [], types: [], methods: [], functions: [], imports: [], calls: [], unresolvedCalls: [],
  coverage: { trackedFiles: 3, supportedFiles: 2, parsedFiles: 1, warningFiles: 1, unsupportedFiles: 1 }
};

test("reports parser failures, unsupported files, and Task 2 relationship counts deterministically", () => {
  const report = buildAnalysisReport({
    symbolIndex,
    scan: {
      warnings: ["scan warning"],
      unsupportedFiles: [{ path: "z.txt" }]
    },
    analyses: [
      { filePath: "src/z.ts", warnings: ["z warning"] },
      { filePath: "src/a.ts", warnings: [] },
      { filePath: "src/b.ts", warnings: ["b warning", "another warning"] }
    ],
    relationshipCounts: { internalImports: 1, externalImports: 2, unresolvedImports: 3, resolvedCalls: 4, unresolvedCalls: 5 },
    options: { tracked: false, output: ".code-understanding", keepIntermediate: false }
  });

  expect(report).toEqual({
    schemaVersion: "1.0.0",
    skillVersion: "0.1.0",
    status: "partial",
    coverage: symbolIndex.coverage,
    warnings: ["scan warning"],
    parserFailures: [
      { filePath: "src/b.ts", warnings: ["b warning", "another warning"] },
      { filePath: "src/z.ts", warnings: ["z warning"] }
    ],
    unsupportedFiles: ["z.txt"],
    relationships: { internalImports: 1, externalImports: 2, unresolvedImports: 3, resolvedCalls: 4, unresolvedCalls: 5 },
    options: { tracked: false, output: ".code-understanding", keepIntermediate: false }
  });
  expect(parseAnalysisReport(report)).toEqual(report);
});
