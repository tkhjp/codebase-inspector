// Adapted from Egonex-AI/Understand-Anything at 54754a6f97051d1d76c8758353d8ea41afe502a6.
// Original project and this adaptation are licensed under MIT; see repository NOTICE.

import { findChild, findChildren } from "./base-extractor.mjs";

const SAFE_NAME_TYPES = new Set(["identifier", "type_identifier", "field_identifier"]);
const PATH_KEYWORDS = new Set(["crate", "self", "super"]);

function lineRange(node) {
  return [node.startPosition.row + 1, node.endPosition.row + 1];
}

function childOfType(node, ...types) {
  return node?.namedChildren.find((child) => types.includes(child.type)) ?? null;
}

function hasToken(node, type) {
  return node?.children.some((child) => child.type === type) ?? false;
}

function addWarning(warnings, warningSet, message) {
  if (warningSet.has(message)) return;
  warningSet.add(message);
  warnings.push(message);
}

function safeName(node) {
  return node && SAFE_NAME_TYPES.has(node.type) ? node.text : null;
}

function renderPath(node) {
  if (!node) return null;
  const direct = safeName(node);
  if (direct) return direct;
  if (PATH_KEYWORDS.has(node.type)) return node.type;

  if (["scoped_identifier", "scoped_type_identifier"].includes(node.type)) {
    const path = renderPath(node.childForFieldName("path") ?? node.namedChildren[0]);
    const name = renderPath(node.childForFieldName("name") ?? node.namedChildren.at(-1));
    return path && name ? `${path}::${name}` : null;
  }

  return null;
}

function renderTypeArguments(node) {
  if (!node || node.type !== "type_arguments") return null;
  const values = node.namedChildren.map(renderType).filter(Boolean);
  return values.length === node.namedChildren.length ? `<${values.join(", ")}>` : null;
}

function renderRustFields(node) {
  const fields = findChildren(node, "field_declaration");
  const values = [];
  for (const field of fields) {
    const name = safeName(field.childForFieldName("name"));
    const type = renderType(field.childForFieldName("type"));
    if (!name || !type) return null;
    values.push(`${name}: ${type}`);
  }
  return `{ ${values.join(", ")} }`;
}

function renderFunctionType(node) {
  const parametersNode = node.childForFieldName("parameters");
  const parameterTypes = parametersNode?.namedChildren.map((parameter) => (
    renderType(parameter.childForFieldName("type") ?? parameter)
  )).filter(Boolean) ?? [];
  if (parametersNode && parameterTypes.length !== parametersNode.namedChildren.length) return null;
  const returnNode = node.childForFieldName("return_type");
  const returnType = returnNode ? renderType(returnNode) : null;
  if (returnNode && !returnType) return null;
  return `fn(${parameterTypes.join(", ")})${returnType ? ` -> ${returnType}` : ""}`;
}

function renderType(node) {
  if (!node) return null;
  if (node.type === "type") return renderType(node.namedChildren[0]);
  if (node.type === "primitive_type" || node.type === "never_type") return node.text;
  if (node.type === "lifetime") return /^'[A-Za-z_]\w*$/.test(node.text) ? node.text : null;

  const path = renderPath(node);
  if (path) return path;

  if (["generic_type", "generic_type_with_turbofish"].includes(node.type)) {
    const name = renderPath(node.childForFieldName("type") ?? node.namedChildren[0]);
    const argumentsList = renderTypeArguments(node.childForFieldName("type_arguments") ?? childOfType(node, "type_arguments"));
    return name && argumentsList ? `${name}${node.type === "generic_type_with_turbofish" ? "::" : ""}${argumentsList}` : null;
  }

  if (node.type === "reference_type") {
    const type = renderType(node.childForFieldName("type") ?? node.namedChildren.at(-1));
    if (!type) return null;
    const lifetime = childOfType(node, "lifetime");
    const renderedLifetime = lifetime ? renderType(lifetime) : null;
    if (lifetime && !renderedLifetime) return null;
    return `&${renderedLifetime ? `${renderedLifetime} ` : ""}${hasToken(node, "mut") ? "mut " : ""}${type}`;
  }

  if (node.type === "pointer_type") {
    const type = renderType(node.childForFieldName("type") ?? node.namedChildren.at(-1));
    if (!type) return null;
    return `*${hasToken(node, "const") ? "const" : "mut"} ${type}`;
  }

  if (node.type === "tuple_type") {
    const values = node.namedChildren.map(renderType).filter(Boolean);
    if (values.length !== node.namedChildren.length) return null;
    if (values.length === 1) return `(${values[0]},)`;
    return `(${values.join(", ")})`;
  }

  if (node.type === "slice_type") {
    const element = renderType(node.childForFieldName("element") ?? node.namedChildren[0]);
    return element ? `[${element}]` : null;
  }

  if (node.type === "array_type") {
    const element = renderType(node.childForFieldName("element"));
    const lengthNode = node.childForFieldName("length");
    const length = lengthNode?.type === "integer_literal" && /^(?:0|[1-9]\d*)(?:_\d+)*$/.test(lengthNode.text)
      ? lengthNode.text
      : safeName(lengthNode);
    return element && length ? `[${element}; ${length}]` : null;
  }

  if (node.type === "function_type") return renderFunctionType(node);

  if (node.type === "parenthesized_type") {
    const type = renderType(node.namedChildren[0]);
    return type ? `(${type})` : null;
  }

  if (node.type === "ordered_field_declaration_list") {
    const values = node.namedChildren.map(renderType).filter(Boolean);
    if (values.length !== node.namedChildren.length) return null;
    return values.length === 1 ? values[0] : `(${values.join(", ")})`;
  }

  if (node.type === "field_declaration_list") return renderRustFields(node);
  return null;
}

