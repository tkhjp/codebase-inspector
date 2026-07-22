import { readFile, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
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

function invalidUtf8ExcludeFixture() {
  const before = Buffer.from([0xff, 0xfe, 0x62, 0x65, 0x66, 0x6f, 0x72, 0x65, 0x0d, 0x0a]);
  const owned = Buffer.from([
    "# BEGIN Codebase Inspector\r\n",
    ".code-understanding/\n",
    "# END Codebase Inspector\r\n"
  ].join(""), "ascii");
  const after = Buffer.from([0x61, 0x66, 0x74, 0x65, 0x72, 0x80, 0xff, 0x0a]);
  return { before, owned, after, prior: Buffer.concat([before, owned, after]) };
}

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

test("successful untracked publication preserves unrelated invalid UTF-8 bytes verbatim", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const excludePath = join(root, ".git/info/exclude");
  const fixture = invalidUtf8ExcludeFixture();
  await writeFile(excludePath, fixture.prior);

  await publishArtifacts({
    targetRoot: root,
    outputPath: join(root, ".code-understanding"),
    artifacts: createArtifactFixture(),
    tracked: false
  });

  expect(await readFile(excludePath)).toEqual(Buffer.concat([
    fixture.before,
    fixture.after,
    Buffer.from(`${defaultBlock}\n`, "ascii")
  ]));
});

test("successful tracked publication preserves unrelated invalid UTF-8 bytes verbatim", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const excludePath = join(root, ".git/info/exclude");
  const fixture = invalidUtf8ExcludeFixture();
  await writeFile(excludePath, fixture.prior);

  await publishArtifacts({
    targetRoot: root,
    outputPath: join(root, ".code-understanding"),
    artifacts: createArtifactFixture(),
    tracked: true
  });

  expect(await readFile(excludePath)).toEqual(Buffer.concat([fixture.before, fixture.after]));
});

test.each([
  { tracked: false, prior: Buffer.from("unrelated\r\n*.keep\r\n", "utf8") },
  { tracked: true, prior: Buffer.from(`unrelated\r\n${defaultBlock}\n*.keep\r\n`, "utf8") }
])("restores exact prior exclude bytes when $tracked publication fails", async ({ tracked, prior }) => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const outputPath = join(root, ".code-understanding");
  const excludePath = join(root, ".git/info/exclude");
  await writeFile(excludePath, prior);
  const fsOps = {
    ...fs,
    async rename(from, to) {
      if (from.includes(".code-understanding.tmp-") && to.endsWith(".code-understanding")) {
        throw new Error("injected publication failure");
      }
      return fs.rename(from, to);
    }
  };

  await expect(publishArtifacts({ targetRoot: root, outputPath, artifacts: createArtifactFixture(), tracked, fsOps }))
    .rejects.toThrow("injected publication failure");

  expect(await readFile(excludePath)).toEqual(prior);
});

test("restores prior exclude nonexistence when publication fails", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  const outputPath = join(root, ".code-understanding");
  const excludePath = join(root, ".git/info/exclude");
  await fs.rm(excludePath);
  const fsOps = {
    ...fs,
    async rename(from, to) {
      if (from.includes(".code-understanding.tmp-") && to.endsWith(".code-understanding")) {
        throw new Error("injected publication failure");
      }
      return fs.rename(from, to);
    }
  };

  await expect(publishArtifacts({ targetRoot: root, outputPath, artifacts: createArtifactFixture(), tracked: false, fsOps }))
    .rejects.toThrow("injected publication failure");

  expect(await fs.stat(excludePath).catch((error) => error.code)).toBe("ENOENT");
});
