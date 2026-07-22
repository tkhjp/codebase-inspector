import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { getGitMetadata } from "../scanner/git-files.mjs";

function isWithin(root, candidate, { allowRoot = true } = {}) {
  const difference = relative(root, candidate);
  return (allowRoot && difference === "")
    || (difference !== "" && !difference.startsWith("..") && !isAbsolute(difference));
}

async function nearestExistingParent(path) {
  let candidate = path;
  for (;;) {
    try {
      return await realpath(candidate);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

function normalizedOutput(targetRoot, outputPath) {
  return relative(targetRoot, outputPath).split(sep).join("/");
}

export async function preflight(options, skillDir) {
  let targetPath;
  let git;
  try {
    targetPath = await realpath(resolve(options.targetPath));
    git = await getGitMetadata(targetPath);
  } catch (error) {
    if (error.code === "ENOENT" && error.path === "git") throw new Error("Git is required");
    throw new Error(`Target must be inside a Git repository: ${error.message}`);
  }

  const targetRoot = await realpath(git.root);
  const gitDir = await realpath(git.gitDir);
  const outputPath = resolve(targetRoot, options.output);
  if (!isWithin(targetRoot, outputPath, { allowRoot: false })) {
    throw new Error("Output path must stay inside target root");
  }
  if (isWithin(gitDir, outputPath)) throw new Error("Output path must not be inside the Git directory");

  const outputParent = await nearestExistingParent(outputPath);
  if (!isWithin(targetRoot, outputParent)) throw new Error("Output path must stay inside target root");
  await access(outputParent, constants.W_OK);

  const output = normalizedOutput(targetRoot, outputPath);
  return {
    skillDir: resolve(skillDir),
    targetRoot,
    outputPath,
    gitDir,
    gitCommitHash: git.commitHash,
    gitCommitTimestamp: git.commitTimestamp,
    options: {
      tracked: Boolean(options.tracked),
      output,
      keepIntermediate: Boolean(options.keepIntermediate)
    }
  };
}
