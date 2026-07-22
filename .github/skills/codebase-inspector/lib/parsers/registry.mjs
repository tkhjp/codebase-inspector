import { createTreeSitterRuntime, GRAMMAR_CONFIGS } from "./tree-sitter-runtime.mjs";
import { GoExtractor } from "../extractors/go-extractor.mjs";
import { PythonExtractor } from "../extractors/python-extractor.mjs";
import { RustExtractor } from "../extractors/rust-extractor.mjs";
import { TypeScriptExtractor } from "../extractors/typescript-extractor.mjs";

export async function createParserRegistry(skillDir) {
  const typeScriptExtractor = new TypeScriptExtractor();
  const pythonExtractor = new PythonExtractor();
  const rustExtractor = new RustExtractor();
  const goExtractor = new GoExtractor();
  const extractors = new Map([
    ["javascript", typeScriptExtractor],
    ["typescript", typeScriptExtractor],
    ["python", pythonExtractor],
    ["rust", rustExtractor],
    ["go", goExtractor]
  ]);
  const runtime = await createTreeSitterRuntime(skillDir, extractors);

  return {
    languages: Object.freeze([...Object.keys(GRAMMAR_CONFIGS), "shell"]),
    analyzeFile: runtime.analyzeFile,
    close: runtime.close
  };
}
