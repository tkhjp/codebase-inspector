import { serializeArtifacts } from "../../lib/output/artifacts.mjs";

const coverage = {
  trackedFiles: 0,
  supportedFiles: 0,
  parsedFiles: 0,
  warningFiles: 0,
  unsupportedFiles: 0
};

export function createArtifactFixture(marker = "fixture") {
  const symbolIndex = {
    schemaVersion: "1.0.0",
    project: {
      name: marker,
      root: null,
      gitCommitHash: "abc123",
      workingTreeDirty: false,
      languages: [],
      skillVersion: "0.1.0"
    },
    files: [],
    types: [],
    methods: [],
    functions: [],
    imports: [],
    calls: [],
    unresolvedCalls: [],
    coverage
  };
  const codeGraph = {
    version: "1.0.0",
    kind: "codebase",
    project: {
      name: marker,
      languages: [],
      frameworks: [],
      description: "",
      analyzedAt: "2000-01-01T00:00:00Z",
      gitCommitHash: "abc123"
    },
    nodes: [],
    edges: [],
    layers: [],
    tour: []
  };
  const report = {
    schemaVersion: "1.0.0",
    skillVersion: "0.1.0",
    status: "complete",
    coverage,
    warnings: [],
    parserFailures: [],
    unsupportedFiles: [],
    relationships: {
      internalImports: 0,
      externalImports: 0,
      unresolvedImports: 0,
      resolvedCalls: 0,
      unresolvedCalls: 0
    },
    options: { tracked: false, output: ".code-understanding", keepIntermediate: false }
  };
  const markdown = {
    "classes.md": `# Classes\n\n${marker}\n`,
    "methods.md": `# Methods\n\n${marker}\n`,
    "functions.md": `# Functions\n\n${marker}\n`
  };
  return serializeArtifacts({ symbolIndex, codeGraph, report, markdown });
}
