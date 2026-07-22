import { mkdtemp, readFile, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { publishArtifacts } from "../../lib/output/publish.mjs";
import { preflight } from "../../lib/runtime/preflight.mjs";
import { createFixtureRepo } from "../helpers/fixture-repo.mjs";
import { createArtifactFixture } from "./artifact-fixture.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function options(root, output) {
  return { targetPath: root, tracked: false, output, keepIntermediate: false };
}

test.skipIf(process.platform === "win32")("preflight enforces canonical output boundaries without rejecting a valid ..reports segment", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const outside = await mkdtemp(join(tmpdir(), "codebase-inspector-outside-"));
  await symlink(".git", join(root, "git-link"));
  await symlink(outside, join(root, "outside-link"));

  await expect(preflight(options(root, "."), skillDir)).rejects.toThrow(/inside target root/i);
  await expect(preflight(options(root, "git-link/output"), skillDir)).rejects.toThrow(/Git directory/i);
  await expect(preflight(options(root, "outside-link/output"), skillDir)).rejects.toThrow(/inside target root/i);

  const accepted = await preflight(options(root, "..reports"), skillDir);
  expect(accepted.outputPath).toBe(join(await realpath(root), "..reports"));
  expect(accepted.options.output).toBe("..reports");
});

test.skipIf(process.platform === "win32")("publisher independently enforces the same canonical output boundaries", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const outside = await mkdtemp(join(tmpdir(), "codebase-inspector-outside-"));
  await symlink(".git", join(root, "git-link"));
  await symlink(outside, join(root, "outside-link"));
  const artifacts = createArtifactFixture();

  await expect(publishArtifacts({ targetRoot: root, outputPath: root, artifacts, tracked: false }))
    .rejects.toThrow(/inside target root/i);
  await expect(publishArtifacts({ targetRoot: root, outputPath: join(root, "git-link/output"), artifacts, tracked: false }))
    .rejects.toThrow(/Git directory/i);
  await expect(publishArtifacts({ targetRoot: root, outputPath: join(root, "outside-link/output"), artifacts, tracked: false }))
    .rejects.toThrow(/inside target root/i);

  await expect(publishArtifacts({ targetRoot: root, outputPath: join(root, "..reports"), artifacts, tracked: false }))
    .resolves.toBeUndefined();
});

test.skipIf(process.platform === "win32")("publisher rejects an info exclude symlink outside the common Git directory", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const outside = await mkdtemp(join(tmpdir(), "codebase-inspector-exclude-"));
  const externalExclude = join(outside, "exclude");
  const excludePath = join(root, ".git/info/exclude");
  await writeFile(externalExclude, "external sentinel\n");
  await unlink(excludePath);
  await symlink(externalExclude, excludePath);

  await expect(publishArtifacts({
    targetRoot: root,
    outputPath: join(root, ".code-understanding"),
    artifacts: createArtifactFixture(),
    tracked: false
  })).rejects.toThrow(/exclude.*common Git directory/i);
  expect(await readFile(externalExclude, "utf8")).toBe("external sentinel\n");
});
