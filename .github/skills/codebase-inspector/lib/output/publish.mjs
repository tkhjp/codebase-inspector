import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import { resolveOutputBoundary } from "../runtime/path-boundary.mjs";
import { parseAnalysisReport } from "../schema/analysis-report.mjs";
import { parseCodeGraph } from "../schema/code-graph.mjs";
import { parseSymbolIndex } from "../schema/symbol-index.mjs";

const execFile = promisify(execFileCallback);
const artifactNames = Object.freeze([
  "analysis-report.json",
  "classes.md",
  "code-graph.json",
  "functions.md",
  "methods.md",
  "symbol-index.json"
]);
const beginMarker = "# BEGIN Codebase Inspector";
const endMarker = "# END Codebase Inspector";
const beginMarkerBytes = Buffer.from(beginMarker, "ascii");
const endMarkerBytes = Buffer.from(endMarker, "ascii");
const lineFeed = Buffer.from([0x0a]);
const jsonValidators = new Map([
  ["analysis-report.json", parseAnalysisReport],
  ["code-graph.json", parseCodeGraph],
  ["symbol-index.json", parseSymbolIndex]
]);

function validateArtifacts(artifacts) {
  if (!(artifacts instanceof Map)) throw new Error("Artifacts must be a Map");
  const names = [...artifacts.keys()].sort();
  if (JSON.stringify(names) !== JSON.stringify(artifactNames)) {
    throw new Error(`Artifacts must contain exactly: ${artifactNames.join(", ")}`);
  }
  for (const [name, content] of artifacts) {
    if (typeof content !== "string" || content.includes("\r")) {
      throw new Error(`Artifact ${name} must be LF-normalized text`);
    }
    const validate = jsonValidators.get(name);
    if (validate) {
      try {
        validate(JSON.parse(content));
      } catch {
        throw new Error(`Artifact ${name} is not schema-valid JSON`);
      }
    }
  }
}

function byteLines(bytes) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    const contentEnd = index > start && bytes[index - 1] === 0x0d ? index - 1 : index;
    lines.push({ content: bytes.subarray(start, contentEnd), raw: bytes.subarray(start, index + 1) });
    start = index + 1;
  }
  if (start < bytes.length) lines.push({ content: bytes.subarray(start), raw: bytes.subarray(start) });
  return lines;
}

function isOwnedBodyLine(content) {
  if (content.length < 2 || content[0] === 0x2f || content.at(-1) !== 0x2f) return false;
  let segmentStart = 0;
  for (let index = 0; index < content.length; index += 1) {
    const byte = content[index];
    if (byte < 0x20 || byte > 0x7e) return false;
    if (byte !== 0x2f) continue;
    if (index - segmentStart === 2 && content[segmentStart] === 0x2e && content[segmentStart + 1] === 0x2e) return false;
    segmentStart = index + 1;
  }
  return true;
}

function removeOwnedBlocks(bytes) {
  const lines = byteLines(bytes);
  const retained = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].content.equals(beginMarkerBytes)
      && lines[index + 1]?.content
      && isOwnedBodyLine(lines[index + 1].content)
      && lines[index + 2]?.content.equals(endMarkerBytes)) {
      index += 2;
      continue;
    }
    retained.push(lines[index].raw);
  }
  return Buffer.concat(retained);
}

async function gitPublicationPaths(targetRoot) {
  const [gitDirResult, excludeResult] = await Promise.all([
    execFile("git", ["-C", targetRoot, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }),
    execFile("git", ["-C", targetRoot, "rev-parse", "--git-path", "info/exclude"], { encoding: "utf8" })
  ]);
  const excludePath = excludeResult.stdout.trim();
  return {
    gitDir: gitDirResult.stdout.trim(),
    excludePath: isAbsolute(excludePath) ? excludePath : join(targetRoot, excludePath)
  };
}

async function captureFile(path, fsOps) {
  try {
    return { exists: true, bytes: Buffer.from(await fsOps.readFile(path)) };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, bytes: Buffer.alloc(0) };
    throw error;
  }
}

