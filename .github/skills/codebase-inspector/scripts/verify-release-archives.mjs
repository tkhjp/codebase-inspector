import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import AdmZip from "adm-zip";

const execFile = promisify(execFileCallback);
const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archivePrefix = ".github/skills/codebase-inspector";
const slimArchiveName = "codebase-inspector-0.1.0.zip";
const bundledArchiveName = "codebase-inspector-0.1.0-with-dependencies.zip";
const artifactNames = Object.freeze([
  "analysis-report.json",
  "classes.md",
  "code-graph.json",
  "functions.md",
  "methods.md",
  "symbol-index.json"
]);
const offlineGuardEnvironment = Object.freeze({
  ALL_PROXY: "http://127.0.0.1:9",
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  npm_config_audit: "false",
  npm_config_fetch_retries: "0",
  npm_config_offline: "true",
  npm_config_registry: "http://127.0.0.1:9"
});

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function runCommand(command, args, options) {
  return execFile(command, args, { ...options, encoding: "utf8" });
}

async function createTemporaryRepository(repositoryRoot) {
  await mkdir(join(repositoryRoot, "src"), { recursive: true });
  await writeFile(join(repositoryRoot, "README.md"), "release verifier fixture\n");
  await writeFile(join(repositoryRoot, "outside-skill.txt"), "must remain at repository root\n");
  await writeFile(join(repositoryRoot, "src/example.js"), "export function inspect(value) { return value; }\n");
  await runCommand("git", ["init", "--quiet"], { cwd: repositoryRoot });
  await runCommand("git", ["config", "user.email", "release-verifier@example.test"], { cwd: repositoryRoot });
  await runCommand("git", ["config", "user.name", "Release Verifier"], { cwd: repositoryRoot });
  await runCommand("git", ["add", "README.md", "outside-skill.txt", "src/example.js"], { cwd: repositoryRoot });
  await runCommand("git", ["commit", "--quiet", "-m", "fixture"], { cwd: repositoryRoot });
}

async function assertArchivePlacement(repositoryRoot, { hasBundledDependencies }) {
  const extractedSkillDir = join(repositoryRoot, archivePrefix);
  if (!await exists(join(extractedSkillDir, "SKILL.md"))) {
    throw new Error("Release archive did not extract SKILL.md below the Skill directory");
  }
  if (await exists(join(repositoryRoot, "SKILL.md"))) {
    throw new Error("Release archive extracted SKILL.md at the repository root");
  }
  if (await readFile(join(repositoryRoot, "outside-skill.txt"), "utf8") !== "must remain at repository root\n") {
    throw new Error("Release archive modified a file outside the Skill directory");
  }
  const hasNodeModules = await exists(join(extractedSkillDir, "node_modules"));
  if (hasNodeModules !== hasBundledDependencies) {
    throw new Error(`Release archive bundled dependencies mismatch: expected ${hasBundledDependencies}`);
  }
  return extractedSkillDir;
}

async function assertBundledMarkerBypassesNpm(extractedSkillDir) {
  const setupUrl = pathToFileURL(join(extractedSkillDir, "scripts/setup.mjs")).href;
  const { ensureRuntime } = await import(setupUrl);
  await ensureRuntime({
    skillDir: extractedSkillDir,
    runProcess: async () => {
      throw new Error("Bundled runtime attempted to invoke npm");
    }
  });
}

async function assertExactArtifacts(repositoryRoot, extractedSkillDir) {
  const outputPath = join(repositoryRoot, ".code-understanding");
  const runScript = await realpath(join(extractedSkillDir, "scripts/run.mjs"));
  await runCommand(process.execPath, [runScript, "--tracked"], {
    cwd: repositoryRoot,
    env: { ...process.env, ...offlineGuardEnvironment }
  });
  const names = (await readdir(outputPath)).sort();
  if (JSON.stringify(names) !== JSON.stringify(artifactNames)) {
    throw new Error(`Bundled Skill produced unexpected artifacts: ${names.join(", ")}`);
  }
}

export async function verifyReleaseArchives({
  slimArchivePath = join(skillDir, slimArchiveName),
  bundledArchivePath = join(skillDir, bundledArchiveName),
  temporaryDirectory = tmpdir()
} = {}) {
  const temporaryRoot = await mkdtemp(join(temporaryDirectory, "codebase-inspector-release-verify-"));
  const repositoryRoot = join(temporaryRoot, "repository");

  try {
    await createTemporaryRepository(repositoryRoot);
    new AdmZip(slimArchivePath, { noSort: true }).extractAllTo(repositoryRoot, true);
    await assertArchivePlacement(repositoryRoot, { hasBundledDependencies: false });

    new AdmZip(bundledArchivePath, { noSort: true }).extractAllTo(repositoryRoot, true);
    const extractedSkillDir = await assertArchivePlacement(repositoryRoot, { hasBundledDependencies: true });
    await assertBundledMarkerBypassesNpm(extractedSkillDir);
    await assertExactArtifacts(repositoryRoot, extractedSkillDir);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyReleaseArchives();
  console.log("Codebase Inspector release archives verified");
}
