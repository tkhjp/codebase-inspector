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

export async function runAnalysis(runConfig, dependencies = {}) {
  const lock = dependencies.withAnalysisLock ?? withAnalysisLock;
  const scan = dependencies.scanProject ?? scanProject;
  const createRegistry = dependencies.createParserRegistry ?? createParserRegistry;
  const buildIndex = dependencies.buildSymbolIndex ?? buildSymbolIndex;
  const buildGraph = dependencies.buildCodeGraph ?? buildCodeGraph;
  const buildReport = dependencies.buildAnalysisReport ?? buildAnalysisReport;
  const renderMarkdown = dependencies.renderMarkdownIndexes ?? renderMarkdownIndexes;
  const serialize = dependencies.serializeArtifacts ?? serializeArtifacts;
  const publish = dependencies.publishArtifacts ?? publishArtifacts;

  return lock(runConfig.gitDir, async () => {
    await dependencies.onLockAcquired?.();
    const scanResult = await scan(runConfig);
    const registry = await createRegistry(runConfig.skillDir);
    let prepared;
    let analysisError;
    try {
      const analyses = await Promise.all(scanResult.files.map((file) => registry.analyzeFile(file)));
      const project = {
        ...runConfig,
        name: basename(runConfig.targetRoot),
        root: null,
        workingTreeDirty: scanResult.git.dirty,
        languages: [...new Set(scanResult.files.map((file) => file.language))].sort(compareText)
      };
      const { symbolIndex, relationshipCounts } = buildIndex({
        project,
        scan: scanResult,
        analyses,
        skillVersion: "0.1.0"
      });
      const codeGraph = buildGraph(symbolIndex, { analyzedAt: runConfig.gitCommitTimestamp });
      const report = buildReport({
        symbolIndex,
        scan: scanResult,
        analyses,
        relationshipCounts,
        options: runConfig.options
      });
      const markdown = renderMarkdown(symbolIndex);
      const artifacts = serialize({ symbolIndex, codeGraph, report, markdown });
      prepared = { artifacts, status: report.status };
    } catch (error) {
      analysisError = error;
    }

    let closeError;
    try {
      await registry.close();
    } catch (error) {
      closeError = error;
    }

    if (analysisError && closeError) {
      throw new AggregateError([analysisError, closeError], "Analysis and parser registry close failed");
    }
    if (analysisError) throw analysisError;
    if (closeError) throw closeError;

    await publish({
      targetRoot: runConfig.targetRoot,
      outputPath: runConfig.outputPath,
      artifacts: prepared.artifacts,
      tracked: runConfig.options.tracked
    });
    return { status: prepared.status, outputPath: runConfig.outputPath };
  });
}
