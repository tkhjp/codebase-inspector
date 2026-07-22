import { resolve } from "node:path";
import { buildRelease } from "../../scripts/package-release.mjs";

const [, , sourceRoot, repositoryRoot, outputPath] = process.argv;

await buildRelease({
  sourceRoot: resolve(sourceRoot),
  repositoryRoot: resolve(repositoryRoot),
  outputPath: resolve(outputPath)
});
