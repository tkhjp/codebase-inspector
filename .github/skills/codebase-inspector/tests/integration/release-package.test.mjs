import { execFile as execFileCallback } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
import { expect, test } from "vitest";

const execFile = promisify(execFileCallback);
const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const excluded = ["node_modules/", "tests/", ".code-understanding/", ".superpowers/", ".git/"];

async function exists(path) {
  return access(path).then(() => true, () => false);
}

test("release zip contains a standalone runtime and excludes development files", async () => {
  const releaseScript = join(skillDir, "scripts/package-release.mjs");
  expect(await exists(releaseScript)).toBe(true);

  const archivePath = join(skillDir, "codebase-inspector-0.1.0.zip");
  await execFile(process.execPath, [releaseScript], {
    cwd: skillDir,
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC" }
  });
  const firstHash = createHash("sha256").update(await readFile(archivePath)).digest("hex");
  await execFile(process.execPath, [releaseScript], {
    cwd: skillDir,
    encoding: "utf8",
    env: { ...process.env, TZ: "Asia/Tokyo" }
  });
  const secondHash = createHash("sha256").update(await readFile(archivePath)).digest("hex");
  const zip = new AdmZip(archivePath, { noSort: true });
  const zipEntries = zip.getEntries();
  const entries = zipEntries.map((entry) => entry.entryName);

  expect(secondHash).toBe(firstHash);
  expect(entries).toEqual([...entries].sort());
  expect(zipEntries.every((entry) => entry.header.timeval === 0x00210000)).toBe(true);
  expect(zipEntries.every((entry) => entry.header.made === 0x0314)).toBe(true);
  expect(zipEntries.every((entry) => entry.header.version === 20 && entry.header.flags === 0x0800 && entry.header.method === 8)).toBe(true);
  expect(zipEntries.every((entry) => entry.attr === 0x81a40000)).toBe(true);
  expect(entries).toEqual(expect.arrayContaining([
    "SKILL.md",
    "README.ja.md",
    "LICENSE",
    "NOTICE",
    "package.json",
    "package-lock.json",
    "THIRD_PARTY_LICENSES.json",
    "lib/orchestrator.mjs",
    "scripts/run.mjs",
    "vendor/tree-sitter-dart/tree-sitter-dart.wasm",
    "vendor/tree-sitter-dart/LICENSE",
    "vendor/understand-anything/manifest.json",
    "vendor/understand-anything/extractors/typescript-extractor.mjs"
  ]));
  expect(entries.some((entry) => excluded.some((prefix) => entry.startsWith(prefix)) || entry.endsWith(".tmp") || entry.endsWith(".bak"))).toBe(false);
});
