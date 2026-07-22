import { parseAnalysisReport } from "../schema/analysis-report.mjs";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildAnalysisReport({ symbolIndex, scan, analyses, relationshipCounts, options }) {
  const parserFailures = analyses
    .filter((analysis) => analysis.warnings.length > 0)
    .sort((left, right) => compareText(left.filePath, right.filePath))
    .map((analysis) => ({ filePath: analysis.filePath, warnings: [...analysis.warnings] }));

  return parseAnalysisReport({
    schemaVersion: "1.0.0",
    skillVersion: symbolIndex.project.skillVersion,
    status: parserFailures.length === 0 ? "complete" : "partial",
    coverage: { ...symbolIndex.coverage },
    warnings: [...scan.warnings].sort(compareText),
    parserFailures,
    unsupportedFiles: scan.unsupportedFiles.map((file) => file.path).sort(compareText),
    relationships: { ...relationshipCounts },
    options: { ...options }
  });
}
