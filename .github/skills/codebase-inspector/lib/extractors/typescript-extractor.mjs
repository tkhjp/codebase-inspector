// Adapted from Egonex-AI/Understand-Anything at 54754a6f97051d1d76c8758353d8ea41afe502a6.
// Original project and this adaptation are licensed under MIT; see repository NOTICE.

import { getStringValue } from "./base-extractor.mjs";

const TYPE_KINDS = Object.freeze({
  class: "class",
  class_declaration: "class",
  abstract_class_declaration: "class",
  interface_declaration: "interface",
  enum_declaration: "enum"
});

const METHOD_TYPES = new Set(["method_definition", "method_signature", "abstract_method_signature"]);
const FUNCTION_DECLARATION_TYPES = new Set(["function_declaration", "function_signature", "generator_function_declaration"]);
const CALLABLE_VALUE_TYPES = new Set(["arrow_function", "function_expression", "function", "generator_function"]);
const SAFE_NAME_TYPES = new Set([
  "identifier",
  "type_identifier",
  "property_identifier",
  "private_property_identifier",
  "shorthand_property_identifier",
  "shorthand_property_identifier_pattern"
]);

function lineRange(node) {
  return [node.startPosition.row + 1, node.endPosition.row + 1];
}

function childOfType(node, ...types) {
  return node?.namedChildren.find((child) => types.includes(child.type)) ?? null;
}

function hasToken(node, type) {
  return node.children.some((child) => child.type === type);
}

function addWarning(warnings, warningSet, message) {
  if (warningSet.has(message)) return;
  warningSet.add(message);
  warnings.push(message);
}

function safeName(node) {
  return node && SAFE_NAME_TYPES.has(node.type) ? node.text : null;
}

function declarationName(node) {
  return safeName(node?.childForFieldName("name"));
}

function safeQualifiedName(node) {
  const direct = safeName(node);
  if (direct) return direct;
  if (!node) return null;

  if (node.type === "nested_type_identifier") {
    const module = safeQualifiedName(node.childForFieldName("module") ?? node.namedChildren[0]);
    const name = safeName(node.childForFieldName("name") ?? node.namedChildren.at(-1));
    return module && name ? `${module}.${name}` : null;
  }

  if (node.type === "member_expression") {
    const object = safeQualifiedName(node.childForFieldName("object"));
    const property = safeName(node.childForFieldName("property"));
    return object && property ? `${object}.${property}` : null;
  }

  return null;
}

function renderTypeArguments(node) {
  if (!node || node.type !== "type_arguments") return null;
  const values = node.namedChildren.map(renderType).filter(Boolean);
  return values.length === node.namedChildren.length ? `<${values.join(", ")}>` : null;
}

function renderTypedParameters(node) {
  const parameters = extractParameters(node);
  return parameters.map(({ name, type }) => type ? `${name}: ${type}` : name).join(", ");
}

function renderStaticLiteral(node) {
  if (!node) return null;
  if (node.type === "string") return JSON.stringify(getStringValue(node));
  if (["true", "false", "null"].includes(node.type)) return node.type;
  if (node.type === "number" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(node.text)) return node.text;
  return null;
}

function renderStaticPropertyKey(node) {
  const name = safeName(node);
  if (name) return name;
  if (node?.type === "string") return JSON.stringify(getStringValue(node));
  if (node?.type === "number" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(node.text)) return node.text;
  return null;
}

function renderObjectTypeMember(node) {
  const name = safeName(node.childForFieldName("name"));
  if (!name) return null;
  const optional = hasToken(node, "?") ? "?" : "";

  if (node.type === "property_signature") {
    const type = renderType(node.childForFieldName("type") ?? childOfType(node, "type_annotation"));
    return type ? `${name}${optional}: ${type}` : null;
  }

  if (node.type === "method_signature") {
    const parameters = renderTypedParameters(node.childForFieldName("parameters"));
    const returnType = renderType(node.childForFieldName("return_type"));
    return returnType ? `${name}${optional}(${parameters}): ${returnType}` : null;
  }

  return null;
}

