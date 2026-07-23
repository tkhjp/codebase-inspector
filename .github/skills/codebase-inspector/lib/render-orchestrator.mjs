import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { selectStructure } from "./query/select-structure.mjs";
import { publishStructureDocuments } from "./output/publish-structure-documents.mjs";
import { stableStringify } from "./output/stable-json.mjs";
import { renderStructureDocuments } from "./reports/render-structure-documents.mjs";
import { parseStructureRenderReport } from "./schema/structure-render-report.mjs";
import { parseSymbolIndexV2 } from "./schema/symbol-index.mjs";
import { getGitMetadata } from "./scanner/git-files.mjs";
import { isPathWithin, rebasePathWithin, resolveOutputBoundary } from "./runtime/path-boundary.mjs";

function projectRelative(root, path) {
  return relative(root, path).replaceAll("\\", "/");
}

function fileMatchesFilters(file, filters) {
  if (filters.language && file.language !== filters.language) return false;
  if (!filters.path) return true;
  const prefix = filters.path.replace(/\/+$/, "");
  return file.path === prefix || file.path.startsWith(`${prefix}/`);
}

export async function runStructureRender(options) {
  const lexicalCwd = resolve(options.cwd ?? process.cwd());
  const canonicalCwd = await realpath(lexicalCwd);
  const git = await getGitMetadata(canonicalCwd);
  const snapshotPath = await realpath(resolve(options.snapshotPath));
  const lexicalOutputPath = resolve(options.outputPath);
  if (dirname(options.definitionOutput) !== lexicalOutputPath || dirname(options.diagramOutput) !== lexicalOutputPath) {
    throw new Error("Definition and diagram outputs must be direct children of the selected output directory");
  }
  if (basename(options.definitionOutput) === basename(options.diagramOutput)) {
    throw new Error("Definition and diagram outputs must use different filenames");
  }
  const requestedOutputPath = rebasePathWithin(lexicalOutputPath, lexicalCwd, canonicalCwd);
  const boundary = await resolveOutputBoundary({
    targetRoot: git.root,
    outputPath: requestedOutputPath,
    gitDir: git.gitDir,
    gitCommonDir: git.commonDir
  });
  const targetRoot = boundary.targetRoot;
  const outputPath = boundary.outputPath;
  if (!isPathWithin(targetRoot, snapshotPath, { allowRoot: false })) throw new Error("Snapshot path must stay inside the target repository");
  if (!isPathWithin(targetRoot, outputPath, { allowRoot: false })) throw new Error("Document output must stay inside the target repository");

  let raw;
  try {
    raw = JSON.parse(await readFile(snapshotPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read snapshot: ${error.message}`);
  }
  if (raw.schemaVersion !== "2.0.0") {
    throw new Error(`Snapshot schema ${raw.schemaVersion ?? "unknown"} is unsupported; rerun /codebase-inspector analyze before rendering`);
  }
  const symbolIndex = parseSymbolIndexV2(raw);
  const selection = selectStructure(symbolIndex, options.filters);
  const documents = renderStructureDocuments(symbolIndex, selection, options.filters);
  const outputDirectory = projectRelative(targetRoot, outputPath);
  const definitionName = basename(options.definitionOutput);
  const diagramName = basename(options.diagramOutput);
  if (definitionName !== "クラス定義書.md") {
    if (documents.has(definitionName)) throw new Error(`Definition output collides with a split document: ${definitionName}`);
    documents.set(definitionName, documents.get("クラス定義書.md"));
    documents.delete("クラス定義書.md");
  }
  if (diagramName !== "クラス図.md") {
    if (documents.has(diagramName)) throw new Error(`Diagram output collides with a split document: ${diagramName}`);
    documents.set(diagramName, documents.get("クラス図.md"));
    documents.delete("クラス図.md");
  }
  const parserIssues = symbolIndex.files
    .filter((file) => file.parseStatus !== "parsed" && fileMatchesFilters(file, options.filters))
    .map((file) => ({ path: file.path, status: file.parseStatus }));
  const unresolvedRelations = selection.relations
    .filter((relation) => relation.targetCategory === "unresolved")
    .map(({ sourceId, kind, origin, targetName }) => ({ sourceId, kind, origin, targetName }));
  const selectedMethodIds = new Set(selection.views.flatMap((view) => view.methods.map((method) => method.id)));
  const resolvedCalls = symbolIndex.calls.filter((call) => selectedMethodIds.has(call.callerId));
  const unresolvedCalls = symbolIndex.unresolvedCalls
    .filter((call) => call.callerId !== null && selectedMethodIds.has(call.callerId))
    .map((call) => ({ ...call, callerId: call.callerId }));
  const report = parseStructureRenderReport({
    schemaVersion: "1.0.0",
    snapshotSchemaVersion: symbolIndex.schemaVersion,
    snapshotFingerprint: symbolIndex.snapshotFingerprint,
    filters: { ...options.filters },
    outputDirectory,
    definitionOutput: projectRelative(targetRoot, resolve(outputPath, definitionName)),
    diagramOutput: projectRelative(targetRoot, resolve(outputPath, diagramName)),
    matchedTypeCount: selection.matchedCount,
    selectedTypeCount: selection.selectedCount,
    truncated: selection.truncated,
    omittedTypeCount: selection.omittedCount,
    parserFailureCount: parserIssues.filter((issue) => issue.status === "warning").length,
    unsupportedFileCount: parserIssues.filter((issue) => issue.status === "unsupported").length,
    parserIssues,
    unresolvedRelationCount: unresolvedRelations.length,
    unresolvedRelations,
    omittedRelationCount: selection.omittedRelationCount,
    resolvedCallCount: resolvedCalls.length,
    unresolvedCallCount: unresolvedCalls.length,
    ambiguousCallCount: unresolvedCalls.filter((call) => call.reason === "ambiguous-callee").length,
    dynamicCallCount: unresolvedCalls.filter((call) => call.reason === "dynamic-call").length,
    unresolvedCalls,
    outputs: [...documents.keys(), "structure-render-report.json"].sort()
  });
  documents.set("structure-render-report.json", stableStringify(report));
  await publishStructureDocuments(outputPath, documents);
  const hasParserIssues = report.parserFailureCount + report.unsupportedFileCount > 0;
  return {
    status: selection.truncated || hasParserIssues || report.unresolvedRelationCount > 0 ? "partial" : "complete",
    outputPath: outputDirectory,
    definitionOutput: report.definitionOutput,
    diagramOutput: report.diagramOutput,
    reportOutput: projectRelative(targetRoot, resolve(outputPath, "structure-render-report.json")),
    matchedTypeCount: selection.matchedCount,
    selectedTypeCount: selection.selectedCount,
    truncated: selection.truncated,
    parserIssueCount: report.parserIssues.length,
    unresolvedRelationCount: report.unresolvedRelationCount,
    omittedRelationCount: report.omittedRelationCount,
    resolvedCallCount: report.resolvedCallCount,
    unresolvedCallCount: report.unresolvedCallCount,
    ambiguousCallCount: report.ambiguousCallCount,
    dynamicCallCount: report.dynamicCallCount
  };
}
