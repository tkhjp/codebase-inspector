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
      if (!failed && from.includes(".tmp-") && to === outputPath) {
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
