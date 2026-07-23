import {
  extractRustModSources,
  resolvePythonImport,
  resolveRustImport
} from "../../vendor/understand-anything/import-map/python-rust-resolvers.mjs";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function lineNumberForSource(content, source) {
  const name = source.startsWith("self::") ? source.slice("self::".length) : source;
  const lines = content.split("\n");
  const pattern = new RegExp(`^\\s*(?:pub(?:\\s*\\([^)]*\\))?\\s+)?mod\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*;`);
  const index = lines.findIndex((line) => pattern.test(line));
  return index === -1 ? 1 : index + 1;
}

export function buildResolvedImportMap({ files, analyses }) {
  const sortedFiles = [...files].sort((left, right) => compareText(left.path, right.path));
  const fileSet = new Set(sortedFiles.map((file) => file.path));
  const analysisByPath = new Map(analyses.map((analysis) => [analysis.filePath, analysis]));
  const context = { fileSet };
  const resolvedByPath = new Map();

  for (const file of sortedFiles) {
    if (file.language !== "python" && file.language !== "rust") continue;
    const analysis = analysisByPath.get(file.path);
    const candidates = [...(analysis?.importCandidates ?? [])].sort((left, right) =>
      left.lineNumber - right.lineNumber || compareText(left.source, right.source));
    if (file.language === "rust") {
      for (const source of extractRustModSources(file.content)) {
        candidates.push({ source, specifiers: [], lineNumber: lineNumberForSource(file.content, source), kind: "module" });
      }
    }

    const byTarget = new Map();
    for (const candidate of candidates) {
      let targets = [];
      if (file.language === "python") {
        targets = resolvePythonImport(candidate.source, candidate.specifiers, file, context);
      } else if (file.language === "rust") {
        targets = resolveRustImport(candidate.source, file, context);
      }
      for (const targetPath of targets) {
        if (targetPath === file.path) continue;
        if (!byTarget.has(targetPath)) {
          byTarget.set(targetPath, {
            targetPath,
            source: candidate.source,
            lineNumber: candidate.lineNumber
          });
        }
      }
    }
    resolvedByPath.set(file.path, [...byTarget.values()].sort((left, right) => compareText(left.targetPath, right.targetPath)));
  }
  return resolvedByPath;
}

export async function buildImportMap(input) {
  const resolved = buildResolvedImportMap(input);
  const paths = [...input.files].map((file) => file.path).sort(compareText);
  return Object.fromEntries(paths.map((path) => [path, (resolved.get(path) ?? []).map((entry) => entry.targetPath)]));
}
