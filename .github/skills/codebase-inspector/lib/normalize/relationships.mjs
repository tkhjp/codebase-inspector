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
    unresolvedCalls: 0
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
    for (const candidate of rawCalls) {
      const caller = findCaller(candidate, callables, typeById);
      if (!caller) {
        unresolvedCalls.push({
          callerId: null,
          calleeText: candidate.calleeText,
          filePath: candidate.filePath,
          lineNumber: candidate.lineNumber,
          reason: "caller-not-found"
        });
        relationshipCounts.unresolvedCalls += 1;
        continue;
      }

      if (isDynamicCall(candidate.calleeText)) {
        unresolvedCalls.push({
          callerId: caller.id,
          calleeText: candidate.calleeText,
          filePath: candidate.filePath,
          lineNumber: candidate.lineNumber,
          reason: "dynamic-call"
        });
        relationshipCounts.unresolvedCalls += 1;
        continue;
      }

      const callees = callableByName.get(candidate.calleeText) ?? [];
      if (callees.length !== 1) {
        unresolvedCalls.push({
          callerId: caller.id,
          calleeText: candidate.calleeText,
          filePath: candidate.filePath,
          lineNumber: candidate.lineNumber,
          reason: unresolvedReason(candidate.calleeText, callees)
        });
        relationshipCounts.unresolvedCalls += 1;
        continue;
      }

      calls.push({
        callerId: caller.id,
        calleeId: callees[0].id,
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
