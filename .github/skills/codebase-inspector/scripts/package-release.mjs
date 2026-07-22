import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDir = resolve(skillDir, "../../..");
const archiveName = "codebase-inspector-0.1.0.zip";
const fixedDosTimestamp = 0x00210000;

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

export async function buildRelease({
  sourceRoot = skillDir,
  repositoryRoot = repositoryDir,
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
    resolve(sourceRoot, "scripts/setup.mjs")
  ];
  const entries = [
    ...files.map((path) => ({ path, name: archivePath(path, sourceRoot) })),
    { path: resolve(repositoryRoot, "LICENSE"), name: "LICENSE" },
    { path: resolve(repositoryRoot, "NOTICE"), name: "NOTICE" }
  ].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  const archive = new AdmZip({ noSort: true });
  for (const entry of entries) {
    archive.addFile(entry.name, await readFile(entry.path), "", 0o644);
    const zipEntry = archive.getEntry(entry.name);
    zipEntry.header.timeval = fixedDosTimestamp;
    zipEntry.header.made = 0x0314;
  }
  await writeFile(outputPath, archive.toBuffer());
  return outputPath;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputPath = await buildRelease();
  console.log(`Codebase Inspector release archive: ${outputPath}`);
}
