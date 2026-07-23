import { posix } from "node:path";

const extensions = ["", ".js", ".jsx", ".ts", ".tsx", ".py", ".rs", ".go", ".java", ".kt", ".cs", ".c", ".h", ".cpp", ".hpp", ".php", ".rb", ".dart"];
const indexNames = extensions.filter(Boolean).map((extension) => `/index${extension}`);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRecords(fields) {
  return (left, right) => {
    for (const field of fields) {
      const leftValue = left[field] ?? "";
      const rightValue = right[field] ?? "";
      if (leftValue === rightValue) continue;
      if (typeof leftValue === "number" && typeof rightValue === "number") return leftValue - rightValue;
      return compareText(String(leftValue), String(rightValue));
    }
    return 0;
  };
}

function relativeImportCandidates(sourceFilePath, source) {
  const base = posix.normalize(posix.join(posix.dirname(sourceFilePath), source));
  return [...extensions.map((extension) => `${base}${extension}`), ...indexNames.map((name) => `${base}${name}`)];
}

function isRelativeImport(source) {
  return source.startsWith("./") || source.startsWith("../");
}

function ownerName(method, typeById) {
  return typeById.get(method.ownerTypeId)?.name ?? null;
}

function findCaller(candidate, callables, typeById) {
  if (candidate.callerName === null) return null;
  const matches = callables.filter((callable) => {
    if (callable.filePath !== candidate.filePath || callable.name !== candidate.callerName) return false;
    if (candidate.callerOwnerName === null) return true;
    return "ownerTypeId" in callable && ownerName(callable, typeById) === candidate.callerOwnerName;
  });
  return matches.length === 1 ? matches[0] : null;
}

function unresolvedReason(calleeText, callees) {
  if (callees.length > 1) return "ambiguous-callee";
  if (/[.[\]]|::|->/.test(calleeText)) return "dynamic-call";
  return "callee-not-found";
}

function isDynamicCall(calleeText) {
  return calleeText.includes(".") || calleeText.includes("::") || calleeText.includes("->");
}

function simpleCalleeName(calleeText) {
  return calleeText.split(/\.|::|->/).filter(Boolean).at(-1) ?? calleeText;
}

function importedTargetPaths(sourceFileId, imports, filesByPath) {
  const pathByFileId = new Map([...filesByPath.values()].map((file) => [file.id, file.path]));
  return new Set(imports
    .filter((record) => record.sourceFileId === sourceFileId)
    .map((record) => pathByFileId.get(record.targetFileId))
    .filter(Boolean));
}

function narrowCallees({ candidates, caller, candidate, typeById, importedPaths, restrictedPaths }) {
  let narrowed = candidates;
  if (restrictedPaths) {
    narrowed = narrowed.filter((callee) => restrictedPaths.has(callee.filePath));
  } else if ("ownerTypeId" in caller) {
    const sameOwner = narrowed.filter((callee) => "ownerTypeId" in callee && callee.ownerTypeId === caller.ownerTypeId);
    if (sameOwner.length > 0) narrowed = sameOwner;
  }
  if (!restrictedPaths) {
    const sameFile = narrowed.filter((callee) => callee.filePath === caller.filePath);
    if (sameFile.length > 0) narrowed = sameFile;
    else {
      const imported = narrowed.filter((callee) => importedPaths.has(callee.filePath));
      if (imported.length > 0) narrowed = imported;
    }
  }
  if (candidate.argumentCount !== null && candidate.argumentCount !== undefined) {
    const sameArity = narrowed.filter((callee) => callee.parameters.length === candidate.argumentCount);
    if (sameArity.length > 0) narrowed = sameArity;
  }
  if (candidate.callerOwnerName) {
    const ownerScoped = narrowed.filter((callee) => "ownerTypeId" in callee && ownerName(callee, typeById) === candidate.callerOwnerName);
    if (ownerScoped.length > 0) narrowed = ownerScoped;
  }
  return narrowed;
}

function importedBindings(sourceFileId, analysis, imports, filesByPath) {
  const pathByFileId = new Map([...filesByPath.values()].map((file) => [file.id, file.path]));
  const bindings = new Map();
  for (const candidate of analysis.importCandidates) {
    const paths = new Set(imports
      .filter((record) => (
        record.sourceFileId === sourceFileId
        && record.source === candidate.source
        && record.lineNumber === candidate.lineNumber
      ))
      .map((record) => pathByFileId.get(record.targetFileId))
      .filter(Boolean));
    if (paths.size === 0) continue;
    for (const specifier of candidate.specifiers) {
      const namespace = specifier.match(/^\*\s+as\s+(.+)$/);
      const aliased = specifier.match(/^(.+?)\s+as\s+(.+)$/);
      const importedName = namespace ? "*" : (aliased?.[1] ?? specifier).trim();
      const localName = (namespace?.[1] ?? aliased?.[2] ?? specifier).trim();
      if (!localName) continue;
      const entries = bindings.get(localName) ?? [];
      entries.push({ importedName, namespace: Boolean(namespace), paths });
      bindings.set(localName, entries);
    }
  }
  return bindings;
}

function resolveImportedBinding(calleeText, bindings) {
  const parts = calleeText.split(".");
  const namespace = parts.length === 2 ? bindings.get(parts[0])?.filter((entry) => entry.namespace) ?? [] : [];
  const direct = parts.length === 1 ? bindings.get(calleeText)?.filter((entry) => !entry.namespace) ?? [] : [];
  const entries = namespace.length > 0 ? namespace : direct;
  if (entries.length !== 1) return null;
  return {
    importedName: entries[0].namespace ? parts[1] : entries[0].importedName,
    namespace: entries[0].namespace,
    paths: entries[0].paths
  };
}

