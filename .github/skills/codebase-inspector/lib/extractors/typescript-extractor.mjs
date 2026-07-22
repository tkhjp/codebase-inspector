// Adapted from Egonex-AI/Understand-Anything at 54754a6f97051d1d76c8758353d8ea41afe502a6.
// Original project and this adaptation are licensed under MIT; see repository NOTICE.

import { getStringValue } from "./base-extractor.mjs";

const TYPE_KINDS = Object.freeze({
  class_declaration: "class",
  abstract_class_declaration: "class",
  interface_declaration: "interface",
  enum_declaration: "enum"
});

function lineRange(node) {
  return [node.startPosition.row + 1, node.endPosition.row + 1];
}

function childOfType(node, ...types) {
  return node.namedChildren.find((child) => types.includes(child.type)) ?? null;
}

function hasToken(node, type) {
  return node.children.some((child) => child.type === type);
}

function annotationText(node) {
  if (!node) return null;
  const text = node.text.trim();
  return text.startsWith(":") ? text.slice(1).trim() || null : text || null;
}

function parameterName(node) {
  if (!node) return null;
  if (["identifier", "property_identifier", "shorthand_property_identifier_pattern"].includes(node.type)) {
    return node.text;
  }
  if (["rest_pattern", "rest_element"].includes(node.type)) {
    const name = parameterName(node.childForFieldName("argument") ?? node.namedChildren[0]);
    return name ? `...${name}` : null;
  }
  if (node.type === "assignment_pattern") return parameterName(node.childForFieldName("left"));
  return parameterName(node.childForFieldName("pattern") ?? node.childForFieldName("name") ?? node.namedChildren[0]);
}

function extractParameters(paramsNode) {
  if (!paramsNode) return [];
  const parameters = [];

  for (const child of paramsNode.namedChildren) {
    const name = parameterName(child);
    if (!name) continue;
    const typeNode = child.childForFieldName("type") ?? childOfType(child, "type_annotation");
    parameters.push({ name, type: annotationText(typeNode) });
  }

  return parameters;
}

function extractReturnType(node) {
  return annotationText(node.childForFieldName("return_type"));
}

function extractImportSpecifiers(importClause) {
  if (!importClause) return [];
  const specifiers = [];

  for (const child of importClause.namedChildren) {
    if (child.type === "named_imports") {
      for (const specifier of child.namedChildren) {
        if (specifier.type !== "import_specifier") continue;
        const alias = specifier.childForFieldName("alias");
        const name = specifier.childForFieldName("name");
        if (alias ?? name) specifiers.push((alias ?? name).text);
      }
    } else if (child.type === "namespace_import") {
      const identifier = childOfType(child, "identifier");
      if (identifier) specifiers.push(`* as ${identifier.text}`);
    } else if (child.type === "identifier") {
      specifiers.push(child.text);
    }
  }

  return specifiers;
}

function memberVisibility(node) {
  const modifier = childOfType(node, "accessibility_modifier");
  if (modifier) return modifier.text;
  if (node.childForFieldName("name")?.type === "private_property_identifier") return "private";
  return "public";
}

function memberStatic(node) {
  return hasToken(node, "static");
}

function memberAsync(node) {
  return hasToken(node, "async");
}

function declarationName(node) {
  return node.childForFieldName("name")?.text ?? null;
}

function typeNamesFromClause(clause) {
  if (!clause) return [];
  return clause.namedChildren
    .filter((child) => child.type !== "type_arguments")
    .map((child) => child.text);
}

function classRelations(node) {
  const heritage = childOfType(node, "class_heritage");
  if (!heritage) return { extends: [], implements: [] };

  const extendsClause = childOfType(heritage, "extends_clause");
  const implementsClause = childOfType(heritage, "implements_clause");
  return {
    extends: typeNamesFromClause(extendsClause),
    implements: typeNamesFromClause(implementsClause)
  };
}

function interfaceRelations(node) {
  const clause = childOfType(node, "extends_type_clause");
  return { extends: typeNamesFromClause(clause), implements: [] };
}

