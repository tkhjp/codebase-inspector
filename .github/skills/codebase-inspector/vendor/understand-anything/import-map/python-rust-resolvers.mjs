// Vendored from Egonex-AI/Understand-Anything.
// Source: understand-anything-plugin/skills/understand/extract-import-map.mjs @ 54754a6f97051d1d76c8758353d8ea41afe502a6
// Local adaptation: exports only the deterministic Python/Rust resolver subset used in-process.

function toPosix(path) {
  return path.split(/[\\/]/).filter(Boolean).join("/");
}

function dirOf(path) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function resolvePythonProbe(moduleParts, specifiers, context) {
  if (moduleParts.length === 0) return [];
  const base = moduleParts.join("/");
  const moduleFile = `${base}.py`;
  const packageInit = `${base}/__init__.py`;

  if (context.fileSet.has(moduleFile)) return [moduleFile];
  if (!context.fileSet.has(packageInit)) return [];

  const matches = [packageInit];
  if (Array.isArray(specifiers)) {
    for (const specifier of specifiers) {
      if (!specifier || specifier === "*" || specifier.includes(".")) continue;
      const subFile = `${base}/${specifier}.py`;
      const subInit = `${base}/${specifier}/__init__.py`;
      if (context.fileSet.has(subFile)) matches.push(subFile);
      else if (context.fileSet.has(subInit)) matches.push(subInit);
    }
  }
  return matches;
}

export function resolvePythonImport(rawImport, specifiers, file, context) {
  if (typeof rawImport !== "string") return [];
  const importerDir = dirOf(toPosix(file.path));
  let dots = 0;
  while (dots < rawImport.length && rawImport.charCodeAt(dots) === 0x2e) dots += 1;
  const tail = rawImport.slice(dots);
  const tailSegments = tail ? tail.split(".").filter(Boolean) : [];

  if (dots > 0) {
    const importerParts = importerDir ? importerDir.split("/").filter(Boolean) : [];
    const dropLevels = dots - 1;
    if (dropLevels > importerParts.length) return [];
    const baseParts = importerParts.slice(0, importerParts.length - dropLevels);
    if (tailSegments.length === 0) {
      if (!Array.isArray(specifiers) || specifiers.length === 0) return [];
      const base = baseParts.join("/");
      const matches = [];
      for (const specifier of specifiers) {
        if (!specifier || specifier === "*" || specifier.includes(".")) continue;
        const subFile = base ? `${base}/${specifier}.py` : `${specifier}.py`;
        const subInit = base ? `${base}/${specifier}/__init__.py` : `${specifier}/__init__.py`;
        if (context.fileSet.has(subFile)) matches.push(subFile);
        else if (context.fileSet.has(subInit)) matches.push(subInit);
      }
      return matches;
    }
    return resolvePythonProbe(baseParts.concat(tailSegments), specifiers, context);
  }

  if (tailSegments.length === 0) return [];
  const importerParts = importerDir ? importerDir.split("/").filter(Boolean) : [];
  for (let index = importerParts.length; index >= 0; index -= 1) {
    const matches = resolvePythonProbe(importerParts.slice(0, index).concat(tailSegments), specifiers, context);
    if (matches.length > 0) return matches;
  }
  return [];
}

function probeRustModule(base, fileSet) {
  if (!base) return null;
  if (fileSet.has(`${base}.rs`)) return `${base}.rs`;
  if (fileSet.has(`${base}/mod.rs`)) return `${base}/mod.rs`;
  return null;
}

function findRustCrateSrc(importerDir, fileSet) {
  const parts = importerDir.split("/").filter(Boolean);
  for (let index = parts.length; index >= 0; index -= 1) {
    const ancestor = parts.slice(0, index).join("/");
    const childSrc = ancestor ? `${ancestor}/src` : "src";
    if (fileSet.has(`${childSrc}/lib.rs`) || fileSet.has(`${childSrc}/main.rs`)) return childSrc;
  }
  return null;
}

export function resolveRustImport(rawImport, file, context) {
  if (!rawImport || typeof rawImport !== "string") return [];
  const source = rawImport.trim();
  if (!source) return [];
  const importerDir = dirOf(toPosix(file.path));
  const segments = source.split("::").filter(Boolean);
  const head = segments[0];
  if (head !== "crate" && head !== "super" && head !== "self") return [];

  let baseDir;
  if (head === "crate") {
    baseDir = findRustCrateSrc(importerDir, context.fileSet);
    if (!baseDir) return [];
  } else if (head === "super") {
    const parts = importerDir.split("/").filter(Boolean);
    if (parts.length === 0) return [];
    baseDir = parts.slice(0, -1).join("/");
  } else {
    baseDir = importerDir;
  }

  const rest = segments.slice(1);
  for (let index = rest.length; index > 0; index -= 1) {
    const prefix = rest.slice(0, index).join("/");
    const match = probeRustModule(baseDir ? `${baseDir}/${prefix}` : prefix, context.fileSet);
    if (match) return [match];
  }
  return [];
}

const rustModPattern = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+(\w+)\s*;\s*$/gm;

function stripJsLikeComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

export function extractRustModSources(content) {
  const sources = [];
  const stripped = stripJsLikeComments(content);
  rustModPattern.lastIndex = 0;
  let match;
  while ((match = rustModPattern.exec(stripped)) !== null) sources.push(`self::${match[1]}`);
  return sources;
}
