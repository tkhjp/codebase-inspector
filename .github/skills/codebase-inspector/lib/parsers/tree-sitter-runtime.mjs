import { createRequire } from "node:module";
import { extname, resolve } from "node:path";
import { Language, Parser } from "web-tree-sitter";
import { parseRawFileAnalysis } from "../schema/raw-analysis.mjs";

const require = createRequire(import.meta.url);

export const GRAMMAR_CONFIGS = Object.freeze({
  javascript: Object.freeze({ packageName: "tree-sitter-javascript", wasmFile: "tree-sitter-javascript.wasm" }),
  typescript: Object.freeze({ packageName: "tree-sitter-typescript", wasmFile: "tree-sitter-typescript.wasm" }),
  tsx: Object.freeze({ packageName: "tree-sitter-typescript", wasmFile: "tree-sitter-tsx.wasm" }),
  python: Object.freeze({ packageName: "tree-sitter-python", wasmFile: "tree-sitter-python.wasm" }),
  rust: Object.freeze({ packageName: "tree-sitter-rust", wasmFile: "tree-sitter-rust.wasm" }),
  go: Object.freeze({ packageName: "tree-sitter-go", wasmFile: "tree-sitter-go.wasm" }),
  java: Object.freeze({ packageName: "tree-sitter-java", wasmFile: "tree-sitter-java.wasm" }),
  kotlin: Object.freeze({ packageName: "@tree-sitter-grammars/tree-sitter-kotlin", wasmFile: "tree-sitter-kotlin.wasm" }),
  csharp: Object.freeze({ packageName: "tree-sitter-c-sharp", wasmFile: "tree-sitter-c_sharp.wasm" }),
  c: Object.freeze({ packageName: "tree-sitter-cpp", wasmFile: "tree-sitter-cpp.wasm" }),
  cpp: Object.freeze({ packageName: "tree-sitter-cpp", wasmFile: "tree-sitter-cpp.wasm" }),
  php: Object.freeze({ packageName: "tree-sitter-php", wasmFile: "tree-sitter-php.wasm" }),
  ruby: Object.freeze({ packageName: "tree-sitter-ruby", wasmFile: "tree-sitter-ruby.wasm" }),
  dart: Object.freeze({ localPath: "vendor/tree-sitter-dart/tree-sitter-dart.wasm" })
});

let parserInitialization;

function initializeParser() {
  parserInitialization ??= Parser.init();
  return parserInitialization;
}

function grammarKey(file) {
  return extname(file.path).toLowerCase() === ".tsx" ? "tsx" : file.language;
}

function emptyAnalysis(file, warning) {
  return {
    filePath: file.path,
    language: file.language,
    types: [],
    methods: [],
    functions: [],
    importCandidates: [],
    callCandidates: [],
    warnings: [warning]
  };
}

function normalizedContent(content) {
  return String(content).replace(/\r\n?/g, "\n");
}

function grammarPath(skillDir, config) {
  if (config.packageName) return require.resolve(`${config.packageName}/${config.wasmFile}`);
  return resolve(skillDir, config.localPath);
}

export async function createTreeSitterRuntime(skillDir, extractors) {
  const languages = new Map();
  const loadFailures = new Map();
  let closed = false;

  try {
    await initializeParser();
    await Promise.all(Object.entries(GRAMMAR_CONFIGS).map(async ([language, config]) => {
      try {
        languages.set(language, await Language.load(grammarPath(skillDir, config)));
      } catch {
        loadFailures.set(language, `Could not load Tree-sitter grammar for ${language}`);
      }
    }));
  } catch {
    for (const language of Object.keys(GRAMMAR_CONFIGS)) {
      loadFailures.set(language, `Could not initialize Tree-sitter grammar for ${language}`);
    }
  }

  return {
    async analyzeFile(file) {
      if (closed) return emptyAnalysis(file, "Tree-sitter runtime is closed");

      const key = grammarKey(file);
      const language = languages.get(key);
      if (!language) {
        return emptyAnalysis(file, loadFailures.get(key) ?? `No Tree-sitter grammar is configured for ${file.language}`);
      }

      const extractor = extractors.get(file.language);
      if (!extractor) return emptyAnalysis(file, `No extractor is registered for ${file.language}`);

      let parser;
      let tree;
      try {
        parser = new Parser();
        parser.setLanguage(language);
        tree = parser.parse(normalizedContent(file.content));
        if (!tree) return emptyAnalysis(file, `Tree-sitter could not parse ${file.path}`);
        return parseRawFileAnalysis(extractor.extract(tree.rootNode, {
          filePath: file.path,
          language: file.language
        }));
      } catch {
        return emptyAnalysis(file, `Tree-sitter analysis failed for ${file.path}`);
      } finally {
        tree?.delete();
        parser?.delete();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      languages.clear();
    }
  };
}