function renderType(node) {
  if (!node) return null;
  if (node.type === "type_annotation" || node.type === "type") return renderType(node.namedChildren[0]);

  const qualified = safeQualifiedName(node);
  if (qualified) return qualified;
  if (node.type === "predefined_type") return node.text;

  if (node.type === "generic_type") {
    const name = safeQualifiedName(node.childForFieldName("name") ?? node.namedChildren[0]);
    const args = renderTypeArguments(childOfType(node, "type_arguments"));
    return name && args ? `${name}${args}` : null;
  }

  if (node.type === "array_type") {
    const element = renderType(node.childForFieldName("element") ?? node.namedChildren[0]);
    return element ? `${element}[]` : null;
  }

  if (node.type === "function_type") {
    const parameters = renderTypedParameters(node.childForFieldName("parameters"));
    const returnType = renderType(node.childForFieldName("return_type"));
    return returnType ? `(${parameters}) => ${returnType}` : null;
  }

  if (node.type === "tuple_type") {
    const children = node.namedChildren.filter((child) => child.type !== "comment");
    const values = children.map(renderType).filter(Boolean);
    return values.length === children.length ? `[${values.join(", ")}]` : null;
  }

  if (node.type === "object_type") {
    const children = node.namedChildren.filter((child) => child.type !== "comment");
    const values = children.map(renderObjectTypeMember).filter(Boolean);
    return values.length === children.length ? `{ ${values.join("; ")} }` : null;
  }

  if (node.type === "literal_type") return renderStaticLiteral(node.namedChildren[0]);

  if (["union_type", "intersection_type"].includes(node.type)) {
    const values = node.namedChildren.map(renderType).filter(Boolean);
    if (values.length !== node.namedChildren.length) return null;
    return values.join(node.type === "union_type" ? " | " : " & ");
  }

  if (node.type === "parenthesized_type") {
    const inner = renderType(node.namedChildren[0]);
    return inner ? `(${inner})` : null;
  }

  return null;
}

function renderBindingPattern(node) {
  if (!node) return null;
  const direct = safeName(node);
  if (direct) return direct;

  if (["required_parameter", "optional_parameter"].includes(node.type)) {
    return renderBindingPattern(node.childForFieldName("pattern") ?? node.childForFieldName("name") ?? node.namedChildren[0]);
  }

  if (["assignment_pattern", "object_assignment_pattern"].includes(node.type)) {
    return renderBindingPattern(node.childForFieldName("left") ?? node.namedChildren[0]);
  }

  if (["rest_pattern", "rest_element"].includes(node.type)) {
    const value = renderBindingPattern(node.childForFieldName("argument") ?? node.namedChildren[0]);
    return value ? `...${value}` : null;
  }

  if (node.type === "pair_pattern") {
    const key = renderStaticPropertyKey(node.childForFieldName("key") ?? node.namedChildren[0]);
    const value = renderBindingPattern(node.childForFieldName("value") ?? node.namedChildren.at(-1));
    return key && value ? `${key}: ${value}` : null;
  }

  if (node.type === "object_pattern") {
    const children = node.namedChildren.filter((child) => child.type !== "comment");
    const values = children.map(renderBindingPattern).filter(Boolean);
    return values.length === children.length ? `{${values.join(", ")}}` : null;
  }

  if (node.type === "array_pattern") {
    const values = [];
    let expectsValue = true;
    for (const child of node.children) {
      if (["[", "]", "comment"].includes(child.type)) continue;
      if (child.type === ",") {
        if (expectsValue) values.push("");
        expectsValue = true;
        continue;
      }
      const value = renderBindingPattern(child);
      if (!value) return null;
      values.push(value);
      expectsValue = false;
    }
    return `[${values.join(", ")}]`;
  }

  return null;
}

function extractParameters(paramsNode) {
  if (!paramsNode) return [];
  const parameters = [];

  for (const child of paramsNode.namedChildren) {
    const name = renderBindingPattern(child);
    if (!name) continue;
    const typeNode = child.childForFieldName("type") ?? childOfType(child, "type_annotation");
    parameters.push({ name, type: renderType(typeNode) });
  }

  return parameters;
}

function extractReturnType(node) {
  return renderType(node.childForFieldName("return_type"));
}

