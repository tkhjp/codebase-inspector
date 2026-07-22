import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
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
const jsonValidators = new Map([
  ["analysis-report.json", parseAnalysisReport],
  ["code-graph.json", parseCodeGraph],
  ["symbol-index.json", parseSymbolIndex]
]);

function isWithin(root, candidate, { allowRoot = true } = {}) {
  const difference = relative(root, candidate);
  return (allowRoot && difference === "")
    || (difference !== "" && !difference.startsWith("..") && !isAbsolute(difference));
}

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

function ownedBlock(outputRelativePath) {
  return `${beginMarker}\n${outputRelativePath.replace(/\/+$/, "")}/\n${endMarker}`;
}

function removeOwnedBlocks(content) {
  const lines = content.split("\n");
  const retained = [];
  for (let index = 0; index < lines.length; index += 1) {
    const body = lines[index + 1];
    if (lines[index] === beginMarker
      && typeof body === "string"
      && /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\n]+\/$/.test(body)
      && lines[index + 2] === endMarker) {
      index += 2;
      continue;
    }
    retained.push(lines[index]);
  }
  return retained.join("\n");
}

async function gitExcludePath(targetRoot) {
  const { stdout } = await execFile("git", ["-C", targetRoot, "rev-parse", "--git-path", "info/exclude"], { encoding: "utf8" });
  const path = stdout.trim();
  return isAbsolute(path) ? path : join(targetRoot, path);
}

async function updateLocalExclude({ targetRoot, outputPath, tracked, fsOps, token }) {
  const excludePath = await gitExcludePath(targetRoot);
  let current = "";
  try {
    current = await fsOps.readFile(excludePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  let updated = removeOwnedBlocks(current);
  if (!tracked) {
    const outputRelativePath = relative(targetRoot, outputPath).split("\\").join("/");
    const separator = updated.length > 0 && !updated.endsWith("\n") ? "\n" : "";
    updated = `${updated}${separator}${ownedBlock(outputRelativePath)}\n`;
  }
  if (updated === current) return;

  await fsOps.mkdir(dirname(excludePath), { recursive: true });
  const temporaryPath = `${excludePath}.tmp-${token}`;
  await fsOps.writeFile(temporaryPath, updated, "utf8");
  try {
    await fsOps.rename(temporaryPath, excludePath);
  } finally {
    await fsOps.rm(temporaryPath, { force: true });
  }
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

export async function publishArtifacts({ targetRoot, outputPath, artifacts, tracked, fsOps = fs }) {
  if (!isWithin(targetRoot, outputPath, { allowRoot: false })) {
    throw new Error("Output path must stay inside target root");
  }
  validateArtifacts(artifacts);

  const token = randomUUID();
  const outputParent = dirname(outputPath);
  const outputName = basename(outputPath);
  const temporaryPath = join(outputParent, `${outputName}.tmp-${token}`);
  const backupPath = join(outputParent, `${outputName}.backup-${token}`);
  let backupCreated = false;
  let outputPublished = false;

  await fsOps.mkdir(outputParent, { recursive: true });
  await fsOps.mkdir(temporaryPath);
  try {
    await Promise.all(artifactNames.map((name) => fsOps.writeFile(join(temporaryPath, name), artifacts.get(name), "utf8")));
    await updateLocalExclude({ targetRoot, outputPath, tracked, fsOps, token });

    if (await pathExists(outputPath, fsOps)) {
      await fsOps.rename(outputPath, backupPath);
      backupCreated = true;
    }
    await fsOps.rename(temporaryPath, outputPath);
    outputPublished = true;

    if (backupCreated) {
      await fsOps.rm(backupPath, { recursive: true, force: true });
      backupCreated = false;
    }
  } catch (error) {
    if (backupCreated) {
      try {
        if (outputPublished) await fsOps.rm(outputPath, { recursive: true, force: true });
        await fsOps.rename(backupPath, outputPath);
        backupCreated = false;
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], "Publication failed and prior output could not be restored");
      }
    }
    throw error;
  } finally {
    await fsOps.rm(temporaryPath, { recursive: true, force: true });
    if (!backupCreated) await fsOps.rm(backupPath, { recursive: true, force: true });
  }
}
