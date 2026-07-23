import { execFile as execFileCallback } from "node:child_process";
import { access, chmod, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { createFixtureRepo } from "../helpers/fixture-repo.mjs";

const execFile = promisify(execFileCallback);
const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const guardPath = resolve(dirname(fileURLToPath(import.meta.url)), "offline-guard-preload.cjs");
const artifactNames = ["analysis-report.json", "classes.md", "code-graph.json", "functions.md", "methods.md", "symbol-index.json"];

async function exists(path) {
  return access(path).then(() => true, () => false);
}

function quotedCommand(...parts) {
  return parts.map((part) => `"${String(part).replaceAll('"', '\\"')}"`).join(" ");
}

test("analysis proves offline and no-exec guards while leaving every absolute sentinel absent", async () => {
  const root = await createFixtureRepo({
    "Makefile": "all:\n\t@echo placeholder\n",
    "package.json": "{\"scripts\":{}}\n",
    "src/dangerous.js": "export const placeholder = true;\n",
    "src/example.ts": "export class Example { run() {} }\nexport function helper() {}\n",
    "tools/target-probe.mjs": "export {};\n",
    "tools/write-sentinel.mjs": "export {};\n"
  });
  const paths = {
    packageScript: join(root, "package-script.sentinel"),
    makefile: join(root, "makefile.sentinel"),
    source: join(root, "source.sentinel"),
    processProbe: join(root, "process-probe.sentinel"),
    fsmonitor: join(root, "fsmonitor.sentinel"),
    proof: join(root, ".git/offline-guard-proof.json")
  };
  const writerPath = join(root, "tools/write-sentinel.mjs");
  const probePath = join(root, "tools/target-probe.mjs");
  const fsmonitorPath = join(root, "tools/fsmonitor-hook.cjs");

  await writeFile(writerPath, "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2], 'executed');\n");
  await writeFile(probePath, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(paths.processProbe)}, 'executed');\n`);
  await chmod(probePath, 0o755);
  await writeFile(fsmonitorPath, `const { writeFileSync } = require("node:fs");\nwriteFileSync(${JSON.stringify(paths.fsmonitor)}, "executed");\nprocess.stdout.write("token\\0");\n`);
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    scripts: {
      build: quotedCommand(process.execPath, writerPath, paths.packageScript),
      test: quotedCommand(process.execPath, writerPath, paths.packageScript)
    }
  }, null, 2)}\n`);
  await writeFile(join(root, "Makefile"), `all:\n\t@${quotedCommand(process.execPath, writerPath, paths.makefile)}\n`);
  await writeFile(join(root, "src/dangerous.js"), `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(paths.source)}, "executed");\nexport const value = 1;\n`);
  await execFile("git", ["-C", root, "add", "."]);
  await execFile("git", ["-C", root, "commit", "-qm", "absolute no-exec sentinels"]);
  await execFile("git", ["-C", root, "config", "core.fsmonitor", quotedCommand(process.execPath, fsmonitorPath)]);

  await execFile("git", ["-C", root, "status", "--porcelain=v1", "-z"]);
  expect(await readFile(paths.fsmonitor, "utf8")).toBe("executed");
  await rm(paths.fsmonitor);

  const guardConfig = JSON.stringify({
    root: await realpath(root),
    skillDir: await realpath(skillDir),
    proofPath: paths.proof,
    processProbe: probePath
  });
  const nodeOptions = `--require "${guardPath.split("\\").join("/")}"`;
  const result = await execFile(process.execPath, [resolve(skillDir, "scripts/run.mjs"), "--skill-arguments", ""], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEBASE_INSPECTOR_GUARD_CONFIG: guardConfig,
      CODEBASE_INSPECTOR_GUARD_PRIMARY: "1",
      NODE_OPTIONS: nodeOptions
    }
  });

  expect(result.stderr).toBe("");
  expect(result.stdout).toMatch(/Codebase Inspector: (complete|partial)/);
  const proof = JSON.parse(await readFile(paths.proof, "utf8"));
  const expectedGuards = [
    "child_process.exec",
    "child_process.execFile",
    "child_process.execFileSync",
    "child_process.execSync",
    "child_process.fork",
    "child_process.spawn",
    "child_process.spawnSync",
    "child_process.unhardenedGit",
    "dgram.Socket.prototype.connect",
    "dgram.Socket.prototype.send",
    "dgram.createSocket",
    "http.get",
    "http.request",
    "https.get",
    "https.request",
    "net.Socket.prototype.connect",
    "net.connect",
    "net.createConnection",
    "tls.connect"
  ];
  if (typeof globalThis.fetch === "function") expectedGuards.push("global.fetch");
  if (typeof globalThis.WebSocket === "function") expectedGuards.push("global.WebSocket");
  expect(proof.sort()).toEqual(expectedGuards.sort());
  await Promise.all(Object.values(paths).filter((path) => path.endsWith(".sentinel")).map(async (path) => {
    expect(await exists(path)).toBe(false);
  }));
  await Promise.all(artifactNames.map(async (name) => {
    expect(await exists(join(root, ".code-understanding", name))).toBe(true);
  }));
});
