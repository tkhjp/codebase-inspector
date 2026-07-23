import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { processInvocation } from "./setup.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDir = resolve(skillDir, "../../..");
const archiveName = "codebase-inspector-0.1.0.zip";
const bundledArchiveName = "codebase-inspector-0.1.0-with-dependencies.zip";
const fixedDosTimestamp = 0x00210000;
const skillArchivePrefix = ".github/skills/codebase-inspector";
const defaultMaximumBundledArchiveBytes = 100_000_000;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const lowerName = entry.name.toLowerCase();
    if (lowerName.endsWith(".tmp") || lowerName.endsWith(".bak")) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(path);
    if (entry.isFile()) return [path];
    return [];
  }));
  return files.flat();
}

function archivePath(path, sourceRoot) {
  return relative(sourceRoot, path).split(sep).join("/");
}

function skillArchivePath(relativePath) {
  return `${skillArchivePrefix}/${relativePath}`;
}

function runtimeMarker(packageLock) {
  return Buffer.from(JSON.stringify({
    formatVersion: 1,
    packageLockSha256: createHash("sha256").update(packageLock).digest("hex")
  }));
}

export async function runNpmCi(stagingRoot, args) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const invocation = processInvocation(npm, args);
  await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: stagingRoot,
      stdio: "inherit",
      shell: false
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(" ")} failed with exit code ${code ?? 1}`));
    });
  });
}

export async function buildRelease({
  sourceRoot = skillDir,
  repositoryRoot = repositoryDir,
  dependencyRoot,
  maximumBundledArchiveBytes = defaultMaximumBundledArchiveBytes,
  outputPath = resolve(sourceRoot, archiveName)
} = {}) {
  const relativeFiles = [
    "SKILL.md",
    "README.ja.md",
    "THIRD_PARTY_LICENSES.json",
    "package-lock.json",
    "package.json"
  ].map((path) => resolve(sourceRoot, path));
  const files = [
    ...relativeFiles,
    ...(await collectFiles(resolve(sourceRoot, "lib"))),
    ...(await collectFiles(resolve(sourceRoot, "vendor"))),
    resolve(sourceRoot, "scripts/run.mjs"),
    resolve(sourceRoot, "scripts/setup.mjs"),
    resolve(sourceRoot, "scripts/verify-release-archives.mjs")
  ];
  const dependencyFiles = dependencyRoot
    ? await collectFiles(resolve(dependencyRoot, "node_modules"))
    : [];
  const entries = [
    ...files.map((path) => ({ path, name: skillArchivePath(archivePath(path, sourceRoot)) })),
    { path: resolve(repositoryRoot, "LICENSE"), name: skillArchivePath("LICENSE") },
    { path: resolve(repositoryRoot, "NOTICE"), name: skillArchivePath("NOTICE") },
    ...dependencyFiles.map((path) => ({
      path,
      name: skillArchivePath(`node_modules/${archivePath(path, resolve(dependencyRoot, "node_modules"))}`)
    })),
    ...(dependencyRoot ? [{
      data: runtimeMarker(await readFile(resolve(sourceRoot, "package-lock.json"))),
      name: skillArchivePath(".codebase-inspector-runtime.json")
    }] : [])
  ].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  const archive = new AdmZip({ noSort: true });
  for (const entry of entries) {
    archive.addFile(entry.name, entry.data ?? await readFile(entry.path), "", 0o644);
    const zipEntry = archive.getEntry(entry.name);
    zipEntry.header.timeval = fixedDosTimestamp;
    zipEntry.header.made = 0x0314;
  }
  const archiveContents = archive.toBuffer();
  if (dependencyRoot && archiveContents.byteLength >= maximumBundledArchiveBytes) {
    throw new Error(`Bundled release archive must be smaller than ${maximumBundledArchiveBytes} bytes`);
  }
  await writeFile(outputPath, archiveContents);
  return outputPath;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function publishArchivePair(archives, movePublishedFile) {
  const backedUp = [];
  const published = [];

  try {
    for (const archive of archives) {
      if (await exists(archive.finalPath)) {
        await movePublishedFile(archive.finalPath, archive.backupPath);
        backedUp.push(archive);
      }
    }
    for (const archive of archives) {
      await movePublishedFile(archive.temporaryPath, archive.finalPath);
      published.push(archive);
    }
  } catch (publicationError) {
    const rollbackErrors = [];
    for (const archive of published.toReversed()) {
      try {
        await rm(archive.finalPath, { force: true });
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    for (const archive of backedUp.toReversed()) {
      try {
        await movePublishedFile(archive.backupPath, archive.finalPath);
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [publicationError, ...rollbackErrors],
        `Archive publication failed and rollback was incomplete: ${publicationError.message}`
      );
    }
    throw publicationError;
  }
}

export async function buildReleaseArchives({
  sourceRoot = skillDir,
  repositoryRoot = repositoryDir,
  outputDirectory = sourceRoot,
  maximumBundledArchiveBytes = defaultMaximumBundledArchiveBytes,
  createStagingRoot = () => mkdtemp(join(tmpdir(), "codebase-inspector-release-")),
  installDependencies = runNpmCi,
  movePublishedFile = rename
} = {}) {
  const stagingRoot = await createStagingRoot();
  let publicationRoot;
  const packageJsonPath = resolve(sourceRoot, "package.json");
  const packageLockPath = resolve(sourceRoot, "package-lock.json");
  const stagedPackageJsonPath = resolve(stagingRoot, "package.json");
  const stagedPackageLockPath = resolve(stagingRoot, "package-lock.json");
  const slimArchivePath = resolve(outputDirectory, archiveName);
  const bundledArchivePath = resolve(outputDirectory, bundledArchiveName);

  try {
    publicationRoot = await mkdtemp(join(outputDirectory, ".codebase-inspector-publish-"));
    const temporarySlimArchivePath = resolve(publicationRoot, archiveName);
    const temporaryBundledArchivePath = resolve(publicationRoot, bundledArchiveName);
    await cp(packageJsonPath, stagedPackageJsonPath);
    await cp(packageLockPath, stagedPackageLockPath);
    await installDependencies(stagingRoot, ["ci", "--omit=dev", "--ignore-scripts"]);
    await buildRelease({ sourceRoot, repositoryRoot, outputPath: temporarySlimArchivePath });
    await buildRelease({
      sourceRoot,
      repositoryRoot,
      dependencyRoot: stagingRoot,
      maximumBundledArchiveBytes,
      outputPath: temporaryBundledArchivePath
    });
    await publishArchivePair([
      {
        temporaryPath: temporarySlimArchivePath,
        finalPath: slimArchivePath,
        backupPath: resolve(publicationRoot, `${archiveName}.backup`)
      },
      {
        temporaryPath: temporaryBundledArchivePath,
        finalPath: bundledArchivePath,
        backupPath: resolve(publicationRoot, `${bundledArchiveName}.backup`)
      }
    ], movePublishedFile);
    return { slimArchivePath, bundledArchivePath };
  } finally {
    await Promise.all([
      rm(stagingRoot, { recursive: true, force: true }),
      ...(publicationRoot ? [rm(publicationRoot, { recursive: true, force: true })] : [])
    ]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { slimArchivePath, bundledArchivePath } = await buildReleaseArchives();
  console.log(`Codebase Inspector release archives: ${slimArchivePath}, ${bundledArchivePath}`);
}
