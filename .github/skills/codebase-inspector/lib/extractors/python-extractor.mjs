// Adapted from Egonex-AI/Understand-Anything at 54754a6f97051d1d76c8758353d8ea41afe502a6.
// Original project and this adaptation are licensed under MIT; see repository NOTICE.

import { findChild, getStringValue } from "./base-extractor.mjs";

function lineRange(node) {
  return [node.startPosition.row + 1, node.endPosition.row + 1];
}

function unwrapDecorated(node) {
  if (node.type !== "decorated_definition") return node;
  return findChild(node, "function_definition") ?? findChild(node, "class_definition") ?? node;
}

function safeIdentifier(node) {
  return node?.type === "identifier" ? node.text : null;
}

function parseSafeTypeString(value) {
  let index = 0;
  const skipSpace = () => {
    while (/\s/.test(value[index] ?? "")) index += 1;
  };
  const parseIdentifier = () => {
    skipSpace();
    const match = /^[A-Za-z_]\w*/.exec(value.slice(index));
    if (!match) return null;
    index += match[0].length;
    return match[0];
  };
  const parseType = () => {
    let rendered = parseIdentifier();
    if (!rendered) return null;

    skipSpace();
    while (value[index] === ".") {
      index += 1;
      const part = parseIdentifier();
      if (!part) return null;
      rendered += `.${part}`;
      skipSpace();
    }

    if (value[index] !== "[") return rendered;
    index += 1;
    const argumentsList = [];
    while (true) {
      skipSpace();
      let argument;
      if (value.slice(index, index + 3) === "...") {
        argument = "...";
        index += 3;
      } else {
        argument = parseType();
      }
      if (!argument) return null;
      argumentsList.push(argument);
      skipSpace();
      if (value[index] === "]") {
        index += 1;
        break;
      }
      if (value[index] !== ",") return null;
      index += 1;
    }
    return `${rendered}[${argumentsList.join(", ")}]`;
  };

  const rendered = parseType();
  skipSpace();
  return rendered && index === value.length ? rendered : null;
}

