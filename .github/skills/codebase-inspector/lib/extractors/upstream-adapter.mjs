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

function ownershipWarnings(structure) {
  const ownersByMethod = new Map();
  for (const owner of structure.classes) {
    for (const method of owner.methods) {
      const owners = ownersByMethod.get(method) ?? [];
      owners.push(owner.name);
      ownersByMethod.set(method, owners);
    }
  }
  return [...ownersByMethod]
    .filter(([method, owners]) => owners.length > 1 || !structure.functions.some((entry) => entry.name === method))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([method, owners]) => owners.length > 1
      ? `Upstream ownership is ambiguous for method ${method}: ${owners.sort().join(", ")}`
      : `Upstream method ${owners[0]}.${method} has no callable detail record`);
}

export function createUpstreamAdapter(extractor) {
  return {
    extract(rootNode, { filePath, language }) {
      const structure = extractor.extractStructure(rootNode);
      const calls = extractor.extractCallGraph(rootNode);
      const exported = new Set(structure.exports.map((entry) => entry.name));
      const ownedNames = new Set(structure.classes.flatMap((entry) => entry.methods));

      const types = structure.classes.map((entry) => ({
        kind: "class",
        name: entry.name,
        lineRange: entry.lineRange,
        properties: entry.properties.map((name) => ({ name, type: null, visibility: null, static: null, lineRange: null })),
        extends: [],
        implements: [],
        exported: exported.has(entry.name) ? true : null
      }));

      const methods = [];
      for (const owner of structure.classes) {
        for (const name of owner.methods) {
          const callable = structure.functions.find((entry) => entry.name === name);
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

      return {
        filePath,
        language,
        types,
        methods,
        functions: structure.functions.filter((entry) => !ownedNames.has(entry.name)).map((entry) => toRawFunction(entry, exported)),
        importCandidates: structure.imports.map((entry) => ({ ...entry, kind: "module" })),
        callCandidates: calls.map((entry) => ({
          callerName: entry.caller || null,
          callerOwnerName: null,
          calleeText: entry.callee,
          lineNumber: entry.lineNumber
        })),
        warnings: ownershipWarnings(structure)
      };
    }
  };
}