function renderPattern(node) {
  if (!node) return null;
  const direct = safeName(node);
  if (direct) return direct;
  if (node.type === "mut_pattern") {
    const pattern = renderPattern(node.namedChildren.at(-1));
    return pattern ? `mut ${pattern}` : null;
  }
  if (node.type === "reference_pattern") {
    const pattern = renderPattern(node.namedChildren.at(-1));
    return pattern ? `&${hasToken(node, "mut") ? "mut " : ""}${pattern}` : null;
  }
  return null;
}

function extractParameters(paramsNode, warnType) {
  if (!paramsNode) return { parameters: [], hasReceiver: false };
  const parameters = [];
  let hasReceiver = false;

  for (const child of paramsNode.namedChildren) {
    if (child.type === "self_parameter") {
      hasReceiver = true;
      continue;
    }
    if (child.type !== "parameter") continue;
    const name = renderPattern(child.childForFieldName("pattern"));
    const typeNode = child.childForFieldName("type");
    const type = renderType(typeNode);
    if (typeNode && !type) warnType(typeNode);
    if (name) parameters.push({ name, type });
  }

  return { parameters, hasReceiver };
}

function visibility(node, implicitPublic = false) {
  return implicitPublic || findChild(node, "visibility_modifier") ? "public" : "private";
}

function isPublic(node) {
  return visibility(node) === "public";
}

function isAsync(node) {
  const modifiers = findChild(node, "function_modifiers");
  return hasToken(modifiers, "async");
}

function extractCallable(node, ownerName, warnType, { implicitPublic = false, parentExported = false } = {}) {
  const name = safeName(node.childForFieldName("name"));
  if (!name) return null;
  const { parameters, hasReceiver } = extractParameters(node.childForFieldName("parameters"), warnType);
  const returnNode = node.childForFieldName("return_type");
  const returnType = renderType(returnNode);
  if (returnNode && !returnType) warnType(returnNode);
  const callableVisibility = visibility(node, implicitPublic);
  const exported = implicitPublic ? parentExported : callableVisibility === "public";
  const common = {
    name,
    lineRange: lineRange(node),
    parameters,
    returnType,
    visibility: callableVisibility,
    async: isAsync(node),
    exported
  };
  return ownerName ? { ...common, ownerName, static: !hasReceiver } : common;
}

function extractStructProperties(node, warnType) {
  const properties = [];
  const body = node.childForFieldName("body");
  for (const field of body ? findChildren(body, "field_declaration") : []) {
    const name = safeName(field.childForFieldName("name"));
    const typeNode = field.childForFieldName("type");
    const type = renderType(typeNode);
    if (typeNode && !type) warnType(typeNode);
    if (!name) continue;
    properties.push({
      name,
      type,
      visibility: visibility(field),
      static: false,
      lineRange: lineRange(field)
    });
  }
  return properties;
}

function extractEnumProperties(node, warnType) {
  const properties = [];
  const body = node.childForFieldName("body");
  for (const variant of body ? findChildren(body, "enum_variant") : []) {
    const name = safeName(variant.childForFieldName("name"));
    const typeNode = variant.childForFieldName("body");
    const type = renderType(typeNode);
    if (typeNode && !type) warnType(typeNode);
    if (!name) continue;
    properties.push({ name, type, visibility: "public", static: true, lineRange: lineRange(variant) });
  }
  return properties;
}

function implOwnerName(node) {
  const typeNode = node.childForFieldName("type");
  if (!typeNode) return null;
  if (["generic_type", "generic_type_with_turbofish"].includes(typeNode.type)) {
    return renderPath(typeNode.childForFieldName("type") ?? typeNode.namedChildren[0]);
  }
  return renderPath(typeNode);
}

function importPathAndName(node) {
  if (!node) return null;
  const direct = renderPath(node);
  if (direct && !["scoped_identifier", "scoped_type_identifier"].includes(node.type)) {
    return { source: direct, specifier: direct };
  }
  if (["scoped_identifier", "scoped_type_identifier"].includes(node.type)) {
    const source = renderPath(node.childForFieldName("path"));
    const specifier = renderPath(node.childForFieldName("name"));
    return source && specifier ? { source, specifier } : null;
  }
  return null;
}

