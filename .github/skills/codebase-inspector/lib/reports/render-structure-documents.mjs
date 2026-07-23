import { createHash } from "node:crypto";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function text(value) {
  return String(value).replaceAll("\r", "").replaceAll("\n", " ");
}

function code(value) {
  const valueText = text(value).replaceAll("|", "\\|");
  const longestRun = Math.max(0, ...(valueText.match(/`+/g) ?? []).map((match) => match.length));
  const fence = "`".repeat(longestRun + 1);
  const padding = valueText.startsWith("`") || valueText.endsWith("`") ? " " : "";
  return `${fence}${padding}${valueText}${padding}${fence}`;
}

function fact(value, status) {
  if (status === "unsupported") return "parser未対応";
  if (status === "failed") return "解析失敗";
  if (status === "not-declared" || value === null || value === undefined || value === "") return "記載なし";
  return code(value);
}

function parameter(parameter) {
  const prefix = parameter.variadic ? "..." : "";
  const suffix = parameter.optional ? "?" : "";
  const name = `${prefix}${parameter.name}${suffix}`;
  if (parameter.typeStatus === "known" && parameter.type) return code(`${name}: ${parameter.type}`);
  return `${code(name)}: ${fact(parameter.type, parameter.typeStatus)}`;
}

function methodName(method) {
  if (method.kind === "constructor") return "constructor";
  if (method.kind === "method") return code(method.name);
  if (method.kind === "operator" && method.name.startsWith("operator")) return code(method.name);
  return code(`${method.kind} ${method.name}`);
}

function methodReturn(method) {
  return method.kind === "constructor" ? "なし" : fact(method.returnType, method.returnTypeStatus);
}

function typeSection(view) {
  const type = view.type;
  const lines = [
    `### ${code(type.qualifiedName)}`,
    "",
    "#### クラス基本情報",
    "",
    `- **クラス名**: ${code(type.name)}`,
    `- **種別**: ${type.kind}`,
    `- **ファイル**: ${code(type.filePath)}`
  ];
  if (type.package) lines.push(`- **package**: ${code(type.package)}`);
  if (type.namespace) lines.push(`- **namespace**: ${code(type.namespace)}`);
  if (type.module) lines.push(`- **module**: ${code(type.module)}`);
  if (type.extends.length) lines.push(`- **継承**: ${type.extends.map(code).join(", ")}`);
  if (type.implements.length) lines.push(`- **実装**: ${type.implements.map(code).join(", ")}`);
  if (type.mixins.length) lines.push(`- **mixin**: ${type.mixins.map(code).join(", ")}`);

  if (view.properties.length > 0) {
    const enumMembers = view.properties.filter((property) => property.kind === "enum-member");
    const attributes = view.properties.filter((property) => property.kind !== "enum-member");
    if (attributes.length > 0) {
      lines.push("", "#### 属性", "", "| 名前 | 型 |", "|---|---|");
      attributes.forEach((property) => lines.push(`| ${code(property.name)} | ${fact(property.type, property.typeStatus)} |`));
    }
    if (enumMembers.length > 0) {
      lines.push("", "#### 列挙値", "", "| 名前 | 値 |", "|---|---|");
      enumMembers.forEach((property) => lines.push(`| ${code(property.name)} | ${property.explicitValue === null ? "記載なし" : code(property.explicitValue)} |`));
    }
  }
  if (view.methods.length > 0) {
    lines.push("", "#### メソッド", "", "| メソッド名 | 引数 | 戻り値 |", "|---|---|---|");
    view.methods.forEach((method) => {
      const parameters = method.parameters.length ? method.parameters.map(parameter).join(", ") : "なし";
      lines.push(`| ${methodName(method)} | ${parameters} | ${methodReturn(method)} |`);
    });
  }
  return lines.join("\n");
}

function definitionDocument(views, title = "クラス定義書") {
  const classifications = new Map();
  for (const view of views) {
    const entries = classifications.get(view.classification) ?? [];
    entries.push(view);
    classifications.set(view.classification, entries);
  }
  const groups = [...classifications].sort(([left], [right]) => compareText(left, right));
  const lines = [`# ${title}`, "", "## 目次", ""];
  groups.forEach(([name], index) => {
    const anchor = name.normalize("NFKC").toLocaleLowerCase()
      .replace(/[^\p{L}\p{N} _-]+/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    lines.push(`${index + 1}. [${code(name)}](#${anchor})`);
  });
  for (const [name, entries] of groups) {
    lines.push("", `## ${code(name)}`, "");
    lines.push(entries.map(typeSection).join("\n\n"));
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function alias(id, prefix = "T") {
  return `${prefix}_${createHash("sha256").update(id).digest("hex").slice(0, 10)}`;
}

function mermaidText(value) {
  return text(value).replaceAll('"', "'").replaceAll("<", "~").replaceAll(">", "~").replaceAll("{", "(").replaceAll("}", ")");
}

function mermaidMemberType(type, status) {
  if (status !== "known" || !type) return "";
  return `: ${mermaidText(type)}`;
}

function mermaidVisibility(visibility) {
  if (visibility === "private") return "-";
  if (visibility === "protected") return "#";
  if (visibility === "internal" || visibility === "package") return "~";
  return "+";
}

function mermaidMethodName(type, method) {
  if (method.kind === "constructor") return type.name;
  if (method.kind === "method") return method.name;
  if (method.kind === "operator" && method.name.startsWith("operator")) return method.name;
  return `${method.kind} ${method.name}`;
}

function relationSourceType(relation, propertyById, methodById) {
  return propertyById.get(relation.sourceId)?.ownerTypeId
    ?? methodById.get(relation.sourceId)?.ownerTypeId
    ?? relation.sourceId;
}

function diagramDocument(selection, symbolIndex, filters, title = "クラス図") {
  const typeById = new Map(selection.views.map((view) => [view.type.id, view.type]));
  const propertyById = new Map(symbolIndex.properties.map((property) => [property.id, property]));
  const methodById = new Map(symbolIndex.methods.map((method) => [method.id, method]));
  const lines = [`# ${title}`, "", "```mermaid", "classDiagram", "  direction LR", ""];
  for (const view of selection.views) {
    const type = view.type;
    const typeAlias = alias(type.id);
    lines.push(`  class ${typeAlias}["${mermaidText(type.qualifiedName)}"] {`);
    if (type.kind !== "class") lines.push(`    <<${type.kind === "enum" ? "enumeration" : type.kind}>>`);
    if (!filters.omitDiagramMembers) {
      view.properties.forEach((property) => {
        const value = property.kind === "enum-member" && property.explicitValue !== null ? ` = ${mermaidText(property.explicitValue)}` : "";
        lines.push(`    ${mermaidVisibility(property.visibility)}${mermaidText(property.name)}${mermaidMemberType(property.type, property.typeStatus)}${value}`);
      });
      view.methods.forEach((method) => {
        const params = method.parameters.map((entry) => {
          const typeValue = entry.typeStatus === "known" && entry.type ? `: ${mermaidText(entry.type)}` : "";
          return `${mermaidText(entry.name)}${typeValue}`;
        }).join(", ");
        const returnValue = method.kind === "constructor" || method.returnTypeStatus !== "known" || !method.returnType
          ? ""
          : ` ${mermaidText(method.returnType)}`;
        lines.push(`    ${mermaidVisibility(method.visibility)}${mermaidText(mermaidMethodName(type, method))}(${params})${returnValue}`);
      });
    }
    lines.push("  }", "");
  }

  const external = new Map();
  const relationLines = [];
  for (const relation of selection.relations) {
    const sourceTypeId = relationSourceType(relation, propertyById, methodById);
    if (!typeById.has(sourceTypeId)) continue;
    const sourceAlias = alias(sourceTypeId);
    let targetAlias;
    if (relation.targetId && typeById.has(relation.targetId)) targetAlias = alias(relation.targetId);
    else {
      targetAlias = alias(`${relation.targetCategory}:${relation.targetName}`, "E");
      external.set(targetAlias, relation.targetName);
    }
    if (relation.kind === "inherits") relationLines.push(`  ${targetAlias} <|-- ${sourceAlias} : extends`);
    else if (relation.kind === "implements") relationLines.push(`  ${targetAlias} <|.. ${sourceAlias} : implements`);
    else if (relation.kind === "mixin") relationLines.push(`  ${targetAlias} <|.. ${sourceAlias} : mixin`);
    else if (relation.kind === "nested") relationLines.push(`  ${targetAlias} ..> ${sourceAlias} : nested`);
    else relationLines.push(`  ${sourceAlias} ..> ${targetAlias}`);
  }
  for (const [externalAlias, name] of [...external].sort(([left], [right]) => compareText(left, right))) {
    lines.push(`  class ${externalAlias}["${mermaidText(name)}"] {`, "    <<external>>", "  }", "");
  }
  lines.push(...[...new Set(relationLines)].sort(), "```");
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function safeGroupName(value, index) {
  const normalized = value.normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${String(index + 1).padStart(3, "0")}-${normalized || "group"}`;
}

export function renderStructureDocuments(symbolIndex, selection, filters) {
  const files = new Map();
  if (selection.views.length <= filters.splitSize && (filters.splitBy === "none" || selection.groups.size <= 1)) {
    files.set("クラス定義書.md", definitionDocument(selection.views));
    files.set("クラス図.md", diagramDocument(selection, symbolIndex, filters));
    return files;
  }

  const chunks = [];
  const propertyById = new Map(symbolIndex.properties.map((property) => [property.id, property]));
  const methodById = new Map(symbolIndex.methods.map((method) => [method.id, method]));
  for (const [groupName, views] of selection.groups) {
    for (let start = 0; start < views.length; start += filters.splitSize) {
      const page = Math.floor(start / filters.splitSize) + 1;
      const pageCount = Math.ceil(views.length / filters.splitSize);
      chunks.push({
        name: pageCount === 1 ? groupName : `${groupName} (${page}/${pageCount})`,
        views: views.slice(start, start + filters.splitSize)
      });
    }
  }
  const definitionIndex = ["# クラス定義書", "", "## 分割一覧", "", "| 対象 | 型件数 | ファイル |", "|---|---:|---|"];
  const diagramIndex = ["# クラス図", "", "## 分割一覧", "", "| 対象 | 型件数 | ファイル |", "|---|---:|---|"];
  chunks.forEach(({ name: groupName, views }, index) => {
    const base = safeGroupName(groupName, index);
    const definitionName = `クラス定義書-${base}.md`;
    const diagramName = `クラス図-${base}.md`;
    const typeIds = new Set(views.map((view) => view.type.id));
    const groupSelection = {
      ...selection,
      views,
      typeIds,
      relations: selection.relations.filter((relation) => (
        typeIds.has(relationSourceType(relation, propertyById, methodById))
      ))
    };
    files.set(definitionName, definitionDocument(views, `クラス定義書: ${groupName}`));
    files.set(diagramName, diagramDocument(groupSelection, symbolIndex, filters, `クラス図: ${groupName}`));
    definitionIndex.push(`| ${code(groupName)} | ${views.length} | [${code(definitionName)}](./${encodeURI(definitionName)}) |`);
    diagramIndex.push(`| ${code(groupName)} | ${views.length} | [${code(diagramName)}](./${encodeURI(diagramName)}) |`);
  });
  files.set("クラス定義書.md", `${definitionIndex.join("\n")}\n`);
  files.set("クラス図.md", `${diagramIndex.join("\n")}\n`);
  return files;
}
