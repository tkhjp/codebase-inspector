import { parseAnalysisReport, parseAnalysisReportV2 } from "../schema/analysis-report.mjs";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildAnalysisReport({ symbolIndex, scan, analyses, relationshipCounts, options }) {
  const parserFailures = analyses
    .filter((analysis) => analysis.warnings.length > 0)
    .sort((left, right) => compareText(left.filePath, right.filePath))
    .map((analysis) => ({ filePath: analysis.filePath, warnings: [...analysis.warnings] }));

  if (symbolIndex.schemaVersion === "1.0.0") {
    return parseAnalysisReport({
      schemaVersion: "1.0.0",
      skillVersion: symbolIndex.project.skillVersion,
      status: parserFailures.length === 0 ? "complete" : "partial",
      coverage: { ...symbolIndex.coverage },
      warnings: [...scan.warnings].sort(compareText),
      parserFailures,
      unsupportedFiles: scan.unsupportedFiles.map((file) => file.path).sort(compareText),
      relationships: {
        internalImports: relationshipCounts.internalImports,
        externalImports: relationshipCounts.externalImports,
        unresolvedImports: relationshipCounts.unresolvedImports,
        resolvedCalls: relationshipCounts.resolvedCalls,
        unresolvedCalls: relationshipCounts.unresolvedCalls
      },
      options: { ...options }
    });
  }
  return parseAnalysisReportV2({
    schemaVersion: "2.0.0",
    skillVersion: symbolIndex.project.skillVersion,
    snapshotFingerprint: symbolIndex.snapshotFingerprint,
    status: parserFailures.length === 0 ? "complete" : "partial",
    coverage: { ...symbolIndex.coverage },
    warnings: [...scan.warnings].sort(compareText),
    parserFailures,
    unsupportedFiles: scan.unsupportedFiles.map((file) => file.path).sort(compareText),
    relationships: {
      ...relationshipCounts,
      ambiguousCalls: relationshipCounts.ambiguousCalls ?? 0,
      dynamicCalls: relationshipCounts.dynamicCalls ?? 0,
      typeRelations: (symbolIndex.typeRelations ?? []).length
    },
    languageCapabilities: (symbolIndex.languageCapabilities ?? []).map((capability) => ({
      ...capability,
      supportedFacts: [...capability.supportedFacts],
      unsupportedFacts: [...capability.unsupportedFacts]
    })),
    options: { ...options }
  });
}
