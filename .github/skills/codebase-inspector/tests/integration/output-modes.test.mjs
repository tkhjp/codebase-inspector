import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { publishArtifacts } from "../../lib/output/publish.mjs";
import { createFixtureRepo } from "../helpers/fixture-repo.mjs";
import { createArtifactFixture } from "./artifact-fixture.mjs";

const defaultBlock = [
  "# BEGIN Codebase Inspector",
  ".code-understanding/",
  "# END Codebase Inspector"
].join("\n");

test("default mode maintains one exact owned exclude block and never edits .gitignore", async () => {
  const root = await createFixtureRepo({ ".gitignore": "dist/\n", "src/app.ts": "export const app = true;\n" });
  const excludePath = join(root, ".git/info/exclude");
  await writeFile(excludePath, "# local rule\n*.scratch\n");

  const request = { targetRoot: root, outputPath: join(root, ".code-understanding"), artifacts: createArtifactFixture(), tracked: false };
  await publishArtifacts(request);
  await publishArtifacts(request);

  const exclude = await readFile(excludePath, "utf8");
  expect(exclude).toBe(`# local rule\n*.scratch\n${defaultBlock}\n`);
  expect(exclude.match(/# BEGIN Codebase Inspector/g)).toHaveLength(1);
  expect(await readFile(join(root, ".gitignore"), "utf8")).toBe("dist/\n");
});

test("tracked mode removes only the exact owned block", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const excludePath = join(root, ".git/info/exclude");
  const unrelated = "# BEGIN Codebase Inspector custom\nkeep-me/\n# END Codebase Inspector custom\n";
  await writeFile(excludePath, `before\n${defaultBlock}\n${unrelated}after\n`);

  await publishArtifacts({ targetRoot: root, outputPath: join(root, ".code-understanding"), artifacts: createArtifactFixture(), tracked: true });

  expect(await readFile(excludePath, "utf8")).toBe(`before\n${unrelated}after\n`);
});

test("custom output mode writes the normalized repository-relative path in the owned block", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const excludePath = join(root, ".git/info/exclude");

  await publishArtifacts({ targetRoot: root, outputPath: join(root, "reports/code"), artifacts: createArtifactFixture(), tracked: false });

  expect(await readFile(excludePath, "utf8")).toContain([
    "# BEGIN Codebase Inspector",
    "reports/code/",
    "# END Codebase Inspector"
  ].join("\n"));
});
