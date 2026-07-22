import { readFile, readdir, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { runAnalysis } from "../../lib/orchestrator.mjs";
import { publishArtifacts } from "../../lib/output/publish.mjs";
import { withAnalysisLock } from "../../lib/runtime/lock.mjs";
import { preflight } from "../../lib/runtime/preflight.mjs";
import { createFixtureRepo } from "../helpers/fixture-repo.mjs";
import { createArtifactFixture } from "./artifact-fixture.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("fatal analysis failure preserves prior successful output and releases the lock", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export function app() { return true; }\n" });
  const config = await preflight({ targetPath: root, tracked: false, output: ".code-understanding", keepIntermediate: false }, skillDir);
  await runAnalysis(config);
  const sentinelPath = join(config.outputPath, "sentinel.txt");
  await writeFile(sentinelPath, "prior-success\n");
  const before = new Map(await Promise.all((await readdir(config.outputPath)).map(async (name) => [name, await readFile(join(config.outputPath, name), "utf8")])));

  await expect(runAnalysis({ ...config, targetRoot: join(root, "missing") })).rejects.toThrow();

  expect(new Map(await Promise.all((await readdir(config.outputPath)).map(async (name) => [name, await readFile(join(config.outputPath, name), "utf8")])))).toEqual(before);
  expect(await fs.stat(join(config.gitDir, "codebase-inspector.lock")).catch((error) => error.code)).toBe("ENOENT");
});

test("a concurrent analysis fails clearly while the first action retains the exclusive lock", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const gitDir = join(root, ".git");
  let releaseFirst;
  const held = withAnalysisLock(gitDir, () => new Promise((resolveAction) => {
    releaseFirst = resolveAction;
  }));

  while (!releaseFirst) await delay(1);
  await expect(withAnalysisLock(gitDir, async () => "second")).rejects.toThrow("analysis already running");
  releaseFirst("first");
  await expect(held).resolves.toBe("first");
  await expect(withAnalysisLock(gitDir, async () => "after-cleanup")).resolves.toBe("after-cleanup");
});

test("publication restores the backup when final rename fails", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const outputPath = join(root, ".code-understanding");
  await fs.mkdir(outputPath);
  await writeFile(join(outputPath, "sentinel.txt"), "old-output\n");
  let failed = false;
  const fsOps = {
    ...fs,
    async rename(from, to) {
      if (!failed && from.includes(".tmp-") && to.endsWith(".code-understanding")) {
        failed = true;
        throw new Error("injected final rename failure");
      }
      return fs.rename(from, to);
    }
  };

  await expect(publishArtifacts({ targetRoot: root, outputPath, artifacts: createArtifactFixture(), tracked: false, fsOps }))
    .rejects.toThrow("injected final rename failure");

  expect(await readdir(outputPath)).toEqual(["sentinel.txt"]);
  expect(await readFile(join(outputPath, "sentinel.txt"), "utf8")).toBe("old-output\n");
  expect((await readdir(root)).some((name) => name.includes(".tmp-") || name.includes(".backup-"))).toBe(false);
});

test("schema-invalid artifacts are rejected before prior output is touched", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const outputPath = join(root, ".code-understanding");
  await fs.mkdir(outputPath);
  await writeFile(join(outputPath, "sentinel.txt"), "old-output\n");
  const artifacts = createArtifactFixture();
  artifacts.set("symbol-index.json", "{}\n");

  await expect(publishArtifacts({ targetRoot: root, outputPath, artifacts, tracked: false })).rejects.toThrow();

  expect(await readdir(outputPath)).toEqual(["sentinel.txt"]);
  expect(await readFile(join(outputPath, "sentinel.txt"), "utf8")).toBe("old-output\n");
});

test("post-commit partial backup cleanup failure retains the new valid output", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const outputPath = join(root, ".code-understanding");
  await fs.mkdir(outputPath);
  await writeFile(join(outputPath, "sentinel.txt"), "old-output\n");
  const cleanupError = new Error("partial backup cleanup failed");
  const fsOps = {
    ...fs,
    async rm(path, options) {
      if (path.includes(".backup-") && options?.recursive) {
        await fs.rm(join(path, "sentinel.txt"), { force: true });
        throw cleanupError;
      }
      return fs.rm(path, options);
    }
  };

  let caught;
  try {
    await publishArtifacts({ targetRoot: root, outputPath, artifacts: createArtifactFixture("new-output"), tracked: false, fsOps });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AggregateError);
  expect(caught.errors).toContain(cleanupError);
  expect((await readdir(outputPath)).sort()).toEqual([
    "analysis-report.json", "classes.md", "code-graph.json", "functions.md", "methods.md", "symbol-index.json"
  ]);
  expect(await readFile(join(outputPath, "classes.md"), "utf8")).toContain("new-output");
});

test("aggregates the primary publication error before every independent cleanup failure", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const outputPath = join(root, ".code-understanding");
  await fs.mkdir(outputPath);
  await writeFile(join(outputPath, "sentinel.txt"), "old-output\n");
  const excludePath = join(root, ".git/info/exclude");
  await writeFile(excludePath, "before\n");
  const primaryError = new Error("final rename failed");
  const outputRestoreError = new Error("output restore failed");
  const excludeRestoreError = new Error("exclude restore failed");
  const temporaryCleanupError = new Error("temporary cleanup failed");
  const excludeTemporaryCleanupError = new Error("exclude temporary cleanup failed");
  const excludeRestoreCleanupError = new Error("exclude restore cleanup failed");
  const attempts = [];
  const fsOps = {
    ...fs,
    async rename(from, to) {
      if (from.includes(".code-understanding.tmp-") && to.endsWith(".code-understanding")) throw primaryError;
      if (from.includes(".code-understanding.backup-") && to.endsWith(".code-understanding")) {
        attempts.push("output-restore");
        throw outputRestoreError;
      }
      if (from.includes("exclude.restore-")) {
        attempts.push("exclude-restore");
        throw excludeRestoreError;
      }
      return fs.rename(from, to);
    },
    async rm(path, options) {
      if (path.includes(".code-understanding.tmp-")) {
        attempts.push("temporary-cleanup");
        throw temporaryCleanupError;
      }
      if (path.includes("exclude.tmp-")) {
        attempts.push("exclude-temporary-cleanup");
        throw excludeTemporaryCleanupError;
      }
      if (path.includes("exclude.restore-")) {
        attempts.push("exclude-restore-cleanup");
        throw excludeRestoreCleanupError;
      }
      return fs.rm(path, options);
    }
  };

  let caught;
  try {
    await publishArtifacts({ targetRoot: root, outputPath, artifacts: createArtifactFixture(), tracked: false, fsOps });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AggregateError);
  expect(caught.errors).toEqual([
    primaryError,
    outputRestoreError,
    excludeRestoreError,
    temporaryCleanupError,
    excludeTemporaryCleanupError,
    excludeRestoreCleanupError
  ]);
  expect(attempts).toEqual([
    "output-restore",
    "exclude-restore",
    "temporary-cleanup",
    "exclude-temporary-cleanup",
    "exclude-restore-cleanup"
  ]);
});
