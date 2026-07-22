import { mkdir, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { createFixtureRepo } from "../helpers/fixture-repo.mjs";
import { scanProject } from "../../lib/scanner/scan.mjs";
import { isWorkingTreeDirty } from "../../lib/scanner/git-files.mjs";
import { normalizeRelativePath } from "../../lib/scanner/ignore-rules.mjs";

function runConfig(root, options = {}) {
  return { targetRoot: root, gitDir: join(root, ".git"), options };
}

it.skipIf(process.platform === "win32")("reads tracked working-tree contents, applies ignore rules, and blocks symlink escape", async () => {
  const root = await createFixtureRepo({
    "src/a.ts": "export function a() { return 1; }\r\n",
    "vendor/v.py": "def v(): pass\n",
    "README.md": "x\n",
    ".codeinspectorignore": "vendor/\n"
  });
  await writeFile(join(root, "src/a.ts"), "export function a() { return 2; }\r\n");
  const outside = join(dirname(root), "outside.ts");
  await writeFile(outside, "export const secret = true;\n");
  await symlink(outside, join(root, "src/outside.ts"));
  execFileSync("git", ["-C", root, "add", "src/outside.ts"]);

  const result = await scanProject(runConfig(root));

  expect(result.files.map((file) => file.path)).toEqual(["src/a.ts"]);
  expect(result.files[0]).toMatchObject({
    language: "typescript",
    lineCount: 2,
    content: "export function a() { return 2; }\n"
  });
  expect(result.unsupportedFiles).toContainEqual(expect.objectContaining({
    path: "README.md",
    language: "unknown",
    category: "unsupported"
  }));
  expect(result.warnings).toContainEqual(expect.stringMatching(/outside\.ts.*symlink/));
});

it.skipIf(process.platform === "win32")("accepts internal symlinks and normalizes uppercase extensions and paths with spaces", async () => {
  const root = await createFixtureRepo({
    "src/UPPER.TS": "export const upper = true;\n",
    "src/target.ts": "export const target = true;\n",
    "dir with spaces/file.ts": "export const spaced = true;\n"
  });
  await symlink("target.ts", join(root, "src/linked.ts"));
  execFileSync("git", ["-C", root, "add", "src/linked.ts"]);

  const result = await scanProject(runConfig(root));

  expect(result.files.map((file) => file.path)).toEqual([
    "dir with spaces/file.ts",
    "src/UPPER.TS",
    "src/linked.ts",
    "src/target.ts"
  ]);
  expect(result.files.every((file) => file.language === "typescript")).toBe(true);
});

it("excludes configured output from scanning and dirty-state calculation", async () => {
  const root = await createFixtureRepo({
    "src/app.ts": "export const app = true;\n",
    ".generated/previous.ts": "export const generated = true;\n"
  });
  await writeFile(join(root, ".generated/previous.ts"), "export const changed = true;\n");
  await writeFile(join(root, ".generated/new.ts"), "export const newFile = true;\n");

  const ignoredOnly = await scanProject(runConfig(root, { output: ".generated" }));

  expect(ignoredOnly.files.map((file) => file.path)).toEqual(["src/app.ts"]);
  expect(ignoredOnly.git.dirty).toBe(false);

  await writeFile(join(root, "src/app.ts"), "export const app = false;\n");
  expect((await scanProject(runConfig(root, { output: ".generated" }))).git.dirty).toBe(true);
});

it("does not mark a wholly untracked configured output directory dirty", async () => {
  const root = await createFixtureRepo({ "src/app.ts": "export const app = true;\n" });
  await mkdir(join(root, ".generated"));
  await writeFile(join(root, ".generated/new.ts"), "export const generated = true;\n");

  const result = await scanProject(runConfig(root, { output: ".generated" }));

  expect(result.git.dirty).toBe(false);
});

it("evaluates both NUL porcelain rename and copy paths against ignored output", () => {
  const ignoredPaths = [".generated"];

  expect(isWorkingTreeDirty("R  .generated/new.ts\0.generated/old.ts\0", ignoredPaths)).toBe(false);
  expect(isWorkingTreeDirty("C  src/copied.ts\0.generated/old.ts\0", ignoredPaths)).toBe(true);
});

it("excludes tracked binary files and retains unsupported text metadata without content", async () => {
  const root = await createFixtureRepo({
    "src/binary.ts": Buffer.from([0, 1, 2]),
    "notes.txt": "one\r\ntwo\rthree"
  });

  const result = await scanProject(runConfig(root));

  expect(result.files).toEqual([]);
  expect(result.unsupportedFiles).toEqual([{
    path: "notes.txt",
    language: "unknown",
    category: "unsupported",
    lineCount: 3,
    bytes: 14
  }]);
  expect(JSON.stringify(result.unsupportedFiles)).not.toContain("one");
});

it("reports an injected outside-root symlink without reading it", async () => {
  const root = await createFixtureRepo({ "src/outside.ts": "tracked placeholder\n" });
  let read = false;
  const fsOps = {
    async lstat() {
      return { isSymbolicLink: () => true, isFile: () => false };
    },
    async realpath(path) {
      return path === root ? root : join(dirname(root), "outside.ts");
    },
    async readFile(path) {
      if (path.endsWith("src/outside.ts")) {
        read = true;
        return Buffer.from("export const leaked = true;\n");
      }
      const error = new Error("not found");
      error.code = "ENOENT";
      throw error;
    }
  };

  const result = await scanProject(runConfig(root), { fsOps });

  expect(result.files).toEqual([]);
  expect(result.warnings).toContainEqual(expect.stringMatching(/src\/outside\.ts.*symlink/));
  expect(read).toBe(false);
});

it("rejects a tracked file reached through an injected external parent symlink", async () => {
  const root = await createFixtureRepo({ "src/a.ts": "tracked placeholder\n" });
  let read = false;
  const fsOps = {
    async lstat() {
      return { isSymbolicLink: () => false, isFile: () => true };
    },
    async realpath(path) {
      if (path.endsWith(".codeinspectorignore")) {
        const error = new Error("not found");
        error.code = "ENOENT";
        throw error;
      }
      return path.endsWith("src/a.ts") ? join(dirname(root), "outside", "a.ts") : root;
    },
    async readFile() {
      read = true;
      return Buffer.from("export const leaked = true;\n");
    }
  };

  const result = await scanProject(runConfig(root), { fsOps });

  expect(result.files).toEqual([]);
  expect(result.warnings).toContainEqual(expect.stringMatching(/src\/a\.ts.*symlink/));
  expect(read).toBe(false);
});

it("does not load ignore rules through an injected external symlink", async () => {
  const root = await createFixtureRepo({
    "src/a.ts": "export const safe = true;\n",
    ".codeinspectorignore": "src/\n"
  });
  const fsOps = {
    async lstat() {
      return { isSymbolicLink: () => false, isFile: () => true };
    },
    async realpath(path) {
      if (path.endsWith(".codeinspectorignore")) return join(dirname(root), "external-ignore");
      return path;
    },
    async readFile(path) {
      if (path.endsWith("src/a.ts")) return Buffer.from("export const safe = true;\n");
      throw new Error("external ignore file must not be read");
    }
  };

  const result = await scanProject(runConfig(root), { fsOps });

  expect(result.files.map((file) => file.path)).toEqual(["src/a.ts"]);
  expect(result.warnings).toContainEqual(expect.stringMatching(/\.codeinspectorignore.*symlink/));
});

it.skipIf(process.platform === "win32")("warns and skips a tracked POSIX path containing a literal backslash", async () => {
  const root = await createFixtureRepo({
    "src/a.ts": "export const slash = true;\n",
    "src\\a.ts": "export const backslash = true;\n"
  });

  const result = await scanProject(runConfig(root));

  expect(result.files.map((file) => file.path)).toEqual(["src/a.ts"]);
  expect(result.warnings).toContainEqual(expect.stringMatching(/src\\a\.ts.*backslash/));
});

it("accepts a tracked path whose segment starts with two dots", async () => {
  const root = await createFixtureRepo({ "..reports/a.ts": "export const report = true;\n" });

  const result = await scanProject(runConfig(root));

  expect(result.files.map((file) => file.path)).toEqual(["..reports/a.ts"]);
  expect(result.warnings).toEqual([]);
});

it.each([
  "../a.ts",
  "a/../b.ts",
  String.raw`..\a.ts`,
  String.raw`a\..\b.ts`
])("rejects an actual parent traversal component in %j", (path) => {
  expect(normalizeRelativePath(path)).toBeNull();
});
