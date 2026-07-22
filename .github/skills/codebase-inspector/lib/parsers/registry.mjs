import { createTreeSitterRuntime } from "./tree-sitter-runtime.mjs";
import { createUpstreamAdapter } from "../extractors/upstream-adapter.mjs";
import { CppExtractor } from "../../vendor/understand-anything/extractors/cpp-extractor.mjs";
import { CSharpExtractor } from "../../vendor/understand-anything/extractors/csharp-extractor.mjs";
import { DartExtractor } from "../../vendor/understand-anything/extractors/dart-extractor.mjs";
import { GoExtractor } from "../../vendor/understand-anything/extractors/go-extractor.mjs";
import { JavaExtractor } from "../../vendor/understand-anything/extractors/java-extractor.mjs";
import { KotlinExtractor } from "../../vendor/understand-anything/extractors/kotlin-extractor.mjs";
import { PhpExtractor } from "../../vendor/understand-anything/extractors/php-extractor.mjs";
import { PythonExtractor } from "../../vendor/understand-anything/extractors/python-extractor.mjs";
import { RubyExtractor } from "../../vendor/understand-anything/extractors/ruby-extractor.mjs";
import { RustExtractor } from "../../vendor/understand-anything/extractors/rust-extractor.mjs";
import { TypeScriptExtractor } from "../../vendor/understand-anything/extractors/typescript-extractor.mjs";

const SUPPORTED_LANGUAGES = Object.freeze([
  "javascript",
  "typescript",
  "python",
  "rust",
  "go",
  "java",
  "kotlin",
  "csharp",
  "c",
  "cpp",
  "php",
  "ruby",
  "dart"
]);

export async function createParserRegistry(skillDir) {
  const typeScriptExtractor = createUpstreamAdapter(new TypeScriptExtractor());
  const pythonExtractor = createUpstreamAdapter(new PythonExtractor());
  const rustExtractor = createUpstreamAdapter(new RustExtractor());
  const goExtractor = createUpstreamAdapter(new GoExtractor());
  const cppExtractor = createUpstreamAdapter(new CppExtractor());
  const extractors = new Map([
    ["javascript", typeScriptExtractor],
    ["typescript", typeScriptExtractor],
    ["python", pythonExtractor],
    ["rust", rustExtractor],
    ["go", goExtractor],
    ["java", createUpstreamAdapter(new JavaExtractor())],
    ["kotlin", createUpstreamAdapter(new KotlinExtractor())],
    ["csharp", createUpstreamAdapter(new CSharpExtractor())],
    ["c", cppExtractor],
    ["cpp", cppExtractor],
    ["php", createUpstreamAdapter(new PhpExtractor())],
    ["ruby", createUpstreamAdapter(new RubyExtractor())],
    ["dart", createUpstreamAdapter(new DartExtractor())]
  ]);
  const runtime = await createTreeSitterRuntime(skillDir, extractors);

  return {
    languages: SUPPORTED_LANGUAGES,
    analyzeFile: runtime.analyzeFile,
    close: runtime.close
  };
}
