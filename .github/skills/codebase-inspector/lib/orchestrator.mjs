import { basename } from "node:path";
import { buildCodeGraph } from "./graph/build-code-graph.mjs";
import { buildSymbolIndex } from "./normalize/symbol-index.mjs";
import { serializeArtifacts } from "./output/artifacts.mjs";
import { publishArtifacts } from "./output/publish.mjs";
import { createParserRegistry } from "./parsers/registry.mjs";
import { buildAnalysisReport } from "./reports/build-analysis-report.mjs";
import { renderMarkdownIndexes } from "./reports/render-markdown.mjs";
import { withAnalysisLock } from "./runtime/lock.mjs";
import { scanProject } from "./scanner/scan.mjs";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function runAnalysis(runConfig) {
  return withAnalysisLock(runConfig.gitDir, async () => {
    const scan = await scanProject(runConfig);
    const registry = await createParserRegistry(runConfig.skillDir);
    try {
      const analyses = await Promise.all(scan.files.map((file) => registry.analyzeFile(file)));
      const project = {
        ...runConfig,
        name: basename(runConfig.targetRoot),
        root: null,
        workingTreeDirty: scan.git.dirty,
        languages: [...new Set(scan.files.map((file) => file.language))].sort(compareText)
      };
      const { symbolIndex, relationshipCounts } = buildSymbolIndex({
        project,
        scan,
        analyses,
        skillVersion: "0.1.0"
      });
      const codeGraph = buildCodeGraph(symbolIndex, { analyzedAt: runConfig.gitCommitTimestamp });
      const report = buildAnalysisReport({
        symbolIndex,
        scan,
        analyses,
        relationshipCounts,
        options: runConfig.options
      });
      const markdown = renderMarkdownIndexes(symbolIndex);
      const artifacts = serializeArtifacts({ symbolIndex, codeGraph, report, markdown });
      await publishArtifacts({
        targetRoot: runConfig.targetRoot,
        outputPath: runConfig.outputPath,
        artifacts,
        tracked: runConfig.options.tracked
      });
      return { status: report.status, outputPath: runConfig.outputPath };
    } finally {
      await registry.close();
    }
  });
}
