import { resolve } from "node:path";

const USAGE = "Usage: /codebase-inspector render [--snapshot <file>] [--path <prefix>] [--language <name>] [--type-kind <kind>] [--visibility <visibility>] [--name <text>] [--include-non-public] [--omit-diagram-members] [--max-types <count>] [--split-size <count>] [--split-by <none|language|module|package|namespace|path>] [--output <dir>] [--definition-output <name>] [--diagram-output <name>]";
const VALUE_OPTIONS = new Set([
  "--snapshot",
  "--path",
  "--language",
  "--type-kind",
  "--visibility",
  "--name",
  "--max-types",
  "--split-size",
  "--split-by",
  "--output",
  "--definition-output",
  "--diagram-output"
]);
const TYPE_KINDS = new Set(["class", "interface", "struct", "enum", "trait", "record", "module"]);
const VISIBILITIES = new Set(["public", "protected", "private", "internal", "package"]);
const SPLIT_VALUES = new Set(["none", "language", "module", "package", "namespace", "path"]);

function positiveInteger(value) {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(USAGE);
  return Number(value);
}

function pathPrefix(value) {
  if (!value) return null;
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!normalized || normalized === ".") return null;
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(USAGE);
  }
  return normalized;
}

function markdownFilename(value) {
  const hasControlCharacter = [...value].some((character) => character.charCodeAt(0) < 32);
  if (!/\.md$/i.test(value) || /[<>:"/\\|?*]/.test(value) || hasControlCharacter || /[. ]$/.test(value)) {
    throw new Error(USAGE);
  }
  const stem = value.split(".")[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) throw new Error(USAGE);
  return value;
}

export function parseRenderArgs(argv, cwd) {
  const values = new Map();
  let includeNonPublic = false;
  let omitDiagramMembers = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--include-non-public") includeNonPublic = true;
    else if (value === "--omit-diagram-members") omitDiagramMembers = true;
    else if (VALUE_OPTIONS.has(value)) {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(USAGE);
      values.set(value, next);
      index += 1;
    } else {
      throw new Error(USAGE);
    }
  }

  const kind = values.get("--type-kind") ?? null;
  const visibility = values.get("--visibility") ?? null;
  const splitBy = values.get("--split-by") ?? "none";
  if (kind && !TYPE_KINDS.has(kind)) throw new Error(USAGE);
  if (visibility && !VISIBILITIES.has(visibility)) throw new Error(USAGE);
  if (!SPLIT_VALUES.has(splitBy)) throw new Error(USAGE);

  const output = resolve(cwd, values.get("--output") ?? ".code-understanding/structure-docs");
  const definitionName = markdownFilename(values.get("--definition-output") ?? "クラス定義書.md");
  const diagramName = markdownFilename(values.get("--diagram-output") ?? "クラス図.md");
  return {
    snapshotPath: resolve(cwd, values.get("--snapshot") ?? ".code-understanding/symbol-index.json"),
    outputPath: output,
    definitionOutput: resolve(output, definitionName),
    diagramOutput: resolve(output, diagramName),
    filters: {
      path: pathPrefix(values.get("--path")),
      language: values.get("--language") ?? null,
      typeKind: kind,
      visibility,
      name: values.get("--name") ?? null,
      includeNonPublic,
      omitDiagramMembers,
      maxTypes: positiveInteger(values.get("--max-types") ?? "100"),
      splitSize: positiveInteger(values.get("--split-size") ?? "50"),
      splitBy
    }
  };
}