function safeReference(node, { preserveStringLiteral = false } = {}) {
  if (!node) return null;
  if (node.type === "type") return safeReference(node.namedChildren[0], { preserveStringLiteral });

  const identifier = safeIdentifier(node);
  if (identifier) return identifier;
  if (node.type === "none") return "None";
  if (node.type === "ellipsis") return "...";

  if (node.type === "dotted_name") {
    const names = node.namedChildren.map(safeIdentifier).filter(Boolean);
    return names.length === node.namedChildren.length ? names.join(".") : null;
  }

  if (node.type === "attribute") {
    const object = safeReference(node.childForFieldName("object"));
    const attribute = safeIdentifier(node.childForFieldName("attribute"));
    return object && attribute ? `${object}.${attribute}` : null;
  }

  if (node.type === "generic_type") {
    const name = safeReference(node.namedChildren[0]);
    const parameters = node.namedChildren.find((child) => child.type === "type_parameter");
    const literalArguments = name === "Literal" || name?.endsWith(".Literal");
    const argumentsList = parameters?.namedChildren
      .map((child) => safeReference(child, { preserveStringLiteral: literalArguments }))
      .filter(Boolean) ?? [];
    return name && parameters && argumentsList.length === parameters.namedChildren.length
      ? `${name}[${argumentsList.join(", ")}]`
      : null;
  }

  if (node.type === "type_parameter") {
    const values = node.namedChildren.map((child) => safeReference(child, { preserveStringLiteral })).filter(Boolean);
    return values.length === node.namedChildren.length ? values.join(", ") : null;
  }

  if (node.type === "list") {
    const values = node.namedChildren.map((child) => safeReference(child, { preserveStringLiteral })).filter(Boolean);
    return values.length === node.namedChildren.length ? `[${values.join(", ")}]` : null;
  }

  if (node.type === "string") {
    const value = getStringValue(node);
    return preserveStringLiteral ? JSON.stringify(value) : parseSafeTypeString(value);
  }

  if (node.type === "subscript") {
    const value = safeReference(node.childForFieldName("value") ?? node.namedChildren[0], { preserveStringLiteral });
    const argumentsNode = node.childForFieldName("subscript") ?? node.namedChildren[1];
    if (!value || !argumentsNode) return null;
    const argumentNodes = argumentsNode.type === "tuple" ? argumentsNode.namedChildren : [argumentsNode];
    const argumentsList = argumentNodes
      .map((child) => safeReference(child, { preserveStringLiteral }))
      .filter(Boolean);
    return argumentsList.length === argumentNodes.length ? `${value}[${argumentsList.join(", ")}]` : null;
  }

  if (node.type === "union_type") {
    const values = node.namedChildren.map((child) => safeReference(child, { preserveStringLiteral })).filter(Boolean);
    return values.length === node.namedChildren.length ? values.join(" | ") : null;
  }

  return null;
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

function extractParameters(paramsNode, receiverKind = null) {
  if (!paramsNode) return [];
  const parameters = [];

  for (const child of paramsNode.namedChildren) {
    const name = parameterName(child);
    if (!name) continue;
    const typeNode = child.childForFieldName("type") ?? findChild(child, "type");
    parameters.push({ name, type: safeReference(typeNode) });
  }

  if (["instance", "class"].includes(receiverKind) && parameters.length > 0) return parameters.slice(1);
  return parameters;
}

function decoratorName(decorator) {
  return safeIdentifier(decorator?.namedChildren[0]);
}

function methodSemantics(outerNode) {
  const decorators = outerNode.type === "decorated_definition"
    ? outerNode.namedChildren.filter((child) => child.type === "decorator").map(decoratorName)
    : [];
  if (decorators.includes("staticmethod")) return { receiverKind: null, static: true };
  if (decorators.includes("classmethod")) return { receiverKind: "class", static: false };
  return { receiverKind: "instance", static: false };
}

function extractCallable(node, { ownerName = null, receiverKind = null, staticValue = null } = {}) {
  const nameNode = node.childForFieldName("name");
  const name = safeIdentifier(nameNode);
  if (!name) return null;
  const common = {
    name,
    lineRange: lineRange(node),
    parameters: extractParameters(node.childForFieldName("parameters"), receiverKind),
    returnType: name === "__init__" ? null : safeReference(node.childForFieldName("return_type")),
    visibility: null,
    async: node.children.some((child) => child.type === "async"),
    exported: null
  };
  return ownerName ? { ...common, ownerName, static: staticValue } : common;
}

function extractProperty(node) {
  if (node.type !== "expression_statement") return null;
  const assignment = findChild(node, "assignment");
  if (!assignment) return null;
  const name = safeIdentifier(assignment.childForFieldName("left"));
  const type = safeReference(assignment.childForFieldName("type"));
  if (!name) return null;
  return {
    name,
    type,
    visibility: null,
    static: null,
    lineRange: lineRange(node)
  };
}

function extractSuperclasses(node, warnHeritage) {
  const superclasses = node.childForFieldName("superclasses");
  if (!superclasses) return [];
  const values = [];
  for (const child of superclasses.namedChildren) {
    if (child.type === "keyword_argument") continue;
    const value = safeReference(child);
    if (value) values.push(value);
    else warnHeritage(child);
  }
  return values;
}

function importSpecifier(node) {
  if (node.type === "aliased_import") {
    return safeIdentifier(node.childForFieldName("alias") ?? node.namedChildren.at(-1));
  }
  return node.type === "dotted_name" ? safeReference(node) : node.type === "wildcard_import" ? "*" : null;
}

function extractImport(node) {
  const candidates = [];
  for (const child of node.namedChildren) {
    if (!["dotted_name", "aliased_import"].includes(child.type)) continue;
    const sourceNode = child.type === "aliased_import" ? findChild(child, "dotted_name") : child;
    const source = safeReference(sourceNode);
    const specifier = importSpecifier(child);
    if (!source || !specifier) continue;
    candidates.push({
      source,
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
    source: moduleNode.type === "relative_import" ? moduleNode.text : safeReference(moduleNode),
    specifiers,
    lineNumber: node.startPosition.row + 1,
    kind: "module"
  };
}

function callableContext(node, context) {
  if (node.type === "class_definition") {
    return { ...context, ownerName: safeIdentifier(node.childForFieldName("name")) };
  }
  if (node.type === "function_definition") {
    return { ...context, callerName: safeIdentifier(node.childForFieldName("name")) };
  }
  return context;
}

function calleeText(node) {
  if (!node) return null;
  if (node.type === "identifier") return node.text;
  if (node.type === "parenthesized_expression") return calleeText(node.namedChildren[0]);
  if (node.type !== "attribute") return null;

  const object = calleeText(node.childForFieldName("object"));
  const attribute = safeIdentifier(node.childForFieldName("attribute"));
  return object && attribute ? `${object}.${attribute}` : null;
}

function traversalChildren(node) {
  if (node.type === "type") return [];
  if (!["default_parameter", "typed_default_parameter"].includes(node.type)) {
    return node.namedChildren;
  }

  const defaultValue = node.childForFieldName("value");
  return defaultValue ? node.namedChildren.filter((child) => child.id !== defaultValue.id) : node.namedChildren;
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
    for (const child of traversalChildren(node)) visit(child, current);
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
    const warnings = [];
    const warningSet = new Set();
    const warnHeritage = (node) => {
      const warning = `Skipped dynamic Python heritage at line ${node.startPosition.row + 1}`;
      if (warningSet.has(warning)) return;
      warningSet.add(warning);
      warnings.push(warning);
    };

    for (const outerNode of rootNode.namedChildren) {
      const node = unwrapDecorated(outerNode);

      if (node.type === "function_definition") {
        const callable = extractCallable(node);
        if (callable) functions.push(callable);
      } else if (node.type === "class_definition") {
        const name = safeIdentifier(node.childForFieldName("name"));
        if (!name) continue;
        const properties = [];
        const body = node.childForFieldName("body");

        if (body) {
          for (const outerMember of body.namedChildren) {
            const member = unwrapDecorated(outerMember);
            if (member.type === "function_definition") {
              const semantics = methodSemantics(outerMember);
              const method = extractCallable(member, {
                ownerName: name,
                receiverKind: semantics.receiverKind,
                staticValue: semantics.static
              });
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
          extends: extractSuperclasses(node, warnHeritage),
          implements: [],
          exported: null
        });
      } else if (node.type === "import_statement") {
        importCandidates.push(...extractImport(node));
      } else if (node.type === "import_from_statement") {
        const candidate = extractFromImport(node);
        if (candidate?.source) importCandidates.push(candidate);
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
      warnings
    };
  }
}
