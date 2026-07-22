// Adapted from Egonex-AI/Understand-Anything at 54754a6f97051d1d76c8758353d8ea41afe502a6.
// Original project and this adaptation are licensed under MIT; see repository NOTICE.

import { findChild, findChildren } from "./base-extractor.mjs";

const SAFE_NAME_TYPES = new Set(["identifier", "type_identifier", "field_identifier", "package_identifier"]);

function lineRange(node) {
  return [node.startPosition.row + 1, node.endPosition.row + 1];
}

function childOfType(node, ...types) {
  return node?.namedChildren.find((child) => types.includes(child.type)) ?? null;
}

function addWarning(warnings, warningSet, message) {
  if (warningSet.has(message)) return;
  warningSet.add(message);
  warnings.push(message);
}

function safeName(node) {
  return node && SAFE_NAME_TYPES.has(node.type) ? node.text : null;
}

function renderTypeArguments(node) {
  if (!node || node.type !== "type_arguments") return null;
  const values = node.namedChildren.map(renderType).filter(Boolean);
  return values.length === node.namedChildren.length ? `[${values.join(", ")}]` : null;
}

function renderGoFields(node) {
  const values = [];
  for (const field of findChildren(node, "field_declaration")) {
    const type = renderType(field.childForFieldName("type"));
    const names = field.namedChildren
      .filter((child) => child.type === "field_identifier")
      .map(safeName)
      .filter(Boolean);
    if (!type || names.length === 0) return null;
    values.push(`${names.join(", ")} ${type}`);
  }
  return `struct { ${values.join("; ")} }`;
}

function renderParameterDeclaration(node) {
  if (!node) return null;
  const type = renderType(node.childForFieldName("type") ?? node.namedChildren.at(-1));
  if (!type) return null;
  const names = node.namedChildren
    .filter((child) => child.type === "identifier")
    .map(safeName)
    .filter(Boolean);
  const renderedType = node.type === "variadic_parameter_declaration" ? `...${type}` : type;
  return names.length > 0 ? `${names.join(", ")} ${renderedType}` : renderedType;
}

function renderParameterList(node) {
  const declarations = node.namedChildren.filter((child) => (
    ["parameter_declaration", "variadic_parameter_declaration"].includes(child.type)
  ));
  const values = declarations.map(renderParameterDeclaration).filter(Boolean);
  return values.length === declarations.length ? `(${values.join(", ")})` : null;
}

function renderFunctionType(node) {
  const parameters = renderParameterList(node.childForFieldName("parameters"));
  if (!parameters) return null;
  const resultNode = node.childForFieldName("result");
  const result = resultNode ? renderType(resultNode) : null;
  if (resultNode && !result) return null;
  return `func${parameters}${result ? ` ${result}` : ""}`;
}

function renderType(node) {
  if (!node) return null;
  if (["type_elem", "type_constraint"].includes(node.type)) return renderType(node.namedChildren[0]);
  const direct = safeName(node);
  if (direct) return direct;

  if (node.type === "qualified_type") {
    const packageName = safeName(node.childForFieldName("package") ?? node.namedChildren[0]);
    const name = safeName(node.childForFieldName("name") ?? node.namedChildren.at(-1));
    return packageName && name ? `${packageName}.${name}` : null;
  }

  if (node.type === "generic_type") {
    const name = renderType(node.childForFieldName("type") ?? node.namedChildren[0]);
    const argumentsList = renderTypeArguments(node.childForFieldName("type_arguments") ?? childOfType(node, "type_arguments"));
    return name && argumentsList ? `${name}${argumentsList}` : null;
  }

  if (node.type === "pointer_type") {
    const type = renderType(node.namedChildren[0]);
    return type ? `*${type}` : null;
  }

  if (node.type === "slice_type") {
    const element = renderType(node.childForFieldName("element") ?? node.namedChildren[0]);
    return element ? `[]${element}` : null;
  }

  if (node.type === "array_type") {
    const element = renderType(node.childForFieldName("element"));
    const lengthNode = node.childForFieldName("length");
    const length = lengthNode?.type === "int_literal" && /^(?:0|[1-9]\d*)(?:_\d+)*$/.test(lengthNode.text)
      ? lengthNode.text
      : safeName(lengthNode);
    return element && length ? `[${length}]${element}` : null;
  }

  if (node.type === "map_type") {
    const key = renderType(node.childForFieldName("key"));
    const value = renderType(node.childForFieldName("value"));
    return key && value ? `map[${key}]${value}` : null;
  }

  if (node.type === "channel_type") {
    const value = renderType(node.childForFieldName("value") ?? node.namedChildren.at(-1));
    if (!value) return null;
    const tokens = node.children.map((child) => child.type);
    if (tokens[0] === "<-") return `<-chan ${value}`;
    return tokens.includes("<-") ? `chan<- ${value}` : `chan ${value}`;
  }

  if (node.type === "parameter_list") return renderParameterList(node);
  if (node.type === "function_type") return renderFunctionType(node);
  if (node.type === "struct_type") return renderGoFields(findChild(node, "field_declaration_list"));

  if (node.type === "parenthesized_type") {
    const type = renderType(node.namedChildren[0]);
    return type ? `(${type})` : null;
  }
  return null;
}