function extractProperty(node) {
  const nameNode = node.childForFieldName("name") ?? childOfType(node, "property_identifier", "private_property_identifier");
  if (!nameNode) return null;
  return {
    name: nameNode.text,
    type: annotationText(node.childForFieldName("type") ?? childOfType(node, "type_annotation")),
    visibility: memberVisibility(node),
    static: memberStatic(node),
    lineRange: lineRange(node)
  };
}

function extractMethod(node, ownerName) {
  const nameNode = node.childForFieldName("name") ?? childOfType(node, "property_identifier");
  if (!nameNode) return null;
  const name = nameNode.text;
  return {
    name,
    ownerName,
    lineRange: lineRange(node),
    parameters: extractParameters(node.childForFieldName("parameters")),
    returnType: name === "constructor" ? null : extractReturnType(node),
    visibility: memberVisibility(node),
    static: memberStatic(node),
    async: memberAsync(node),
    exported: false
  };
}

function extractFunction(node, name, exported, rangeNode = node) {
  return {
    name,
    lineRange: lineRange(rangeNode),
    parameters: extractParameters(node.childForFieldName("parameters")),
    returnType: extractReturnType(node),
    visibility: null,
    async: memberAsync(node),
    exported
  };
}

function explicitExportNames(rootNode, allowCommonJs) {
  const names = new Set();

  for (const node of rootNode.namedChildren) {
    if (node.type === "export_statement") {
      const clause = childOfType(node, "export_clause");
      if (clause) {
        for (const specifier of clause.namedChildren) {
          if (specifier.type !== "export_specifier") continue;
          const localName = specifier.childForFieldName("name");
          if (localName) names.add(localName.text);
        }
      } else {
        const value = node.childForFieldName("value") ?? childOfType(node, "identifier");
        if (value?.type === "identifier") names.add(value.text);
      }
      continue;
    }

    if (!allowCommonJs) continue;
    if (node.type !== "expression_statement") continue;
    const assignment = childOfType(node, "assignment_expression");
    if (!assignment) continue;
    const left = assignment.childForFieldName("left");
    const right = assignment.childForFieldName("right");
    if (!left || !right) continue;

    if (left.text === "module.exports") {
      if (right.type === "identifier") names.add(right.text);
      if (right.type === "object") {
        for (const property of right.namedChildren) {
          if (["shorthand_property_identifier", "shorthand_property_identifier_pattern"].includes(property.type)) {
            names.add(property.text);
          } else if (property.type === "pair") {
            const value = property.childForFieldName("value");
            if (value?.type === "identifier") names.add(value.text);
          }
        }
      }
    } else if (/^(?:module\.exports|exports)\.[A-Za-z_$][\w$]*$/.test(left.text) && right.type === "identifier") {
      names.add(right.text);
    }
  }

  return names;
}

function commonJsExportName(left) {
  if (!left) return null;
  if (left.text === "module.exports") return "default";
  const match = /^(?:module\.exports|exports)\.([A-Za-z_$][\w$]*)$/.exec(left.text);
  return match?.[1] ?? null;
}

function calleeText(node) {
  if (!node) return null;
  if (["identifier", "super", "this"].includes(node.type)) return node.text;
  if (node.type === "parenthesized_expression") return calleeText(node.namedChildren[0]);
  if (node.type !== "member_expression") return null;

  const object = calleeText(node.childForFieldName("object"));
  const property = node.childForFieldName("property");
  if (!object || !property || !["property_identifier", "private_property_identifier", "identifier"].includes(property.type)) return null;
  return `${object}.${property.text}`;
}

function callableContext(node, context) {
  if (TYPE_KINDS[node.type]) {
    return { ...context, ownerName: declarationName(node) };
  }

  if (["method_definition", "method_signature", "abstract_method_signature"].includes(node.type)) {
    return { ...context, callerName: declarationName(node) };
  }

  if (node.type === "function_declaration") {
    return { callerName: declarationName(node), ownerName: null };
  }

  if (["arrow_function", "function_expression", "function"].includes(node.type)) {
    const parent = node.parent;
    let name = declarationName(node);
    if (!name && parent?.type === "variable_declarator") name = declarationName(parent);
    if (!name && parent?.type === "assignment_expression") {
      name = commonJsExportName(parent.childForFieldName("left"));
    }
    name ??= context.callerName;
    return { ...context, callerName: name };
  }

  return context;
}

