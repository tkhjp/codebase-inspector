import { isAbsolute, relative, resolve, sep } from "node:path";
import ignore from "ignore";

const BINARY_OR_MEDIA_EXTENSIONS = new Set([
  ".7z", ".a", ".avi", ".bin", ".bmp", ".class", ".dll", ".dmg", ".doc", ".docx", ".eot", ".exe", ".gif", ".gz", ".ico", ".jar", ".jpeg", ".jpg", ".mov", ".mp3", ".mp4", ".o", ".otf", ".pdf", ".png", ".so", ".tar", ".ttf", ".wasm", ".webm", ".webp", ".woff", ".woff2", ".xls", ".xlsx", ".zip"
]);

const BUILTIN_PATTERNS = [
  ".git/",
  ".git/**",
  ".code-understanding/",
  ".code-understanding/**",
  ".codeinspectorignore",
  "node_modules/",
  "node_modules/**",
  ...[...BINARY_OR_MEDIA_EXTENSIONS].map((extension) => `*${extension}`)
];

export function normalizeRelativePath(path) {
  const normalized = path;
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts.join("/");
}

function outputPathWithinRoot(root, output) {
  const outputPath = resolve(root, output);
  const normalized = relative(root, outputPath).split(sep).join("/");
  return normalizeRelativePath(normalized);
}

function isWithinRoot(root, path) {
  const difference = relative(root, path);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

export function isBinaryOrMediaPath(path) {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return BINARY_OR_MEDIA_EXTENSIONS.has(extension);
}

export async function createIgnoreMatcher(root, output, fsOps, warnings = []) {
  const matcher = ignore().add(BUILTIN_PATTERNS);
  const outputPath = outputPathWithinRoot(root, output);
  if (outputPath) matcher.add([`${outputPath}/`, `${outputPath}/**`]);

  const ignoreFile = resolve(root, ".codeinspectorignore");
  try {
    const resolvedIgnoreFile = await fsOps.realpath(ignoreFile);
    if (!isWithinRoot(root, resolvedIgnoreFile)) {
      warnings.push("Skipped .codeinspectorignore: symlink escapes repository boundary");
      return (path) => isBinaryOrMediaPath(path) || matcher.ignores(path);
    }
    const stat = await fsOps.lstat(resolvedIgnoreFile);
    if (!stat.isFile()) {
      warnings.push("Skipped .codeinspectorignore: working-tree entry is not a regular file");
      return (path) => isBinaryOrMediaPath(path) || matcher.ignores(path);
    }
    const contents = await fsOps.readFile(resolvedIgnoreFile, "utf8");
    matcher.add(String(contents));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  return (path) => isBinaryOrMediaPath(path) || matcher.ignores(path);
}