function isExported(name) {
  return /^\p{Lu}/u.test(name);
}

function visibility(name) {
  return isExported(name) ? "public" : "private";
}

function extractParameters(paramsNode, warnType) {
  const parameters = [];
  if (!paramsNode) return parameters;

  for (const declaration of paramsNode.namedChildren) {
    if (!["parameter_declaration", "variadic_parameter_declaration"].includes(declaration.type)) continue;
    const typeNode = declaration.childForFieldName("type") ?? declaration.namedChildren.at(-1);
    const rendered = renderType(typeNode);
    const type = rendered && declaration.type === "variadic_parameter_declaration" ? `...${rendered}` : rendered;
    if (typeNode && !type) warnType(typeNode);
    const names = declaration.namedChildren
      .filter((child) => child.type === "identifier")
      .map(safeName)
      .filter(Boolean);
    for (const name of names) parameters.push({ name, type });
  }
  return parameters;
}

function extractCallable(node, ownerName, warnType) {
  const name = safeName(node.childForFieldName("name"));
  if (!name) return null;
  const resultNode = node.childForFieldName("result");
  const returnType = renderType(resultNode);
  if (resultNode && !returnType) warnType(resultNode);
  const common = {
    name,
    lineRange: lineRange(node),
    parameters: extractParameters(node.childForFieldName("parameters"), warnType),
    returnType,
    visibility: visibility(name),
    async: null,
    exported: isExported(name)
  };
  return ownerName ? { ...common, ownerName, static: false } : common;
}

function receiverOwnerName(node) {
  const receiver = node.childForFieldName("receiver");
  const declaration = receiver ? findChild(receiver, "parameter_declaration") : null;
  let type = declaration?.childForFieldName("type") ?? null;
  while (type && ["pointer_type", "parenthesized_type"].includes(type.type)) type = type.namedChildren[0] ?? null;
  if (type?.type === "generic_type") type = type.childForFieldName("type") ?? type.namedChildren[0];
  return safeName(type);
}

function extractStructProperties(structNode, warnType) {
  const properties = [];
  const fieldList = findChild(structNode, "field_declaration_list");
  for (const field of fieldList ? findChildren(fieldList, "field_declaration") : []) {
    const typeNode = field.childForFieldName("type");
    const type = renderType(typeNode);
    if (typeNode && !type) warnType(typeNode);
    for (const nameNode of field.namedChildren.filter((child) => child.type === "field_identifier")) {
      const name = safeName(nameNode);
      if (!name) continue;
      properties.push({
        name,
        type,
        visibility: visibility(name),
        static: false,
        lineRange: lineRange(field)
      });
    }
  }
  return properties;
}

function importSource(pathNode) {
  const content = childOfType(pathNode, "interpreted_string_literal_content", "raw_string_literal_content");
  return content?.text || null;
}

function extractImportSpec(spec) {
  const pathNode = spec.childForFieldName("path");
  const source = importSource(pathNode);
  if (!source) return null;
  const aliasNode = spec.childForFieldName("name");
  let specifier = safeName(aliasNode);
  if (!specifier && aliasNode?.type === "dot") specifier = ".";
  if (!specifier && aliasNode?.type === "blank_identifier") specifier = "_";
  if (!specifier) specifier = source.split("/").at(-1);
  return { source, specifiers: [specifier], lineNumber: spec.startPosition.row + 1, kind: "module" };
}

