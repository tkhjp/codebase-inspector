import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeArgv, parseArgs } from "../lib/cli/args.mjs";
import { parseRenderArgs } from "../lib/cli/render-args.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function main({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  ensureRuntimeImpl,
  preflightImpl,
  runAnalysisImpl
} = {}) {
  try {
    const normalized = normalizeArgv(argv);
    const command = normalized[0] === "render" ? "render" : "analyze";
    const commandArgs = normalized[0] === "render" || normalized[0] === "analyze" ? normalized.slice(1) : normalized;
    const ensure = ensureRuntimeImpl ?? (await import("./setup.mjs")).ensureRuntime;
    await ensure({ skillDir });
    if (command === "render") {
      const renderOptions = { ...parseRenderArgs(commandArgs, cwd), cwd };
      const render = (await import("../lib/render-orchestrator.mjs")).runStructureRender;
      const result = await render(renderOptions);
      console.log([
        `Codebase Inspector: ${result.status}`,
        `types=${result.selectedTypeCount}/${result.matchedTypeCount}`,
        `truncated=${result.truncated}`,
        `parserIssues=${result.parserIssueCount}`,
        `unresolvedRelations=${result.unresolvedRelationCount}`,
        `omittedRelations=${result.omittedRelationCount}`,
        `calls=${result.resolvedCallCount}/${result.unresolvedCallCount}`,
        `ambiguousCalls=${result.ambiguousCallCount}`,
        `dynamicCalls=${result.dynamicCallCount}`,
        `definition=${result.definitionOutput}`,
        `diagram=${result.diagramOutput}`,
        `report=${result.reportOutput}`
      ].join("; "));
      return 0;
    }
    const options = parseArgs(commandArgs, cwd);
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
