import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../lib/cli/args.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function main({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  ensureRuntimeImpl,
  preflightImpl,
  runAnalysisImpl
} = {}) {
  try {
    const options = parseArgs(argv, cwd);
    const ensure = ensureRuntimeImpl ?? (await import("./setup.mjs")).ensureRuntime;
    await ensure({ skillDir });
    const runPreflight = preflightImpl ?? (await import("../lib/runtime/preflight.mjs")).preflight;
    const analyze = runAnalysisImpl ?? (await import("../lib/orchestrator.mjs")).runAnalysis;
    const result = await analyze(await runPreflight(options, skillDir));
    console.log(`Codebase Inspector: ${result.status}; output=${result.outputPath}`);
    return 0;
  } catch (error) {
    console.error(`Codebase Inspector: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
