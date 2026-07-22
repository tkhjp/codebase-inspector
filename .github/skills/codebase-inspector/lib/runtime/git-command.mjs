import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const hardeningPrefix = ["-c", "core.fsmonitor=false"];
const deterministicEnvironment = {
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  PAGER: "cat"
};

export async function runGit(root, args) {
  // These exact read-only operations do not checkout content, run general hooks,
  // diff/textconv, pagers, remotes, or credentials. Disabling fsmonitor closes
  // their only target-configured executable path while preserving Git metadata.
  const { stdout } = await execFile("git", [...hardeningPrefix, "-C", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...deterministicEnvironment }
  });
  return stdout;
}