export function resolveRelationships(indexDraft, rawAnalyses, resolvedImportsByPath = new Map()) {
  const filesByPath = new Map(indexDraft.files.map((file) => [file.path, file]));
  const typeById = new Map(indexDraft.types.map((type) => [type.id, type]));
  const callables = [...indexDraft.methods, ...indexDraft.functions];
  const callableByName = new Map();
  for (const callable of callables) {
    const matches = callableByName.get(callable.name) ?? [];
    matches.push(callable);
    callableByName.set(callable.name, matches);
  }

  const imports = [];
  const calls = [];
  const unresolvedCalls = [];
  const relationshipCounts = {
    internalImports: 0,
    externalImports: 0,
    unresolvedImports: 0,
    resolvedCalls: 0,
    unresolvedCalls: 0,
    ambiguousCalls: 0,
    dynamicCalls: 0
  };

  const analyses = [...rawAnalyses].sort(compareRecords(["filePath"]));
  for (const analysis of analyses) {
    const sourceFile = filesByPath.get(analysis.filePath);
    if (!sourceFile) continue;

    const importCandidates = [...analysis.importCandidates].sort(compareRecords(["lineNumber", "source", "kind"]));
    const upstreamResolved = resolvedImportsByPath.get(analysis.filePath);
    if (upstreamResolved) {
      const resolvedCandidateKeys = new Set();
      for (const resolved of upstreamResolved) {
        const targetFile = filesByPath.get(resolved.targetPath);
        if (!targetFile) continue;
        imports.push({
          sourceFileId: sourceFile.id,
          targetFileId: targetFile.id,
          source: resolved.source,
          lineNumber: resolved.lineNumber
        });
        resolvedCandidateKeys.add(`${resolved.lineNumber}\0${resolved.source}`);
        relationshipCounts.internalImports += 1;
      }
      for (const candidate of importCandidates) {
        if (!resolvedCandidateKeys.has(`${candidate.lineNumber}\0${candidate.source}`)) {
          relationshipCounts.externalImports += 1;
        }
      }
    } else {
      for (const candidate of importCandidates) {
        if (!isRelativeImport(candidate.source)) {
          relationshipCounts.externalImports += 1;
          continue;
        }

        const trackedMatches = [...new Set(relativeImportCandidates(analysis.filePath, candidate.source))]
          .map((path) => filesByPath.get(path))
          .filter(Boolean);
        if (trackedMatches.length !== 1) {
          relationshipCounts.unresolvedImports += 1;
          continue;
        }

        imports.push({
          sourceFileId: sourceFile.id,
          targetFileId: trackedMatches[0].id,
          source: candidate.source,
          lineNumber: candidate.lineNumber
        });
        relationshipCounts.internalImports += 1;
      }
    }

    const rawCalls = analysis.callCandidates.map((candidate) => ({ ...candidate, filePath: analysis.filePath }));
    rawCalls.sort(compareRecords(["lineNumber", "callerOwnerName", "callerName", "calleeText"]));
    const bindings = importedBindings(sourceFile.id, analysis, imports, filesByPath);
    for (const candidate of rawCalls) {
      const caller = findCaller(candidate, callables, typeById);
      if (!caller) {
        unresolvedCalls.push({
          callerId: null,
          calleeText: candidate.calleeText,
          filePath: candidate.filePath,
          lineNumber: candidate.lineNumber,
          reason: "caller-not-found",
          candidateIds: []
        });
        relationshipCounts.unresolvedCalls += 1;
        continue;
      }

      const binding = resolveImportedBinding(candidate.calleeText, bindings);
      const name = binding?.importedName ?? simpleCalleeName(candidate.calleeText);
      const sourceFile = filesByPath.get(candidate.filePath);
      const importedPaths = importedTargetPaths(sourceFile.id, imports, filesByPath);
      const candidates = narrowCallees({
        candidates: callableByName.get(name) ?? [],
        caller,
        candidate,
        typeById,
        importedPaths,
        restrictedPaths: binding?.paths ?? null
      });

      if (isDynamicCall(candidate.calleeText) && !binding?.namespace) {
        unresolvedCalls.push({
          callerId: caller.id,
          calleeText: candidate.calleeText,
          filePath: candidate.filePath,
          lineNumber: candidate.lineNumber,
          reason: "dynamic-call",
          candidateIds: candidates.map((callee) => callee.id).sort(compareText)
        });
        relationshipCounts.unresolvedCalls += 1;
        relationshipCounts.dynamicCalls += 1;
        continue;
      }

      if (candidates.length !== 1) {
        const reason = unresolvedReason(candidate.calleeText, candidates);
        unresolvedCalls.push({
          callerId: caller.id,
          calleeText: candidate.calleeText,
          filePath: candidate.filePath,
          lineNumber: candidate.lineNumber,
          reason,
          candidateIds: candidates.map((callee) => callee.id).sort(compareText)
        });
        relationshipCounts.unresolvedCalls += 1;
        if (reason === "ambiguous-callee") relationshipCounts.ambiguousCalls += 1;
        continue;
      }

      calls.push({
        callerId: caller.id,
        calleeId: candidates[0].id,
        filePath: candidate.filePath,
        lineNumber: candidate.lineNumber
      });
      relationshipCounts.resolvedCalls += 1;
    }
  }

  imports.sort(compareRecords(["sourceFileId", "lineNumber", "source", "targetFileId"]));
  calls.sort(compareRecords(["filePath", "lineNumber", "callerId", "calleeId"]));
  unresolvedCalls.sort(compareRecords(["filePath", "lineNumber", "callerId", "calleeText", "reason"]));
  return { imports, calls, unresolvedCalls, relationshipCounts };
}
