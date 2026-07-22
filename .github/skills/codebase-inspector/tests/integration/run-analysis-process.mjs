import { main } from "../../scripts/run.mjs";
import { runAnalysis } from "../../lib/orchestrator.mjs";

async function waitForRelease() {
  process.send?.({ type: "lock-acquired" });
  await new Promise((resolve) => {
    process.on("message", (message) => {
      if (message?.type === "release") resolve();
    });
  });
}

const exitCode = await main({
  argv: process.argv.slice(2),
  runAnalysisImpl: (runConfig) => runAnalysis(runConfig, { onLockAcquired: waitForRelease })
});
process.disconnect?.();
process.exitCode = exitCode;
