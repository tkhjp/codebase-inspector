import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { getGitMetadata } from "../scanner/git-files.mjs";
import { nearestExistingPath, resolveOutputBoundary } from "./path-boundary.mjs";

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

  const boundary = await resolveOutputBoundary({
    targetRoot: await realpath(git.root),
    outputPath: resolve(git.root, options.output),
    gitDir: await realpath(git.gitDir)
  });
  const { targetRoot, outputPath, gitDir } = boundary;
  const outputParent = await nearestExistingPath(dirname(outputPath));
  await access(outputParent.realPath, constants.W_OK);

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
