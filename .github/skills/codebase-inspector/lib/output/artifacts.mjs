import { parseCodeGraph } from "../schema/code-graph.mjs";
import { parseAnalysisReport } from "../schema/analysis-report.mjs";
import { parseSymbolIndex } from "../schema/symbol-index.mjs";
import { normalizeText, stableStringify } from "./stable-json.mjs";

const markdownNames = ["classes.md", "methods.md", "functions.md"];

function normalizedFile(value) {
  return `${normalizeText(value).replace(/\n*$/, "")}\n`;
}

export function serializeArtifacts({ symbolIndex, codeGraph, report, markdown }) {
  const artifacts = new Map([
    ["symbol-index.json", stableStringify(parseSymbolIndex(symbolIndex))],
    ["code-graph.json", stableStringify(parseCodeGraph(codeGraph))],
    ["analysis-report.json", stableStringify(parseAnalysisReport(report))]
  ]);

  for (const name of markdownNames) {
    if (typeof markdown[name] !== "string") throw new Error(`Missing Markdown artifact: ${name}`);
    artifacts.set(name, normalizedFile(markdown[name]));
  }
  return artifacts;
}
