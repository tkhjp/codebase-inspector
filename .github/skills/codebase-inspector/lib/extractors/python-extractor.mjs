// Adapted from Egonex-AI/Understand-Anything at 54754a6f97051d1d76c8758353d8ea41afe502a6.
// Original project and this adaptation are licensed under MIT; see repository NOTICE.

import { findChild } from "./base-extractor.mjs";

function lineRange(node) {
  return [node.startPosition.row + 1, node.endPosition.row + 1];
}

function unwrapDecorated(node) {
  if (node.type !== "decorated_definition") return node;
  return findChild(node, "function_definition") ?? findChild(node, "class_definition") ?? node;
}

function parameterName(node) {
  if (node.type === "identifier") return node.text;
  const splat = findChild(node, "list_splat_pattern") ?? findChild(node, "dictionary_splat_pattern");
  if (splat) return parameterName(splat);
  const identifier = node.childForFieldName("name") ?? findChild(node, "identifier");
  if (!identifier) return null;
  if (node.type === "list_splat_pattern") return `*${identifier.text}`;
  if (node.type === "dictionary_splat_pattern") return `**${identifier.text}`;
  return identifier.text;
}

function extractParameters(paramsNode) {
  if (!paramsNode) return [];
  const parameters = [];

  for (const child of paramsNode.namedChildren) {
    const name = parameterName(child);
    if (!name || name === "self" || name === "cls") continue;
    const typeNode = child.childForFieldName("type") ?? findChild(child, "type");
    parameters.push({ name, type: typeNode?.text ?? null });
  }

  return parameters;
}

function extractCallable(node, ownerName = null) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const common = {
    name: nameNode.text,
    lineRange: lineRange(node),
    parameters: extractParameters(node.childForFieldName("parameters")),
    returnType: nameNode.text === "__init__" ? null : node.childForFieldName("return_type")?.text ?? null,
    visibility: null,
    async: node.children.some((child) => child.type === "async"),
    exported: null
  };
  return ownerName ? { ...common, ownerName, static: null } : common;
}

function extractProperty(node) {
  if (node.type !== "expression_statement") return null;
  const assignment = findChild(node, "assignment");
  if (!assignment) return null;
  const nameNode = assignment.childForFieldName("left");
  const typeNode = assignment.childForFieldName("type");
  if (nameNode?.type !== "identifier" || !typeNode) return null;
  return {
    name: nameNode.text,
    type: typeNode.text,
    visibility: null,
    static: null,
    lineRange: lineRange(node)
  };
}

function extractSuperclasses(node) {
  const superclasses = node.childForFieldName("superclasses");
  if (!superclasses) return [];
  return superclasses.namedChildren
    .filter((child) => child.type !== "keyword_argument")
    .map((child) => child.text);
}

function importSpecifier(node) {
  if (node.type === "aliased_import") {
    const alias = node.childForFieldName("alias") ?? node.namedChildren.at(-1);
    return alias?.text ?? null;
  }
  return node.text;
}

function extractImport(node) {
  const candidates = [];
  for (const child of node.namedChildren) {
    if (!["dotted_name", "aliased_import"].includes(child.type)) continue;
    const sourceNode = child.type === "aliased_import" ? findChild(child, "dotted_name") : child;
    const specifier = importSpecifier(child);
    if (!sourceNode || !specifier) continue;
    candidates.push({
      source: sourceNode.text,
      specifiers: [specifier],
      lineNumber: node.startPosition.row + 1,
      kind: "module"
    });
  }
  return candidates;
}

function extractFromImport(node) {
  const moduleNode = node.childForFieldName("module_name");
  if (!moduleNode) return null;
  const specifiers = [];

  for (const child of node.namedChildren) {
    if (child.id === moduleNode.id) continue;
    if (["dotted_name", "aliased_import", "wildcard_import"].includes(child.type)) {
      const specifier = importSpecifier(child);
      if (specifier) specifiers.push(specifier);
    }
  }

  return {
    source: moduleNode.text,
    specifiers,
    lineNumber: node.startPosition.row + 1,
    kind: "module"
  };
}

function callableContext(node, context) {
  if (node.type === "class_definition") {
    return { ...context, ownerName: node.childForFieldName("name")?.text ?? null };
  }
  if (node.type === "function_definition") {
    return { ...context, callerName: node.childForFieldName("name")?.text ?? null };
  }
  return context;
}

function calleeText(node) {
  if (!node) return null;
  if (node.type === "identifier") return node.text;
  if (node.type === "parenthesized_expression") return calleeText(node.namedChildren[0]);
  if (node.type !== "attribute") return null;

  const object = calleeText(node.childForFieldName("object"));
  const attribute = node.childForFieldName("attribute");
  if (!object || attribute?.type !== "identifier") return null;
  return `${object}.${attribute.text}`;
}

function extractCalls(rootNode) {
  const calls = [];

  const visit = (node, context) => {
    const current = callableContext(node, context);
    if (node.type === "call") {
      const callee = calleeText(node.childForFieldName("function") ?? node.namedChildren[0]);
      if (callee) {
        calls.push({
          callerName: current.callerName,
          callerOwnerName: current.ownerName,
          calleeText: callee,
          lineNumber: node.startPosition.row + 1
        });
      }
    }
    for (const child of node.namedChildren) visit(child, current);
  };

  visit(rootNode, { callerName: null, ownerName: null });
  return calls;
}

export class PythonExtractor {
  extract(rootNode, context) {
    const types = [];
    const methods = [];
    const functions = [];
    const importCandidates = [];

    for (const outerNode of rootNode.namedChildren) {
      const node = unwrapDecorated(outerNode);

      if (node.type === "function_definition") {
        const callable = extractCallable(node);
        if (callable) functions.push(callable);
      } else if (node.type === "class_definition") {
        const name = node.childForFieldName("name")?.text;
        if (!name) continue;
        const properties = [];
        const body = node.childForFieldName("body");

        if (body) {
          for (const outerMember of body.namedChildren) {
            const member = unwrapDecorated(outerMember);
            if (member.type === "function_definition") {
              const method = extractCallable(member, name);
              if (method) methods.push(method);
            } else {
              const property = extractProperty(member);
              if (property) properties.push(property);
            }
          }
        }

        types.push({
          kind: "class",
          name,
          lineRange: lineRange(node),
          properties,
          extends: extractSuperclasses(node),
          implements: [],
          exported: null
        });
      } else if (node.type === "import_statement") {
        importCandidates.push(...extractImport(node));
      } else if (node.type === "import_from_statement") {
        const candidate = extractFromImport(node);
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
      callCandidates: extractCalls(rootNode),
      warnings: []
    };
  }
}