function extractCalls(rootNode) {
  const calls = [];

  const visit = (node, context) => {
    const current = callableContext(node, context);
    if (node.type === "call_expression") {
      const callee = calleeText(node.childForFieldName("function"));
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

export class TypeScriptExtractor {
  extract(rootNode, context) {
    const types = [];
    const methods = [];
    const functions = [];
    const importCandidates = [];
    const allowCommonJs = context.language === "javascript";
    const exportNames = explicitExportNames(rootNode, allowCommonJs);

    const processType = (node, exported) => {
      const name = declarationName(node);
      if (!name) return;
      const body = node.childForFieldName("body");
      const properties = [];
      const relations = TYPE_KINDS[node.type] === "class" ? classRelations(node) : interfaceRelations(node);

      if (body) {
        for (const member of body.namedChildren) {
          if (["method_definition", "method_signature", "abstract_method_signature"].includes(member.type)) {
            const method = extractMethod(member, name);
            if (method) methods.push(method);
          } else if (["public_field_definition", "property_definition", "property_signature", "enum_assignment", "property_identifier"].includes(member.type)) {
            const property = extractProperty(member);
            if (property) properties.push(property);
          }
        }
      }

      types.push({
        kind: TYPE_KINDS[node.type],
        name,
        lineRange: lineRange(node),
        properties,
        extends: relations.extends,
        implements: relations.implements,
        exported
      });
    };

    const processVariableDeclaration = (node, exported) => {
      for (const declarator of node.namedChildren) {
        if (declarator.type !== "variable_declarator") continue;
        const name = declarationName(declarator);
        const value = declarator.childForFieldName("value");
        if (!name || !value || !["arrow_function", "function_expression", "function"].includes(value.type)) continue;
        functions.push(extractFunction(value, name, exported || exportNames.has(name), node));
      }
    };

    const processDeclaration = (node, exported) => {
      if (TYPE_KINDS[node.type]) {
        processType(node, exported || exportNames.has(declarationName(node)));
      } else if (node.type === "function_declaration") {
        const name = declarationName(node);
        if (name) functions.push(extractFunction(node, name, exported || exportNames.has(name)));
      } else if (["lexical_declaration", "variable_declaration"].includes(node.type)) {
        processVariableDeclaration(node, exported);
      }
    };

    const processCommonJsAssignment = (node) => {
      if (node.type !== "expression_statement") return false;
      const assignment = childOfType(node, "assignment_expression");
      const left = assignment?.childForFieldName("left");
      const value = assignment?.childForFieldName("right");
      const exportName = left ? commonJsExportName(left) : null;
      if (!value || !exportName || !["arrow_function", "function_expression", "function"].includes(value.type)) return false;
      const name = declarationName(value) ?? exportName;
      functions.push(extractFunction(value, name, true, node));
      return true;
    };

    for (const node of rootNode.namedChildren) {
      if (node.type === "import_statement") {
        const sourceNode = node.childForFieldName("source") ?? childOfType(node, "string");
        if (!sourceNode) continue;
        importCandidates.push({
          source: getStringValue(sourceNode),
          specifiers: extractImportSpecifiers(childOfType(node, "import_clause")),
          lineNumber: node.startPosition.row + 1,
          kind: "module"
        });
      } else if (node.type === "export_statement") {
        const declaration = node.childForFieldName("declaration") ?? node.namedChildren.find((child) => TYPE_KINDS[child.type] || ["function_declaration", "lexical_declaration", "variable_declaration"].includes(child.type));
        if (declaration) processDeclaration(declaration, true);
      } else if (allowCommonJs && processCommonJsAssignment(node)) {
        continue;
      } else {
        processDeclaration(node, false);
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
