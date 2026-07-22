import { resolveRelationships } from "./relationships.mjs";
import { stableId } from "./stable-id.mjs";
import { parseSymbolIndex } from "../schema/symbol-index.mjs";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSymbols(left, right) {
  return compareText(left.filePath, right.filePath)
    || left.lineRange[0] - right.lineRange[0]
    || compareText(left.id, right.id);
}

function compareRawMethods(left, right) {
  return compareText(left.ownerName, right.ownerName)
    || compareText(left.name, right.name)
    || left.lineRange[0] - right.lineRange[0]
    || left.lineRange[1] - right.lineRange[1]
    || compareText(JSON.stringify(left.parameters), JSON.stringify(right.parameters))
    || compareText(left.returnType ?? "", right.returnType ?? "");
}

function callableFields(raw, id, filePath) {
  return {
    id,
    name: raw.name,
    filePath,
    lineRange: [...raw.lineRange],
    parameters: raw.parameters.map((parameter) => ({ ...parameter })),
    returnType: raw.returnType,
    visibility: raw.visibility,
    async: raw.async,
    exported: raw.exported
  };
}

function canonicalProject(project, skillVersion) {
  return {
    name: project.name,
    root: project.root,
    gitCommitHash: project.gitCommitHash,
    workingTreeDirty: project.workingTreeDirty,
    languages: [...project.languages].sort(compareText),
    skillVersion
  };
}

export function buildSymbolIndex({ project, scan, analyses, skillVersion }) {
  const analysisByPath = new Map();
  for (const analysis of analyses) {
    if (analysisByPath.has(analysis.filePath)) throw new Error(`Duplicate raw analysis for ${analysis.filePath}`);
    analysisByPath.set(analysis.filePath, analysis);
  }

  const trackedFiles = [...scan.files, ...scan.unsupportedFiles].sort((left, right) => compareText(left.path, right.path));
  const files = trackedFiles.map((file) => ({
    id: stableId("file", file.path),
    path: file.path,
    language: file.language,
    category: file.category,
    lineCount: file.lineCount,
    parseStatus: file.category === "unsupported"
      ? "unsupported"
      : (analysisByPath.get(file.path)?.warnings.length ? "warning" : "parsed"),
    typeIds: [],
    methodIds: [],
    functionIds: []
  }));
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const types = [];
  const methods = [];
  const functions = [];

  for (const analysis of [...analyses].sort((left, right) => compareText(left.filePath, right.filePath))) {
    const file = fileByPath.get(analysis.filePath);
    if (!file) throw new Error(`Raw analysis does not match a tracked file: ${analysis.filePath}`);

    const typesForFile = analysis.types.map((raw) => ({
      id: stableId("type", analysis.filePath, raw.kind, raw.name, raw.lineRange[0]),
      kind: raw.kind,
      name: raw.name,
      filePath: analysis.filePath,
      lineRange: [...raw.lineRange],
      properties: raw.properties.map((property) => ({
        ...property,
        lineRange: property.lineRange === null ? null : [...property.lineRange]
      })),
      methodIds: [],
      extends: [...raw.extends],
      implements: [...raw.implements],
      exported: raw.exported
    }));
    const typesByName = new Map();
    for (const type of typesForFile) {
      const matches = typesByName.get(type.name) ?? [];
      matches.push(type);
      typesByName.set(type.name, matches);
    }

    const methodIdCounts = new Map();
    const methodsForFile = [...analysis.methods].sort(compareRawMethods).map((raw) => {
      const owners = typesByName.get(raw.ownerName) ?? [];
      if (owners.length !== 1) throw new Error(`Method owner is not unique in ${analysis.filePath}: ${raw.ownerName}`);
      const owner = owners[0];
      const baseId = stableId("method", analysis.filePath, raw.ownerName, raw.name, raw.lineRange[0]);
      const occurrence = (methodIdCounts.get(baseId) ?? 0) + 1;
      methodIdCounts.set(baseId, occurrence);
      const id = occurrence === 1 ? baseId : `${baseId}:overload:${occurrence}`;
      const method = {
        ...callableFields(raw, id, analysis.filePath),
        ownerTypeId: owner.id,
        static: raw.static
      };
      owner.methodIds.push(method.id);
      return method;
    });
    const functionsForFile = analysis.functions.map((raw) => callableFields(
      raw,
      stableId("function", analysis.filePath, raw.name, raw.lineRange[0]),
      analysis.filePath
    ));

    typesForFile.sort(compareSymbols);
    methodsForFile.sort(compareSymbols);
    functionsForFile.sort(compareSymbols);
    for (const type of typesForFile) type.methodIds.sort(compareText);
    file.typeIds.push(...typesForFile.map((type) => type.id));
    file.methodIds.push(...methodsForFile.map((method) => method.id));
    file.functionIds.push(...functionsForFile.map((func) => func.id));
    types.push(...typesForFile);
    methods.push(...methodsForFile);
    functions.push(...functionsForFile);
  }

  types.sort(compareSymbols);
  methods.sort(compareSymbols);
  functions.sort(compareSymbols);
  const indexDraft = { files, types, methods, functions };
  const relationships = resolveRelationships(indexDraft, analyses);
  const warningFiles = scan.files.filter((file) => analysisByPath.get(file.path)?.warnings.length).length;
  const symbolIndex = parseSymbolIndex({
    schemaVersion: "1.0.0",
    project: canonicalProject(project, skillVersion),
    ...indexDraft,
    imports: relationships.imports,
    calls: relationships.calls,
    unresolvedCalls: relationships.unresolvedCalls,
    coverage: {
      trackedFiles: trackedFiles.length,
      supportedFiles: scan.files.length,
      parsedFiles: scan.files.length - warningFiles,
      warningFiles,
      unsupportedFiles: scan.unsupportedFiles.length
    }
  });

  return { symbolIndex, relationshipCounts: relationships.relationshipCounts };
}
