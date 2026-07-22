import * as fs from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { classifyFile, detectLanguage } from "./languages.mjs";
import { createIgnoreMatcher, normalizeRelativePath } from "./ignore-rules.mjs";
import { getGitMetadata } from "./git-files.mjs";

function isWithinRoot(root, path) {
  const difference = relative(root, path);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

function normalizedText(buffer) {
  return Buffer.from(buffer).toString("utf8").replace(/\r\n?/g, "\n");
}

function lineCount(text) {
  return text === "" ? 0 : text.split("\n").length;
}

function warningFor(path, message) {
  return `Skipped ${path}: ${message}`;
}

export async function scanProject(runConfig, { fsOps = fs } = {}) {
  const targetRoot = await fsOps.realpath(resolve(runConfig.targetRoot));
  const output = runConfig.options?.output ?? ".code-understanding";
  const outputPath = resolve(targetRoot, output);
  const git = await getGitMetadata(targetRoot, { ignoredPaths: [outputPath] });
  const rootRealPath = await fsOps.realpath(git.root);
  const warnings = [];
  const shouldIgnore = await createIgnoreMatcher(rootRealPath, outputPath, fsOps, warnings);
  const files = [];
  const unsupportedFiles = [];

  for (const trackedPath of git.trackedPaths) {
    const path = normalizeRelativePath(trackedPath);
    if (!path) continue;
    if (path.includes("\\")) {
      warnings.push(warningFor(path, "literal backslash is not representable in generated paths"));
      continue;
    }
    if (shouldIgnore(path)) continue;

    const workingPath = resolve(git.root, path);
    if (!isWithinRoot(git.root, workingPath)) {
      warnings.push(warningFor(path, "path escapes repository boundary"));
      continue;
    }

    let stat;
    try {
      stat = await fsOps.lstat(workingPath);
    } catch (error) {
      warnings.push(warningFor(path, `could not lstat working-tree file (${error.code ?? error.message})`));
      continue;
    }

    if (!stat.isSymbolicLink() && !stat.isFile()) {
      warnings.push(warningFor(path, "working-tree entry is not a regular file"));
      continue;
    }

    let resolvedPath;
    try {
      resolvedPath = await fsOps.realpath(workingPath);
    } catch (error) {
      warnings.push(warningFor(path, `symlink could not be resolved (${error.code ?? error.message})`));
      continue;
    }
    if (!isWithinRoot(rootRealPath, resolvedPath)) {
      warnings.push(warningFor(path, "symlink escapes repository boundary"));
      continue;
    }
    try {
      const resolvedStat = await fsOps.lstat(resolvedPath);
      if (!resolvedStat.isFile()) {
        warnings.push(warningFor(path, "symlink target is not a regular file"));
        continue;
      }
    } catch (error) {
      warnings.push(warningFor(path, `symlink target could not be read (${error.code ?? error.message})`));
      continue;
    }

    let bytes;
    try {
      bytes = await fsOps.readFile(resolvedPath);
    } catch (error) {
      warnings.push(warningFor(path, `could not read working-tree file (${error.code ?? error.message})`));
      continue;
    }
    const buffer = Buffer.from(bytes);
    if (buffer.includes(0)) continue;

    const text = normalizedText(buffer);
    const metadata = { path, lineCount: lineCount(text), bytes: buffer.length };
    const language = detectLanguage(path);
    if (!language) {
      unsupportedFiles.push({ ...metadata, language: "unknown", category: "unsupported" });
      continue;
    }
    files.push({ ...metadata, language, category: classifyFile(path), content: text });
  }

  return { files, unsupportedFiles, warnings, git };
}