function extractImports(node) {
  const list = findChild(node, "import_spec_list");
  const specs = list ? findChildren(list, "import_spec") : findChildren(node, "import_spec");
  return specs.map(extractImportSpec).filter(Boolean);
}

function renderCallee(node) {
  if (!node) return null;
  if (node.type === "identifier") return safeName(node);
  if (node.type === "selector_expression") {
    const operand = renderCallee(node.childForFieldName("operand"));
    const field = safeName(node.childForFieldName("field"));
    return operand && field ? `${operand}.${field}` : null;
  }
  if (node.type === "parenthesized_expression") return renderCallee(node.namedChildren[0]);
  return null;
}

function callTraversalChildren(node) {
  if (["type_declaration", "import_declaration", "method_elem"].includes(node.type)) return [];
  if (["function_declaration", "method_declaration"].includes(node.type)) {
    const body = node.childForFieldName("body");
    return body ? [body] : [];
  }
  if (node.type === "composite_literal") {
    const body = node.childForFieldName("body");
    return body ? [body] : [];
  }
  return node.namedChildren;
}

function extractCalls(rootNode, warnCallTarget) {
  const calls = [];
  const visit = (node, context) => {
    let current = context;
    if (node.type === "function_declaration") {
      current = { callerName: safeName(node.childForFieldName("name")), ownerName: null };
    } else if (node.type === "method_declaration") {
      current = {
        callerName: safeName(node.childForFieldName("name")),
        ownerName: receiverOwnerName(node)
      };
    }

    if (node.type === "call_expression") {
      const target = node.childForFieldName("function");
      const callee = renderCallee(target);
      if (callee) {
        calls.push({
          callerName: current.callerName,
          callerOwnerName: current.ownerName,
          calleeText: callee,
          lineNumber: node.startPosition.row + 1
        });
      } else {
        warnCallTarget(node);
      }
    }

    for (const child of callTraversalChildren(node)) visit(child, current);
  };
  visit(rootNode, { callerName: null, ownerName: null });
  return calls;
}

export class GoExtractor {
  extract(rootNode, context) {
    const types = [];
    const methods = [];
    const functions = [];
    const importCandidates = [];
    const warnings = [];
    const warningSet = new Set();
    const warnType = (node) => addWarning(warnings, warningSet, `Skipped dynamic Go type at line ${node.startPosition.row + 1}`);
    const warnCallTarget = (node) => addWarning(warnings, warningSet, `Skipped dynamic Go call target at line ${node.startPosition.row + 1}`);

    for (const node of rootNode.namedChildren) {
      if (node.type === "function_declaration") {
        const callable = extractCallable(node, null, warnType);
        if (callable) functions.push(callable);
      } else if (node.type === "method_declaration") {
        const ownerName = receiverOwnerName(node);
        const method = ownerName ? extractCallable(node, ownerName, warnType) : null;
        if (method) methods.push(method);
      } else if (node.type === "type_declaration") {
        const specs = node.namedChildren.filter((child) => child.type === "type_spec");
        for (const spec of specs) {
          const name = safeName(spec.childForFieldName("name"));
          const typeNode = spec.childForFieldName("type");
          if (!name || !typeNode || !["struct_type", "interface_type"].includes(typeNode.type)) continue;
          const kind = typeNode.type === "struct_type" ? "struct" : "interface";
          types.push({
            kind,
            name,
            lineRange: lineRange(node),
            properties: kind === "struct" ? extractStructProperties(typeNode, warnType) : [],
            extends: [],
            implements: [],
            exported: isExported(name)
          });
          if (kind === "interface") {
            for (const member of findChildren(typeNode, "method_elem")) {
              const method = extractCallable(member, name, warnType);
              if (method) methods.push(method);
            }
          }
        }
      } else if (node.type === "import_declaration") {
        importCandidates.push(...extractImports(node));
      }
    }

    return {
      filePath: context.filePath,
      language: context.language,
      types,
      methods,
      functions,
      importCandidates,
      callCandidates: extractCalls(rootNode, warnCallTarget),
      warnings
    };
  }
}
