import { createTreeSitterRuntime, GRAMMAR_CONFIGS } from "./tree-sitter-runtime.mjs";
import { PythonExtractor } from "../extractors/python-extractor.mjs";
import { TypeScriptExtractor } from "../extractors/typescript-extractor.mjs";

export async function createParserRegistry(skillDir) {
  const typeScriptExtractor = new TypeScriptExtractor();
  const pythonExtractor = new PythonExtractor();
  const extractors = new Map([
    ["javascript", typeScriptExtractor],
    ["typescript", typeScriptExtractor],
    ["python", pythonExtractor]
  ]);
  const runtime = await createTreeSitterRuntime(skillDir, extractors);

  return {
    languages: Object.freeze([...Object.keys(GRAMMAR_CONFIGS), "shell"]),
    analyzeFile: runtime.analyzeFile,
    close: runtime.close
  };
}
