import { execFile as execFileCallback } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
import { expect, test } from "vitest";
import * as releasePackage from "../../scripts/package-release.mjs";

const execFile = promisify(execFileCallback);
const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const excludedPathSegments = ["tests", ".code-understanding", ".superpowers", ".git"];
const { buildRelease } = releasePackage;

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function copyReleaseFixture(sourceRoot, repositoryRoot) {
  await mkdir(sourceRoot, { recursive: true });
  await Promise.all([
    ...["SKILL.md", "README.ja.md", "THIRD_PARTY_LICENSES.json", "package-lock.json", "package.json"]
      .map((name) => cp(join(skillDir, name), join(sourceRoot, name))),
    ...["lib", "vendor", "scripts"].map((name) => cp(join(skillDir, name), join(sourceRoot, name), { recursive: true })),
    writeFile(join(repositoryRoot, "LICENSE"), "isolated license\n"),
    writeFile(join(repositoryRoot, "NOTICE"), "isolated notice\n")
  ]);
}

test("release zip contains a standalone runtime and excludes development files", async () => {
  const releaseScript = join(skillDir, "scripts/package-release.mjs");
  expect(await exists(releaseScript)).toBe(true);

  const temporaryRoot = await mkdtemp(join(tmpdir(), "codebase-inspector-release-"));
  const repositoryRoot = join(temporaryRoot, "repository");
  const sourceRoot = join(repositoryRoot, ".github/skills/codebase-inspector");
  const archivePath = join(temporaryRoot, "utc.zip");
  const secondArchivePath = join(temporaryRoot, "tokyo.zip");
  const defaultArchivePath = join(temporaryRoot, "default.zip");
  const regressionPaths = [
    join(sourceRoot, "lib/release-regression.tmp"),
    join(sourceRoot, "lib/release-regression.bak"),
    join(sourceRoot, "vendor/release-regression.tmp/inside.mjs"),
    join(sourceRoot, "vendor/release-regression.bak/inside.mjs")
  ];

  try {
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      ...["SKILL.md", "README.ja.md", "THIRD_PARTY_LICENSES.json", "package-lock.json", "package.json"]
        .map((name) => cp(join(skillDir, name), join(sourceRoot, name))),
      ...["lib", "vendor", "scripts"].map((name) => cp(join(skillDir, name), join(sourceRoot, name), { recursive: true })),
      writeFile(join(repositoryRoot, "LICENSE"), "isolated license\n"),
      writeFile(join(repositoryRoot, "NOTICE"), "isolated notice\n")
    ]);
    await Promise.all(regressionPaths.map(async (path) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "must not ship\n");
    }));

    const buildProcess = join(dirname(fileURLToPath(import.meta.url)), "release-package-process.mjs");
    await execFile(process.execPath, [buildProcess, sourceRoot, repositoryRoot, archivePath], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, TZ: "UTC" }
    });
    const firstHash = createHash("sha256").update(await readFile(archivePath)).digest("hex");
    await execFile(process.execPath, [buildProcess, sourceRoot, repositoryRoot, secondArchivePath], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, TZ: "Asia/Tokyo" }
    });
    const secondHash = createHash("sha256").update(await readFile(secondArchivePath)).digest("hex");
    const zip = new AdmZip(secondArchivePath, { noSort: true });
    const zipEntries = zip.getEntries();
    const entries = zipEntries.map((entry) => entry.entryName);

    expect(secondHash).toBe(firstHash);
    expect(entries).toEqual([...entries].sort());
    expect(zipEntries.every((entry) => entry.header.timeval === 0x00210000)).toBe(true);
    expect(zipEntries.every((entry) => entry.header.made === 0x0314)).toBe(true);
    expect(zipEntries.every((entry) => entry.header.version === 20 && entry.header.flags === 0x0800 && entry.header.method === 8)).toBe(true);
    expect(zipEntries.every((entry) => entry.attr === 0x81a40000)).toBe(true);
    const prefix = ".github/skills/codebase-inspector/";
    expect(entries).toContain(`${prefix}SKILL.md`);
    expect(entries).toContain(`${prefix}scripts/run.mjs`);
    expect(entries).toContain(`${prefix}LICENSE`);
    expect(entries.every((entry) => entry.startsWith(prefix))).toBe(true);
    expect(entries).not.toContain("LICENSE");
    expect(entries).toEqual(expect.arrayContaining([
      `${prefix}README.ja.md`,
      `${prefix}LICENSE`,
      `${prefix}NOTICE`,
      `${prefix}package.json`,
      `${prefix}package-lock.json`,
      `${prefix}THIRD_PARTY_LICENSES.json`,
      `${prefix}lib/orchestrator.mjs`,
      `${prefix}scripts/run.mjs`,
      `${prefix}vendor/tree-sitter-dart/tree-sitter-dart.wasm`,
      `${prefix}vendor/tree-sitter-dart/LICENSE`,
      `${prefix}vendor/understand-anything/manifest.json`,
      `${prefix}vendor/understand-anything/extractors/typescript-extractor.mjs`
    ]));
    expect(entries.some((entry) => {
      const relativeEntry = entry.slice(prefix.length);
      return relativeEntry === entry
        || relativeEntry.startsWith("node_modules/")
        || excludedPathSegments.some((segment) => relativeEntry === segment || relativeEntry.startsWith(`${segment}/`))
        || relativeEntry.split("/").some((segment) => segment.endsWith(".tmp") || segment.endsWith(".bak"));
    })).toBe(false);
    expect(zip.readAsText(`${prefix}LICENSE`)).toBe("isolated license\n");
    expect(zip.readAsText(`${prefix}NOTICE`)).toBe("isolated notice\n");

    await buildRelease({ outputPath: defaultArchivePath });
    const defaultZip = new AdmZip(defaultArchivePath, { noSort: true });
    expect(defaultZip.readAsText(`${prefix}LICENSE`)).toBe(await readFile(resolve(skillDir, "../../../LICENSE"), "utf8"));
    expect(defaultZip.readAsText(`${prefix}NOTICE`)).toBe(await readFile(resolve(skillDir, "../../../NOTICE"), "utf8"));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("bundled release includes staged production dependencies and runtime marker", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "codebase-inspector-bundled-release-"));
  const repositoryRoot = join(temporaryRoot, "repository");
  const sourceRoot = join(repositoryRoot, ".github/skills/codebase-inspector");
  const dependencyRoot = join(temporaryRoot, "dependencies");
  const archivePath = join(temporaryRoot, "bundled.zip");
  const prefix = ".github/skills/codebase-inspector/";

  try {
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      ...["SKILL.md", "README.ja.md", "THIRD_PARTY_LICENSES.json", "package-lock.json", "package.json"]
        .map((name) => cp(join(skillDir, name), join(sourceRoot, name))),
      ...["lib", "vendor", "scripts"].map((name) => cp(join(skillDir, name), join(sourceRoot, name), { recursive: true })),
      writeFile(join(repositoryRoot, "LICENSE"), "isolated license\n"),
      writeFile(join(repositoryRoot, "NOTICE"), "isolated notice\n"),
      mkdir(join(dependencyRoot, "node_modules/example"), { recursive: true })
    ]);
    await writeFile(join(dependencyRoot, "node_modules/example/package.json"), "{\"name\":\"example\"}\n");

    await buildRelease({ sourceRoot, repositoryRoot, dependencyRoot, outputPath: archivePath });

    const zip = new AdmZip(archivePath, { noSort: true });
    const entries = zip.getEntries().map((entry) => entry.entryName);
    const marker = JSON.parse(zip.readAsText(`${prefix}.codebase-inspector-runtime.json`));
    expect(entries).toContain(`${prefix}node_modules/example/package.json`);
    expect(entries).toContain(`${prefix}.codebase-inspector-runtime.json`);
    expect(entries.some((entry) => entry.startsWith(`${prefix}tests/`))).toBe(false);
    expect(marker).toEqual({
      formatVersion: 1,
      packageLockSha256: createHash("sha256").update(await readFile(join(sourceRoot, "package-lock.json"))).digest("hex")
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("release orchestration stages clean dependencies and rebuilds both archives", async () => {
  expect(releasePackage.buildReleaseArchives).toBeTypeOf("function");
  if (!releasePackage.buildReleaseArchives) return;

  const temporaryRoot = await mkdtemp(join(tmpdir(), "codebase-inspector-release-orchestration-"));
  const repositoryRoot = join(temporaryRoot, "repository");
  const sourceRoot = join(repositoryRoot, ".github/skills/codebase-inspector");
  const stagingRoot = join(temporaryRoot, "staging");
  const outputDirectory = join(temporaryRoot, "output");
  const npmCalls = [];

  try {
    await copyReleaseFixture(sourceRoot, repositoryRoot);
    await mkdir(join(sourceRoot, "node_modules/worktree-only"), { recursive: true });
    await writeFile(join(sourceRoot, "node_modules/worktree-only/package.json"), "{\"name\":\"worktree-only\"}\n");
    await mkdir(outputDirectory);

    const outputPaths = await releasePackage.buildReleaseArchives({
      sourceRoot,
      repositoryRoot,
      outputDirectory,
      createStagingRoot: async () => {
        await mkdir(stagingRoot);
        return stagingRoot;
      },
      installDependencies: async (dependencyRoot, args) => {
        npmCalls.push({ dependencyRoot, args });
        expect(await readFile(join(dependencyRoot, "package.json"))).toEqual(await readFile(join(sourceRoot, "package.json")));
        expect(await readFile(join(dependencyRoot, "package-lock.json"))).toEqual(await readFile(join(sourceRoot, "package-lock.json")));
        await mkdir(join(dependencyRoot, "node_modules/example"), { recursive: true });
        await writeFile(join(dependencyRoot, "node_modules/example/package.json"), "{\"name\":\"example\"}\n");
      }
    });

    expect(npmCalls).toEqual([{
      dependencyRoot: stagingRoot,
      args: ["ci", "--omit=dev", "--ignore-scripts"]
    }]);
    expect(outputPaths).toEqual({
      slimArchivePath: join(outputDirectory, "codebase-inspector-0.1.0.zip"),
      bundledArchivePath: join(outputDirectory, "codebase-inspector-0.1.0-with-dependencies.zip")
    });
    const slimEntries = new AdmZip(outputPaths.slimArchivePath, { noSort: true })
      .getEntries().map((entry) => entry.entryName);
    const bundledEntries = new AdmZip(outputPaths.bundledArchivePath, { noSort: true })
      .getEntries().map((entry) => entry.entryName);
    const prefix = ".github/skills/codebase-inspector/node_modules/";
    expect(slimEntries.some((entry) => entry.startsWith(prefix))).toBe(false);
    expect(bundledEntries).toContain(`${prefix}example/package.json`);
    expect(bundledEntries).not.toContain(`${prefix}worktree-only/package.json`);
    expect(await exists(stagingRoot)).toBe(false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("release orchestration rejects an oversized bundle and removes staging after failure", async () => {
  expect(releasePackage.buildReleaseArchives).toBeTypeOf("function");
  if (!releasePackage.buildReleaseArchives) return;

  const temporaryRoot = await mkdtemp(join(tmpdir(), "codebase-inspector-release-limit-"));
  const repositoryRoot = join(temporaryRoot, "repository");
  const sourceRoot = join(repositoryRoot, ".github/skills/codebase-inspector");
  const stagingRoot = join(temporaryRoot, "staging");
  const outputDirectory = join(temporaryRoot, "output");

  try {
    await copyReleaseFixture(sourceRoot, repositoryRoot);
    await mkdir(outputDirectory);

    await expect(releasePackage.buildReleaseArchives({
      sourceRoot,
      repositoryRoot,
      outputDirectory,
      maximumBundledArchiveBytes: 1,
      createStagingRoot: async () => {
        await mkdir(stagingRoot);
        return stagingRoot;
      },
      installDependencies: async (dependencyRoot) => {
        await mkdir(join(dependencyRoot, "node_modules/example"), { recursive: true });
        await writeFile(join(dependencyRoot, "node_modules/example/package.json"), "{\"name\":\"example\"}\n");
      }
    })).rejects.toThrow("Bundled release archive must be smaller than 1 bytes");
    expect(await exists(stagingRoot)).toBe(false);
    expect(await exists(join(outputDirectory, "codebase-inspector-0.1.0-with-dependencies.zip"))).toBe(false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
