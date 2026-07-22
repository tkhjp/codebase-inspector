import * as fs from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export function isPathWithin(root, candidate, { allowRoot = true } = {}) {
  const difference = relative(root, candidate);
  const escapesThroughParent = difference === ".." || difference.startsWith(`..${sep}`);
  return (allowRoot && difference === "")
    || (difference !== "" && !escapesThroughParent && !isAbsolute(difference));
}

export async function nearestExistingPath(path, fsOps = fs) {
  let candidate = path;
  for (;;) {
    try {
      return { path: candidate, realPath: await fsOps.realpath(candidate) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

export async function resolveOutputBoundary({ targetRoot, outputPath, gitDir, gitCommonDir = gitDir, fsOps = fs }) {
  const lexicalRoot = resolve(targetRoot);
  const lexicalOutput = resolve(outputPath);
  if (!isPathWithin(lexicalRoot, lexicalOutput, { allowRoot: false })) {
    throw new Error("Output path must stay inside target root and must not equal it");
  }

  const [canonicalRoot, canonicalGitDir, canonicalGitCommonDir, existing] = await Promise.all([
    fsOps.realpath(lexicalRoot),
    fsOps.realpath(resolve(gitDir)),
    fsOps.realpath(resolve(gitCommonDir)),
    nearestExistingPath(lexicalOutput, fsOps)
  ]);
  const canonicalOutput = resolve(existing.realPath, relative(existing.path, lexicalOutput));
  if (!isPathWithin(canonicalRoot, canonicalOutput, { allowRoot: false })) {
    throw new Error("Output path must stay inside target root and must not equal it");
  }
  if (isPathWithin(canonicalGitDir, canonicalOutput)) {
    throw new Error("Output path must not be inside the Git directory");
  }
  if (isPathWithin(canonicalGitCommonDir, canonicalOutput)) {
    throw new Error("Output path must not be inside the Git directory");
  }

  return { targetRoot: canonicalRoot, outputPath: canonicalOutput, gitDir: canonicalGitDir, gitCommonDir: canonicalGitCommonDir };
}
