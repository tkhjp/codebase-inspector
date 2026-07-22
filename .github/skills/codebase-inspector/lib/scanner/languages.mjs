import { basename, extname } from "node:path";

export const LANGUAGE_BY_EXTENSION = Object.freeze({
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".cs": "csharp",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".php": "php",
  ".rb": "ruby",
  ".rake": "ruby",
  ".dart": "dart"
});

const TEST_DIRECTORY = /(^|\/)(?:test|tests|__tests__|spec|specs|__specs__)(?:\/|$)/i;
const TEST_FILENAME = /(?:^|\.)(?:test|spec)\.[^.]+$/i;
const ENTRYPOINT_FILENAME = /^(?:index|main|app|server|cli)\.[^.]+$/i;

export function detectLanguage(path) {
  return LANGUAGE_BY_EXTENSION[extname(path).toLowerCase()] ?? null;
}

export function classifyFile(path) {
  const name = basename(path);
  if (TEST_DIRECTORY.test(path) || TEST_FILENAME.test(name)) return "test";
  if (ENTRYPOINT_FILENAME.test(name) || path.startsWith("bin/")) return "entrypoint";
  return "source";
}
