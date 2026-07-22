import { expect, test } from "vitest";
import { runAnalysis } from "../../lib/orchestrator.mjs";

const runConfig = {
  skillDir: "/skill",
  targetRoot: "/target",
  outputPath: "/target/.code-understanding",
  gitDir: "/git",
  gitCommitHash: "abc123",
  gitCommitTimestamp: "2000-01-01T00:00:00Z",
  options: { tracked: false, output: ".code-understanding", keepIntermediate: false }
};

const emptyScan = {
  files: [],
  unsupportedFiles: [],
  warnings: [],
  git: { dirty: false }
};

function dependencies(registry, publishArtifacts) {
  return {
    withAnalysisLock: async (_gitDir, action) => action(),
    scanProject: async () => emptyScan,
    createParserRegistry: async () => registry,
    publishArtifacts
  };
}

test("closes the registry before publication and does not publish when close fails", async () => {
  const closeError = new Error("registry close failed");
  const order = [];
  const registry = {
    async analyzeFile() {},
    async close() {
      order.push("close");
      throw closeError;
    }
  };

  await expect(runAnalysis(runConfig, dependencies(registry, async () => {
    order.push("publish");
  }))).rejects.toBe(closeError);

  expect(order).toEqual(["close"]);
});

test("preserves the analysis error before a registry close error and skips publication", async () => {
  const analysisError = new Error("analysis failed");
  const closeError = new Error("registry close failed");
  let published = false;
  const registry = {
    async analyzeFile() {
      throw analysisError;
    },
    async close() {
      throw closeError;
    }
  };
  const deps = dependencies(registry, async () => {
    published = true;
  });
  deps.scanProject = async () => ({
    ...emptyScan,
    files: [{ path: "src/app.ts", language: "typescript", category: "source", lineCount: 1, bytes: 1, content: "x" }]
  });

  let caught;
  try {
    await runAnalysis(runConfig, deps);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AggregateError);
  expect(caught.errors).toEqual([analysisError, closeError]);
  expect(published).toBe(false);
});
