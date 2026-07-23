import { enrichAnalysis } from "./ast-enricher.mjs";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toRawFunction(entry, exported) {
  return {
    name: entry.name,
    lineRange: entry.lineRange,
    parameters: entry.params.map((name) => ({ name, type: null })),
    returnType: entry.returnType ?? null,
    visibility: null,
    async: null,
    exported: exported.has(entry.name) ? true : null
  };
}

function containsLineRange(owner, callable) {
  return callable.lineRange[0] >= owner.lineRange[0] && callable.lineRange[1] <= owner.lineRange[1];
}

function candidateOwners(structure, callable, callableNameCounts, language) {
  const declared = structure.classes.filter((owner) => owner.methods.includes(callable.name));
  const eligible = declared.filter((owner) => containsLineRange(owner, callable));
  if (language === "go" && eligible.length === 0 && declared.length === 1 && callableNameCounts.get(callable.name) === 1) return declared;
  if (eligible.length < 2) return eligible;
  const smallestSpan = Math.min(...eligible.map((owner) => owner.lineRange[1] - owner.lineRange[0]));
  return eligible.filter((owner) => owner.lineRange[1] - owner.lineRange[0] === smallestSpan);
}

function adaptCallables(structure, exported, language) {
  const callableNameCounts = new Map();
  structure.functions.forEach((callable) => callableNameCounts.set(callable.name, (callableNameCounts.get(callable.name) ?? 0) + 1));
  const ownership = structure.functions.map((callable) => candidateOwners(structure, callable, callableNameCounts, language));
  const consumed = new Set();
  const warnings = [];
  const ambiguous = new Map();
  ownership.forEach((owners, index) => {
    if (owners.length < 2) return;
    const name = structure.functions[index].name;
    const names = ambiguous.get(name) ?? new Set();
    owners.forEach((owner) => names.add(owner.name));
    ambiguous.set(name, names);
  });

  const methods = [];
  for (const owner of structure.classes) {
    for (const name of owner.methods) {
      const callableIndex = structure.functions.findIndex((entry, index) => (
        !consumed.has(index)
        && entry.name === name
        && ownership[index].length === 1
        && ownership[index][0] === owner
      ));
      const callable = callableIndex === -1 ? null : structure.functions[callableIndex];
      if (callable) consumed.add(callableIndex);
      else if (!ambiguous.has(name)) warnings.push(`Upstream method ${owner.name}.${name} has no callable detail record`);
      methods.push({
        name,
        ownerName: owner.name,
        lineRange: callable?.lineRange ?? owner.lineRange,
        parameters: (callable?.params ?? []).map((parameter) => ({ name: parameter, type: null })),
        returnType: callable?.returnType ?? null,
        visibility: null,
        async: null,
        exported: exported.has(name) ? true : null,
        static: null
      });
    }
  }
  for (const [name, owners] of [...ambiguous].sort(([left], [right]) => compareText(left, right))) {
    warnings.push(`Upstream ownership is ambiguous for method ${name}: ${[...owners].sort().join(", ")}`);
  }
  const functions = structure.functions
    .filter((_entry, index) => !consumed.has(index))
    .map((entry) => toRawFunction(entry, exported));
  return { methods, functions, warnings };
}

export function createUpstreamAdapter(extractor) {
  return {
    extract(rootNode, { filePath, language }) {
      const structure = extractor.extractStructure(rootNode);
      const calls = extractor.extractCallGraph(rootNode);
      const exported = new Set(structure.exports.map((entry) => entry.name));
      const callables = adaptCallables(structure, exported, language);

      const types = structure.classes.map((entry) => ({
        kind: "class",
        name: entry.name,
        lineRange: entry.lineRange,
        properties: entry.properties.map((name) => ({ name, type: null, visibility: null, static: null, lineRange: null })),
        extends: [],
        implements: [],
        exported: exported.has(entry.name) ? true : null
      }));

      const base = {
        filePath,
        language,
        types,
        methods: callables.methods,
        functions: callables.functions,
        importCandidates: structure.imports.map((entry) => ({ ...entry, kind: "module" })),
        callCandidates: calls.map((entry) => ({
          callerName: entry.caller || null,
          callerOwnerName: null,
          calleeText: entry.callee,
          lineNumber: entry.lineNumber
        })),
        warnings: callables.warnings
      };
      return enrichAnalysis(rootNode, { language, base });
    }
  };
}
