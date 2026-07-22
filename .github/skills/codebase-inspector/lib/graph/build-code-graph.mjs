import { parseCodeGraph } from "../schema/code-graph.mjs";

const nodeDefaults = { summary: "", tags: [], complexity: "simple" };

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRecords(left, right) {
  return compareText(left.filePath, right.filePath)
    || (left.lineRange?.[0] ?? 0) - (right.lineRange?.[0] ?? 0)
    || compareText(left.name, right.name)
    || compareText(left.id, right.id);
}

function compareEdges(left, right) {
  const typeOrder = { contains: 0, imports: 1, calls: 2 };
  const containsTargetOrder = (target) => {
    if (target.startsWith("type:")) return 0;
    if (target.startsWith("method:")) return 1;
    return 2;
  };
  return typeOrder[left.type] - typeOrder[right.type]
    || compareText(left.source, right.source)
    || (left.type === "contains" ? containsTargetOrder(left.target) - containsTargetOrder(right.target) : 0)
    || compareText(left.target, right.target);
}

function node(record, type, name, lineRange) {
  return { id: record.id, type, name, filePath: record.filePath ?? record.path, lineRange, ...nodeDefaults };
}

export function buildCodeGraph(symbolIndex, { analyzedAt }) {
  const files = [...symbolIndex.files].sort((left, right) => compareText(left.path, right.path));
  const types = [...symbolIndex.types].sort(compareRecords);
  const methods = [...symbolIndex.methods].sort(compareRecords);
  const functions = [...symbolIndex.functions].sort(compareRecords);
  const nodes = [
    ...files.map((file) => node(file, "file", file.path, null)),
    ...types.map((type) => node(type, "class", type.name, type.lineRange)),
    ...methods.map((method) => node(method, "function", method.name, method.lineRange)),
    ...functions.map((func) => node(func, "function", func.name, func.lineRange))
  ].sort(compareRecords);
  const edges = [
    ...files.flatMap((file) => [
      ...file.typeIds.map((target) => ({ source: file.id, target, type: "contains", direction: "forward", weight: 1 })),
      ...file.methodIds.map((target) => ({ source: file.id, target, type: "contains", direction: "forward", weight: 1 })),
      ...file.functionIds.map((target) => ({ source: file.id, target, type: "contains", direction: "forward", weight: 1 }))
    ]),
    ...symbolIndex.imports.map((record) => ({ source: record.sourceFileId, target: record.targetFileId, type: "imports", direction: "forward", weight: 0.8 })),
    ...symbolIndex.calls.map((record) => ({ source: record.callerId, target: record.calleeId, type: "calls", direction: "forward", weight: 0.7 }))
  ].sort(compareEdges);

  return parseCodeGraph({
    version: "1.0.0",
    kind: "codebase",
    project: {
      name: symbolIndex.project.name,
      languages: [...symbolIndex.project.languages].sort(compareText),
      frameworks: [],
      description: "",
      analyzedAt,
      gitCommitHash: symbolIndex.project.gitCommitHash
    },
    nodes,
    edges,
    layers: [],
    tour: []
  });
}
