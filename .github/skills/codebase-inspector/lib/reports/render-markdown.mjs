import { normalizeText } from "../output/stable-json.mjs";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSymbols(left, right, ownerFor = () => "") {
  return compareText(left.filePath, right.filePath)
    || left.lineRange[0] - right.lineRange[0]
    || compareText(ownerFor(left), ownerFor(right))
    || compareText(left.name, right.name)
    || compareText(left.id, right.id);
}

function cell(value) {
  if (value === null) return "-";
  return normalizeText(String(value)).replaceAll("\n", " ").replaceAll("|", "\\|");
}

function lineRange([start, end]) {
  return start === end ? String(start) : `${start}-${end}`;
}

function parameters(values) {
  if (values.length === 0) return "-";
  return values.map((parameter) => `${cell(parameter.name)}: ${cell(parameter.type)}`).join(", ");
}

function table(title, header, alignment, rows) {
  return `${[title, "", header, alignment, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n").replace(/\n+$/, "")}\n`;
}

export function renderMarkdownIndexes(symbolIndex) {
  const typeById = new Map(symbolIndex.types.map((type) => [type.id, type]));
  const classes = [...symbolIndex.types]
    .sort((left, right) => compareSymbols(left, right))
    .map((type) => [cell(type.name), cell(type.kind), cell(type.filePath), lineRange(type.lineRange), String(type.methodIds.length), String(type.properties.length)]);
  const methods = [...symbolIndex.methods]
    .sort((left, right) => compareSymbols(left, right, (method) => typeById.get(method.ownerTypeId)?.name ?? ""))
    .map((method) => [cell(typeById.get(method.ownerTypeId)?.name ?? null), cell(method.name), cell(method.filePath), lineRange(method.lineRange), parameters(method.parameters), cell(method.returnType)]);
  const functions = [...symbolIndex.functions]
    .sort((left, right) => compareSymbols(left, right))
    .map((func) => [cell(func.name), cell(func.filePath), lineRange(func.lineRange), parameters(func.parameters), cell(func.returnType)]);

  return {
    "classes.md": table("# Classes", "| Name | Kind | File | Lines | Methods | Properties |", "|---|---|---|---:|---:|---:|", classes),
    "methods.md": table("# Methods", "| Owner | Method | File | Lines | Parameters | Return |", "|---|---|---|---:|---|---|", methods),
    "functions.md": table("# Functions", "| Function | File | Lines | Parameters | Return |", "|---|---|---:|---|---|", functions)
  };
}