function desiredExclude(snapshot, targetRoot, outputPath, tracked) {
  const retained = removeOwnedBlocks(snapshot.bytes);
  let bytes = retained;
  if (!tracked) {
    const outputRelativePath = relative(targetRoot, outputPath).split("\\").join("/");
    const separator = retained.length > 0 && retained.at(-1) !== 0x0a ? lineFeed : Buffer.alloc(0);
    const block = Buffer.from(`${beginMarker}\n${outputRelativePath.replace(/\/+$/, "")}/\n${endMarker}\n`, "utf8");
    bytes = Buffer.concat([retained, separator, block]);
  }
  return { bytes, changed: !snapshot.bytes.equals(bytes) };
}

async function pathExists(path, fsOps) {
  try {
    await fsOps.lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function attempt(errors, action) {
  try {
    await action();
    return true;
  } catch (error) {
    errors.push(error);
    return false;
  }
}

function throwFailures(primaryError, cleanupErrors, committed) {
  if (primaryError && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], "Publication failed and cleanup also failed");
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) {
    const message = committed ? "Publication committed with cleanup failures" : "Publication cleanup failed";
    throw new AggregateError(cleanupErrors, message);
  }
}

export async function publishArtifacts({ targetRoot, outputPath, artifacts, tracked, fsOps = fs }) {
  validateArtifacts(artifacts);
  const gitPaths = await gitPublicationPaths(targetRoot);
  const boundary = await resolveOutputBoundary({
    targetRoot,
    outputPath,
    gitDir: gitPaths.gitDir,
    fsOps
  });
  targetRoot = boundary.targetRoot;
  outputPath = boundary.outputPath;

  const token = randomUUID();
  const outputParent = dirname(outputPath);
  const outputName = basename(outputPath);
  const temporaryPath = join(outputParent, `${outputName}.tmp-${token}`);
  const backupPath = join(outputParent, `${outputName}.backup-${token}`);
  const excludeTemporaryPath = `${gitPaths.excludePath}.tmp-${token}`;
  const excludeRestorePath = `${gitPaths.excludePath}.restore-${token}`;
  let excludeSnapshot;
  let excludeUpdate;
  let excludeMutationAttempted = false;
  let backupCreated = false;
  let committed = false;
  let primaryError;

  try {
    excludeSnapshot = await captureFile(gitPaths.excludePath, fsOps);
    excludeUpdate = desiredExclude(excludeSnapshot, targetRoot, outputPath, tracked);
    await fsOps.mkdir(outputParent, { recursive: true });
    await fsOps.mkdir(temporaryPath);
    for (const name of artifactNames) {
      await fsOps.writeFile(join(temporaryPath, name), artifacts.get(name), "utf8");
    }

    if (excludeUpdate.changed) {
      excludeMutationAttempted = true;
      await fsOps.mkdir(dirname(gitPaths.excludePath), { recursive: true });
      await fsOps.writeFile(excludeTemporaryPath, excludeUpdate.bytes);
      await fsOps.rename(excludeTemporaryPath, gitPaths.excludePath);
    }

    if (await pathExists(outputPath, fsOps)) {
      await fsOps.rename(outputPath, backupPath);
      backupCreated = true;
    }
    await fsOps.rename(temporaryPath, outputPath);
    committed = true;
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = [];
  if (committed) {
    if (backupCreated) {
      const removed = await attempt(cleanupErrors, () => fsOps.rm(backupPath, { recursive: true, force: true }));
      if (removed) backupCreated = false;
    }
  } else {
    if (backupCreated) {
      const restored = await attempt(cleanupErrors, () => fsOps.rename(backupPath, outputPath));
      if (restored) backupCreated = false;
    }
    if (excludeMutationAttempted) {
      if (excludeSnapshot.exists) {
        await attempt(cleanupErrors, async () => {
          await fsOps.writeFile(excludeRestorePath, excludeSnapshot.bytes);
          await fsOps.rename(excludeRestorePath, gitPaths.excludePath);
        });
      } else {
        await attempt(cleanupErrors, () => fsOps.rm(gitPaths.excludePath, { force: true }));
      }
    }
  }

  await attempt(cleanupErrors, () => fsOps.rm(temporaryPath, { recursive: true, force: true }));
  await attempt(cleanupErrors, () => fsOps.rm(excludeTemporaryPath, { force: true }));
  await attempt(cleanupErrors, () => fsOps.rm(excludeRestorePath, { force: true }));
  if (!backupCreated) await attempt(cleanupErrors, () => fsOps.rm(backupPath, { recursive: true, force: true }));

  throwFailures(primaryError, cleanupErrors, committed);
}