function extractUseDeclaration(node) {
  const argument = node.childForFieldName("argument");
  if (!argument) return null;
  const simple = importPathAndName(argument);
  if (simple) {
    return { source: simple.source, specifiers: [simple.specifier], lineNumber: node.startPosition.row + 1, kind: "module" };
  }

  if (argument.type === "scoped_use_list") {
    const source = renderPath(argument.childForFieldName("path"));
    const list = argument.childForFieldName("list");
    if (!source || !list) return null;
    const specifiers = [];
    for (const child of list.namedChildren) {
      if (child.type === "self") specifiers.push("self");
      else if (child.type === "use_as_clause") {
        const alias = renderPath(child.childForFieldName("alias"));
        if (alias) specifiers.push(alias);
      } else {
        const value = renderPath(child);
        if (value) specifiers.push(value);
      }
    }
    return { source, specifiers, lineNumber: node.startPosition.row + 1, kind: "module" };
  }

  if (argument.type === "use_wildcard") {
    const source = renderPath(childOfType(argument, "scoped_identifier", "identifier"));
    return source ? { source, specifiers: ["*"], lineNumber: node.startPosition.row + 1, kind: "module" } : null;
  }
  return null;
}

function renderCallee(node) {
  if (!node) return null;
  const direct = renderPath(node);
  if (direct) return direct;
  if (node.type === "field_expression") {
    const value = renderCallee(node.childForFieldName("value"));
    const field = safeName(node.childForFieldName("field"));
    return value && field ? `${value}.${field}` : null;
  }
  if (node.type === "generic_function") {
    const callable = renderCallee(node.childForFieldName("function"));
    const argumentsList = renderTypeArguments(node.childForFieldName("type_arguments"));
    return callable && argumentsList ? `${callable}::${argumentsList}` : null;
  }
  if (node.type === "parenthesized_expression") return renderCallee(node.namedChildren[0]);
  return null;
}

function callTraversalChildren(node) {
  if (["struct_item", "enum_item", "use_declaration"].includes(node.type)) return [];
  if (["function_item", "function_signature_item"].includes(node.type)) {
    const body = node.childForFieldName("body");
    return body ? [body] : [];
  }
  if (["impl_item", "trait_item"].includes(node.type)) {
    const body = node.childForFieldName("body");
    return body ? [body] : [];
  }
  return node.namedChildren;
}

function extractCalls(rootNode, warnCallTarget) {
  const calls = [];
  const visit = (node, context) => {
    let current = context;
    if (node.type === "impl_item") current = { ...current, ownerName: implOwnerName(node) };
    if (node.type === "trait_item") current = { ...current, ownerName: safeName(node.childForFieldName("name")) };
    if (["function_item", "function_signature_item"].includes(node.type)) {
      current = { ...current, callerName: safeName(node.childForFieldName("name")) };
    }
    if (node.type === "call_expression") {
      const target = node.childForFieldName("function") ?? node.namedChildren[0];
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

export class RustExtractor {
  extract(rootNode, context) {
    const types = [];
    const methods = [];
    const functions = [];
    const importCandidates = [];
    const warnings = [];
    const warningSet = new Set();
    const warnType = (node) => addWarning(warnings, warningSet, `Skipped dynamic Rust type at line ${node.startPosition.row + 1}`);
    const warnCallTarget = (node) => addWarning(warnings, warningSet, `Skipped dynamic Rust call target at line ${node.startPosition.row + 1}`);

    for (const node of rootNode.namedChildren) {
      if (["struct_item", "enum_item", "trait_item"].includes(node.type)) {
        const name = safeName(node.childForFieldName("name"));
        if (!name) continue;
        const kind = node.type === "struct_item" ? "struct" : node.type === "enum_item" ? "enum" : "trait";
        const properties = kind === "struct"
          ? extractStructProperties(node, warnType)
          : kind === "enum" ? extractEnumProperties(node, warnType) : [];
        const exported = isPublic(node);
        types.push({ kind, name, lineRange: lineRange(node), properties, extends: [], implements: [], exported });

        if (kind === "trait") {
          const body = node.childForFieldName("body");
          for (const member of body?.namedChildren ?? []) {
            if (!["function_item", "function_signature_item"].includes(member.type)) continue;
            const method = extractCallable(member, name, warnType, { implicitPublic: true, parentExported: exported });
            if (method) methods.push(method);
          }
        }
      } else if (node.type === "impl_item") {
        const ownerName = implOwnerName(node);
        const body = node.childForFieldName("body");
        if (!ownerName || !body) continue;
        for (const member of body.namedChildren) {
          if (member.type !== "function_item") continue;
          const method = extractCallable(member, ownerName, warnType);
          if (method) methods.push(method);
        }
      } else if (node.type === "function_item") {
        const callable = extractCallable(node, null, warnType);
        if (callable) functions.push(callable);
      } else if (node.type === "use_declaration") {
        const candidate = extractUseDeclaration(node);
        if (candidate) importCandidates.push(candidate);
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
