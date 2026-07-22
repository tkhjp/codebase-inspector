import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../lib/cli/args.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const options = parseArgs(process.argv.slice(2), process.cwd());
  const { ensureRuntime } = await import("./setup.mjs");
  await ensureRuntime({ skillDir });
  const { preflight } = await import("../lib/runtime/preflight.mjs");
  const { runAnalysis } = await import("../lib/orchestrator.mjs");
  const result = await runAnalysis(await preflight(options, skillDir));
  console.log(`Codebase Inspector: ${result.status}; output=${result.outputPath}`);
} catch (error) {
  console.error(`Codebase Inspector: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
