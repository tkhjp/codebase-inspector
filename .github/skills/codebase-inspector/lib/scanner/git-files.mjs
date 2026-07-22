import { isAbsolute, relative, resolve, sep } from "node:path";
import { runGit } from "../runtime/git-command.mjs";
import { normalizeRelativePath } from "./ignore-rules.mjs";

function toRelativePath(root, path) {
  if (typeof path !== "string" || !path) return null;
  const candidate = isAbsolute(path) ? relative(root, path) : path;
  return normalizeRelativePath(candidate.split(sep).join("/"));
}

function statusIsIgnored(path, ignoredPaths) {
  const normalized = normalizeRelativePath(path.replace(/\/+$/, ""));
  return normalized !== null && ignoredPaths.some((ignoredPath) => normalized === ignoredPath || normalized.startsWith(`${ignoredPath}/`));
}

export function isWorkingTreeDirty(statusOutput, ignoredPaths) {
  const entries = statusOutput.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    const renamedOrCopied = /[RC]/.test(status);
    const originalPath = renamedOrCopied ? entries[index + 1] : null;
    if (renamedOrCopied) index += 1;
    if (!statusIsIgnored(path, ignoredPaths) || (originalPath && !statusIsIgnored(originalPath, ignoredPaths))) return true;
  }
  return false;
}

export async function getGitMetadata(targetRoot, { ignoredPaths = [] } = {}) {
  const commandRoot = resolve(targetRoot);
  const [rootOutput, gitDirOutput, commonDirOutput, trackedOutput, commitHashOutput, commitTimestampOutput, statusOutput] = await Promise.all([
    runGit(commandRoot, ["rev-parse", "--show-toplevel"]),
    runGit(commandRoot, ["rev-parse", "--absolute-git-dir"]),
    runGit(commandRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    runGit(commandRoot, ["ls-files", "-z"]),
    runGit(commandRoot, ["rev-parse", "HEAD"]),
    runGit(commandRoot, ["show", "-s", "--format=%cI", "HEAD"]),
    runGit(commandRoot, ["status", "--porcelain=v1", "-z"])
  ]);
  const root = resolve(rootOutput.trim());
  const normalizedIgnoredPaths = ignoredPaths.map((path) => toRelativePath(root, path)).filter(Boolean);

  return {
    root,
    gitDir: resolve(gitDirOutput.trim()),
    commonDir: resolve(commonDirOutput.trim()),
    trackedPaths: trackedOutput.split("\0").filter(Boolean).sort(),
    commitHash: commitHashOutput.trim(),
    commitTimestamp: commitTimestampOutput.trim(),
    dirty: isWorkingTreeDirty(statusOutput, normalizedIgnoredPaths)
  };
}