function extractImportSpecifiers(importClause) {
  if (!importClause) return [];
  const specifiers = [];

  for (const child of importClause.namedChildren) {
    if (child.type === "named_imports") {
      for (const specifier of child.namedChildren) {
        if (specifier.type !== "import_specifier") continue;
        const name = safeName(specifier.childForFieldName("alias")) ?? safeName(specifier.childForFieldName("name"));
        if (name) specifiers.push(name);
      }
    } else if (child.type === "namespace_import") {
      const identifier = childOfType(child, "identifier");
      const name = safeName(identifier);
      if (name) specifiers.push(`* as ${name}`);
    } else {
      const name = safeName(child);
      if (name) specifiers.push(name);
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

function safeHeritageReference(node) {
  if (!node) return null;
  if (node.type === "generic_type") return renderType(node);

  const base = safeQualifiedName(node.childForFieldName("value") ?? node);
  if (!base) return null;
  const argsNode = childOfType(node, "type_arguments");
  if (!argsNode) return base;
  const args = renderTypeArguments(argsNode);
  return args ? `${base}${args}` : null;
}

function typeNamesFromClause(clause, warnHeritage) {
  if (!clause) return [];
  if (clause.type === "extends_clause") {
    const value = safeHeritageReference(clause);
    if (!value) warnHeritage(clause);
    return value ? [value] : [];
  }

  const values = [];
  for (const child of clause.namedChildren) {
    const value = safeHeritageReference(child);
    if (value) values.push(value);
    else warnHeritage(child);
  }
  return values;
}

function classRelations(node, warnHeritage) {
  const heritage = childOfType(node, "class_heritage");
  if (!heritage) return { extends: [], implements: [] };
  return {
    extends: typeNamesFromClause(childOfType(heritage, "extends_clause"), warnHeritage),
    implements: typeNamesFromClause(childOfType(heritage, "implements_clause"), warnHeritage)
  };
}

function interfaceRelations(node, warnHeritage) {
  return {
    extends: typeNamesFromClause(childOfType(node, "extends_type_clause"), warnHeritage),
    implements: []
  };
}

function memberName(node, warnDynamicName) {
  const nameNode = SAFE_NAME_TYPES.has(node.type)
    ? node
    : node.childForFieldName("name") ?? childOfType(node, "property_identifier", "private_property_identifier");
  const name = safeName(nameNode);
  if (!name && nameNode) warnDynamicName(node);
  return name;
}

function extractProperty(node, ownerKind, warnDynamicName) {
  const name = memberName(node, warnDynamicName);
  if (!name) return null;
  const isEnum = ownerKind === "enum";
  return {
    name,
    type: renderType(node.childForFieldName("type") ?? childOfType(node, "type_annotation")),
    visibility: isEnum ? "public" : memberVisibility(node),
    static: isEnum ? true : memberStatic(node),
    lineRange: lineRange(node)
  };
}

function extractMethod(node, ownerName, warnDynamicName, callableNames) {
  const name = memberName(node, warnDynamicName);
  callableNames.set(node.id, name);
  if (!name) return null;
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

function extractFunction(node, name, exported, callableNames, rangeNode = node) {
  callableNames.set(node.id, name);
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

function commonJsExportName(left) {
  const target = safeQualifiedName(left);
  if (target === "module.exports") return "default";
  if (!target) return null;
  const parts = target.split(".");
  if (parts.length === 2 && parts[0] === "exports") return parts[1];
  if (parts.length === 3 && parts[0] === "module" && parts[1] === "exports") return parts[2];
  return null;
}

function explicitExportNames(rootNode, allowCommonJs) {
  const names = new Set();

  for (const node of rootNode.namedChildren) {
    if (node.type === "export_statement") {
      if (node.childForFieldName("source")) continue;
      const clause = childOfType(node, "export_clause");
      if (clause) {
        for (const specifier of clause.namedChildren) {
          if (specifier.type !== "export_specifier") continue;
          const name = safeName(specifier.childForFieldName("name"));
          if (name) names.add(name);
        }
      } else {
        const name = safeName(node.childForFieldName("value") ?? childOfType(node, "identifier"));
        if (name) names.add(name);
      }
      continue;
    }

    if (!allowCommonJs || node.type !== "expression_statement") continue;
    const assignment = childOfType(node, "assignment_expression");
    const left = assignment?.childForFieldName("left");
    const right = assignment?.childForFieldName("right");
    if (!left || !right) continue;

    if (safeQualifiedName(left) === "module.exports") {
      const rightName = safeName(right);
      if (rightName) names.add(rightName);
      if (right.type === "object") {
        for (const property of right.namedChildren) {
          if (["shorthand_property_identifier", "shorthand_property_identifier_pattern"].includes(property.type)) {
            const name = safeName(property);
            if (name) names.add(name);
          } else if (property.type === "pair") {
            const value = safeName(property.childForFieldName("value"));
            if (value) names.add(value);
          }
        }
      }
    } else if (commonJsExportName(left)) {
      const rightName = safeName(right);
      if (rightName) names.add(rightName);
    }
  }

  return names;
}

function calleeText(node) {
  if (!node) return null;
  if (["identifier", "super", "this"].includes(node.type)) return node.text;
  if (node.type === "parenthesized_expression") return calleeText(node.namedChildren[0]);
  if (node.type !== "member_expression") return null;
  return safeQualifiedName(node);
}

function callableContext(node, context, callableNames, typeNames, allowCommonJs) {
  if (TYPE_KINDS[node.type]) {
    return { ...context, ownerName: typeNames.get(node.id) ?? declarationName(node) };
  }

  if (METHOD_TYPES.has(node.type)) {
    const callerName = callableNames.has(node.id) ? callableNames.get(node.id) : memberName(node, () => {});
    return { ...context, callerName };
  }

  if (FUNCTION_DECLARATION_TYPES.has(node.type)) {
    const callerName = callableNames.get(node.id) ?? declarationName(node);
    return { callerName, ownerName: null };
  }

  if (CALLABLE_VALUE_TYPES.has(node.type)) {
    if (callableNames.has(node.id)) return { ...context, callerName: callableNames.get(node.id) };
    const parent = node.parent;
    const variableName = parent?.type === "variable_declarator" ? declarationName(parent) : null;
    const exportName = allowCommonJs && parent?.type === "assignment_expression"
      ? commonJsExportName(parent.childForFieldName("left"))
      : null;
    const defaultName = parent?.type === "export_statement" && hasToken(parent, "default") ? "default" : null;
    return { ...context, callerName: declarationName(node) ?? variableName ?? exportName ?? defaultName ?? context.callerName };
  }

  return context;
}

function traversalChildren(node) {
  if (["assignment_pattern", "object_assignment_pattern"].includes(node.type)) {
    const left = node.childForFieldName("left") ?? node.namedChildren[0];
    return left ? [left] : [];
  }
  if (["required_parameter", "optional_parameter"].includes(node.type)) {
    const value = node.childForFieldName("value");
    return value ? node.namedChildren.filter((child) => child.id !== value.id) : node.namedChildren;
  }
  if (node.type === "pair_pattern" && node.childForFieldName("key")?.type === "computed_property_name") {
    const value = node.childForFieldName("value");
    return value ? [value] : [];
  }
  return node.namedChildren;
}

function extractCalls(rootNode, callableNames, typeNames, allowCommonJs, warnCallTarget, warnBindingKey) {
  const calls = [];

  const visit = (node, context) => {
    const current = callableContext(node, context, callableNames, typeNames, allowCommonJs);
    if (node.type === "pair_pattern" && node.childForFieldName("key")?.type === "computed_property_name") {
      warnBindingKey(node);
    }
    if (node.type === "call_expression") {
      const target = node.childForFieldName("function");
      const callee = calleeText(target);
      if (callee) {
        calls.push({
          callerName: current.callerName,
          callerOwnerName: current.ownerName,
          calleeText: callee,
          lineNumber: node.startPosition.row + 1
        });
      } else if (target?.type === "subscript_expression") {
        warnCallTarget(node);
      }
    }
    for (const child of traversalChildren(node)) visit(child, current);
  };

  visit(rootNode, { callerName: null, ownerName: null });
  return calls;
}

function exportSpecifiers(node) {
  const clause = childOfType(node, "export_clause");
  if (!clause) {
    const namespace = childOfType(node, "namespace_export");
    const name = safeName(childOfType(namespace, "identifier"));
    return name ? [`* as ${name}`] : ["*"];
  }
  const specifiers = [];
  for (const specifier of clause.namedChildren) {
    if (specifier.type !== "export_specifier") continue;
    const name = safeName(specifier.childForFieldName("alias")) ?? safeName(specifier.childForFieldName("name"));
    if (name) specifiers.push(name);
  }
  return specifiers;
}

export class TypeScriptExtractor {
  extract(rootNode, context) {
    const types = [];
    const methods = [];
    const functions = [];
    const importCandidates = [];
    const warnings = [];
    const warningSet = new Set();
    const callableNames = new Map();
    const typeNames = new Map();
    const allowCommonJs = context.language === "javascript";
    const exportNames = explicitExportNames(rootNode, allowCommonJs);

    const warnHeritage = (node) => addWarning(
      warnings,
      warningSet,
      `Skipped dynamic TypeScript heritage at line ${node.startPosition.row + 1}`
    );
    const warnMemberName = (node) => addWarning(
      warnings,
      warningSet,
      `Skipped dynamic TypeScript member name at line ${node.startPosition.row + 1}`
    );
    const warnJavaScriptExportName = (node) => addWarning(
      warnings,
      warningSet,
      `Skipped dynamic JavaScript export name at line ${node.startPosition.row + 1}`
    );
    const warnCallTarget = (node) => addWarning(
      warnings,
      warningSet,
      `Skipped dynamic ${context.language === "javascript" ? "JavaScript" : "TypeScript"} call target at line ${node.startPosition.row + 1}`
    );
    const warnBindingKey = (node) => addWarning(
      warnings,
      warningSet,
      `Skipped dynamic TypeScript binding key at line ${node.startPosition.row + 1}`
    );

    const processType = (node, exported, fallbackName = null) => {
      const name = declarationName(node) ?? fallbackName;
      if (!name) return;
      typeNames.set(node.id, name);
      const kind = TYPE_KINDS[node.type];
      const body = node.childForFieldName("body");
      const properties = [];
      const relations = kind === "class" ? classRelations(node, warnHeritage) : interfaceRelations(node, warnHeritage);

      if (body) {
        for (const member of body.namedChildren) {
          if (METHOD_TYPES.has(member.type)) {
            const method = extractMethod(member, name, warnMemberName, callableNames);
            if (method) methods.push(method);
          } else if (["public_field_definition", "property_definition", "property_signature", "enum_assignment", "property_identifier"].includes(member.type)) {
            const property = extractProperty(member, kind, warnMemberName);
            if (property) properties.push(property);
          }
        }
      }

      types.push({
        kind,
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
        if (!name || !value || !CALLABLE_VALUE_TYPES.has(value.type)) continue;
        functions.push(extractFunction(value, name, exported || exportNames.has(name), callableNames, node));
      }
    };

    const processDeclaration = (node, exported, fallbackName = null) => {
      if (node.type === "ambient_declaration") {
        const declaration = node.namedChildren[0];
        if (declaration) processDeclaration(declaration, exported);
      } else if (TYPE_KINDS[node.type]) {
        const name = declarationName(node);
        processType(node, exported || (name ? exportNames.has(name) : false), fallbackName);
      } else if (FUNCTION_DECLARATION_TYPES.has(node.type)) {
        const name = declarationName(node) ?? fallbackName;
        if (name) functions.push(extractFunction(node, name, exported || exportNames.has(name), callableNames));
      } else if (["lexical_declaration", "variable_declaration"].includes(node.type)) {
        processVariableDeclaration(node, exported);
      }
    };

    const processCommonJsObject = (objectNode) => {
      for (const property of objectNode.namedChildren) {
        if (property.type === "pair") {
          const name = safeName(property.childForFieldName("key"));
          const value = property.childForFieldName("value");
          if (!name) {
            warnJavaScriptExportName(property);
          } else if (value && CALLABLE_VALUE_TYPES.has(value.type)) {
            functions.push(extractFunction(value, name, true, callableNames, property));
          }
        } else if (property.type === "method_definition") {
          const name = memberName(property, warnJavaScriptExportName);
          callableNames.set(property.id, name);
          if (name) functions.push(extractFunction(property, name, true, callableNames, property));
        }
      }
    };

    const processCommonJsAssignment = (node) => {
      if (node.type !== "expression_statement") return false;
      const assignment = childOfType(node, "assignment_expression");
      const left = assignment?.childForFieldName("left");
      const value = assignment?.childForFieldName("right");
      if (left?.type === "subscript_expression") {
        const object = safeQualifiedName(left.childForFieldName("object"));
        if (["exports", "module.exports"].includes(object)) {
          warnJavaScriptExportName(node);
          return true;
        }
      }
      const exportName = commonJsExportName(left);
      if (!value || !exportName) return false;
      if (safeQualifiedName(left) === "module.exports" && value.type === "object") {
        processCommonJsObject(value);
        return true;
      }
      if (!CALLABLE_VALUE_TYPES.has(value.type)) return false;
      const name = declarationName(value) ?? exportName;
      functions.push(extractFunction(value, name, true, callableNames, node));
      return true;
    };

    const processExportStatement = (node) => {
      const sourceNode = node.childForFieldName("source");
      if (sourceNode) {
        importCandidates.push({
          source: getStringValue(sourceNode),
          specifiers: exportSpecifiers(node),
          lineNumber: node.startPosition.row + 1,
          kind: "module"
        });
      }

      const declaration = node.childForFieldName("declaration") ?? node.namedChildren.find((child) => (
        TYPE_KINDS[child.type]
        || child.type === "ambient_declaration"
        || FUNCTION_DECLARATION_TYPES.has(child.type)
        || ["lexical_declaration", "variable_declaration"].includes(child.type)
      ));
      if (declaration) {
        processDeclaration(declaration, true, hasToken(node, "default") ? "default" : null);
        return;
      }

      const value = node.childForFieldName("value");
      if (hasToken(node, "default") && value && CALLABLE_VALUE_TYPES.has(value.type)) {
        const name = declarationName(value) ?? "default";
        functions.push(extractFunction(value, name, true, callableNames, value));
      }
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
        processExportStatement(node);
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
      callCandidates: extractCalls(rootNode, callableNames, typeNames, allowCommonJs, warnCallTarget, warnBindingKey),
      warnings
    };
  }
}
