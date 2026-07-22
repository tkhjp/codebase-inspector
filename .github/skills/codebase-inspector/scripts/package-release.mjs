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
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(path);
    if (entry.isFile()) return [path];
    return [];
  }));
  return files.flat();
}

function archivePath(path) {
  return relative(skillDir, path).split(sep).join("/");
}

export async function buildRelease({ outputPath = resolve(skillDir, archiveName) } = {}) {
  const relativeFiles = [
    "SKILL.md",
    "README.ja.md",
    "THIRD_PARTY_LICENSES.json",
    "package-lock.json",
    "package.json"
  ].map((path) => resolve(skillDir, path));
  const files = [
    ...relativeFiles,
    ...(await collectFiles(resolve(skillDir, "lib"))),
    ...(await collectFiles(resolve(skillDir, "vendor"))),
    resolve(skillDir, "scripts/run.mjs"),
    resolve(skillDir, "scripts/setup.mjs")
  ];
  const entries = [
    ...files.map((path) => ({ path, name: archivePath(path) })),
    { path: resolve(repositoryDir, "LICENSE"), name: "LICENSE" },
    { path: resolve(repositoryDir, "NOTICE"), name: "NOTICE" }
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
