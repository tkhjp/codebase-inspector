import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export function processInvocation(command, args, {
  platform = process.platform,
  commandShell = process.env.ComSpec ?? "cmd.exe"
} = {}) {
  if (platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    return { command: commandShell, args: ["/d", "/s", "/c", command, ...args] };
  }
  return { command, args };
}

function defaultRunProcess(command, args, options) {
  return new Promise((resolve) => {
    const invocation = processInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, { ...options, shell: false });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function hasMatchingBundledRuntime(skillDir) {
  try {
    const [markerContents, packageLock] = await Promise.all([
      readFile(join(skillDir, ".codebase-inspector-runtime.json"), "utf8"),
      readFile(join(skillDir, "package-lock.json"))
    ]);
    const marker = JSON.parse(markerContents);
    await access(join(skillDir, "node_modules"));
    return marker.formatVersion === 1
      && typeof marker.packageLockSha256 === "string"
      && marker.packageLockSha256 === createHash("sha256").update(packageLock).digest("hex");
  } catch {
    return false;
  }
}

export async function ensureRuntime({
  skillDir,
  nodeVersion = process.versions.node,
  platform = process.platform,
  runProcess = defaultRunProcess
}) {
  const nodeMajor = Number.parseInt(nodeVersion.split(".")[0], 10);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    throw new Error(`Node.js 22 or newer is required; found ${nodeVersion}`);
  }

  if (await hasMatchingBundledRuntime(skillDir)) return;

  const npm = platform === "win32" ? "npm.cmd" : "npm";
  const valid = await runProcess(npm, ["ls", "--omit=dev", "--silent"], { cwd: skillDir, stdio: "ignore" });
  if (valid === 0) return;

  const installed = await runProcess(npm, ["ci", "--omit=dev"], { cwd: skillDir, stdio: "inherit" });
  if (installed !== 0) throw new Error("Skill dependency installation failed");

  const verified = await runProcess(npm, ["ls", "--omit=dev", "--silent"], { cwd: skillDir, stdio: "ignore" });
  if (verified !== 0) throw new Error("Installed Skill dependency tree is invalid");
}
