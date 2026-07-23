const TYPE_KIND = Object.freeze({
  class_declaration: "class",
  interface_declaration: "interface",
  enum_declaration: "enum"
});
const TYPE_NODES = new Set(Object.keys(TYPE_KIND));
const METHOD_NODES = new Set(["method_definition", "method_signature", "abstract_method_signature"]);
const PROPERTY_NODES = new Set(["public_field_definition", "property_signature", "abstract_property_signature"]);
const PARAMETER_NODES = new Set(["required_parameter", "optional_parameter", "rest_parameter"]);
const FUNCTION_NODES = new Set([
  "function_declaration",
  "generator_function_declaration",
  "function_expression",
  "generator_function",
  "arrow_function"
]);
const TS_SUPPORTED_FACTS = Object.freeze([
  "files",
  "types",
  "methods",
  "functions",
  "imports",
  "calls",
  "qualified-names",
  "type-kinds",
  "member-kinds",
  "parameters",
  "return-types",
  "visibility",
  "modifiers",
  "type-relations"
]);
const GENERIC_TYPE_KIND = Object.freeze({
  class_definition: "class",
  class_declaration: "class",
  class_specifier: "class",
  interface_declaration: "interface",
  struct_item: "struct",
  struct_specifier: "struct",
  enum_item: "enum",
  enum_declaration: "enum",
  enum_specifier: "enum",
  trait_item: "trait",
  trait_declaration: "trait",
  record_declaration: "record",
  module: "module",
  module_declaration: "module",
  type_spec: "struct",
  mixin_declaration: "trait"
});
const GENERIC_TYPE_NODES = new Set(Object.keys(GENERIC_TYPE_KIND));

function namedChildren(node) {
  return node?.namedChildren ?? [];
}

function children(node) {
  return node?.children ?? [];
}

function lineRange(node) {
  return [node.startPosition.row + 1, node.endPosition.row + 1];
}

function field(node, name) {
  return node.childForFieldName?.(name) ?? null;
}

function stripTypeAnnotation(text) {
  return text?.replace(/^\s*:\s*/, "").trim() || null;
}

function visibility(node, fallback = null) {
  const modifier = namedChildren(node).find((child) => child.type === "accessibility_modifier");
  return modifier?.text ?? fallback;
}

function modifiers(node) {
  const values = [];
  for (const child of children(node)) {
    if (["accessibility_modifier", "static", "async", "readonly", "abstract", "override", "declare", "get", "set"].includes(child.type)) {
      values.push(child.text);
    }
  }
  return [...new Set(values)].sort();
}

function typeParameters(node) {
  const parameters = field(node, "type_parameters")
    ?? namedChildren(node).find((child) => child.type === "type_parameters");
  if (!parameters) return [];
  return namedChildren(parameters)
    .map((child) => field(child, "name")?.text ?? child.text)
    .filter(Boolean);
}

function parameterName(node) {
  return field(node, "pattern")?.text
    ?? field(node, "name")?.text
    ?? namedChildren(node).find((child) => ["identifier", "required_parameter", "optional_parameter"].includes(child.type))?.text
    ?? node.text;
}

function parseParameters(node) {
  const container = field(node, "parameters")
    ?? namedChildren(node).find((child) => child.type === "formal_parameters");
  if (!container) return [];
  return namedChildren(container)
    .filter((child) => PARAMETER_NODES.has(child.type) || child.type === "identifier")
    .map((parameter, position) => {
      const typeNode = field(parameter, "type")
        ?? namedChildren(parameter).find((child) => child.type === "type_annotation");
      const defaultNode = field(parameter, "value");
      return {
        position,
        name: parameterName(parameter),
        type: stripTypeAnnotation(typeNode?.text),
        typeStatus: typeNode ? "known" : "not-declared",
        defaultValue: defaultNode?.text ?? null,
        defaultStatus: defaultNode ? "known" : "not-declared",
        optional: parameter.type === "optional_parameter" || parameter.text.includes("?"),
        variadic: parameter.type === "rest_parameter" || parameter.text.trimStart().startsWith("...")
      };
    });
}

function callableKind(node, name) {
  if (name === "constructor") return "constructor";
  if (children(node).some((child) => child.type === "get")) return "getter";
  if (children(node).some((child) => child.type === "set")) return "setter";
  return "method";
}

function parseMethod(node, ownerName) {
  const name = field(node, "name")?.text ?? "constructor";
  const returnNode = field(node, "return_type");
  const kind = callableKind(node, name);
  const declaredVisibility = name.startsWith("#") ? "private" : visibility(node, "public");
  return {
    kind,
    name,
    ownerName,
    lineRange: lineRange(node),
    parameters: parseParameters(node),
    returnType: stripTypeAnnotation(returnNode?.text),
    returnTypeStatus: returnNode ? "known" : (kind === "constructor" ? "not-declared" : "not-declared"),
    visibility: declaredVisibility,
    visibilityStatus: "known",
    modifiers: modifiers(node),
    typeParameters: typeParameters(node),
    async: modifiers(node).includes("async"),
    exported: false,
    static: modifiers(node).includes("static")
  };
}

function propertyKind(node, ownerKind) {
  if (ownerKind === "enum") return "enum-member";
  return node.type === "public_field_definition" ? "field" : "property";
}

function parseProperty(node, ownerKind) {
  const name = field(node, "name")?.text
    ?? namedChildren(node).find((child) => ["property_identifier", "identifier"].includes(child.type))?.text;
  if (!name) return null;
  const typeNode = field(node, "type")
    ?? namedChildren(node).find((child) => child.type === "type_annotation");
  const valueNode = field(node, "value");
  const declaredVisibility = name.startsWith("#") ? "private" : visibility(node, "public");
  return {
    name,
    kind: propertyKind(node, ownerKind),
    type: stripTypeAnnotation(typeNode?.text),
    typeStatus: typeNode ? "known" : "not-declared",
    defaultValue: valueNode?.text ?? null,
    defaultStatus: valueNode ? "known" : "not-declared",
    visibility: declaredVisibility,
    visibilityStatus: "known",
    modifiers: modifiers(node),
    static: modifiers(node).includes("static"),
    lineRange: lineRange(node),
    explicitValue: ownerKind === "enum" ? valueNode?.text ?? null : null
  };
}

function enumProperties(body) {
  if (!body) return [];
  return namedChildren(body).map((member) => {
    if (member.type === "enum_assignment") return parseProperty(member, "enum");
    if (["property_identifier", "identifier"].includes(member.type)) {
      return {
        name: member.text,
        kind: "enum-member",
        type: null,
        typeStatus: "not-declared",
        defaultValue: null,
        defaultStatus: "not-declared",
        visibility: "public",
        visibilityStatus: "known",
        modifiers: [],
        static: true,
        lineRange: lineRange(member),
        explicitValue: null
      };
    }
    return null;
  }).filter(Boolean);
}

function heritage(typeNode, clauseType) {
  const heritageNode = namedChildren(typeNode).find((child) => child.type === "class_heritage");
  const clause = namedChildren(heritageNode).find((child) => child.type === clauseType);
  if (!clause) return [];
  const prefix = clauseType === "extends_clause" ? /^extends\s+/ : /^implements\s+/;
  return clause.text.replace(prefix, "").split(",").map((value) => value.trim()).filter(Boolean);
}

function exported(node) {
  return node.parent?.type === "export_statement";
}

function namespaceFor(node) {
  const names = [];
  let current = node.parent;
  while (current) {
    if (["internal_module", "module", "ambient_declaration"].includes(current.type)) {
      const name = field(current, "name")?.text;
      if (name) names.push(name);
    }
    current = current.parent;
  }
  return names.reverse().join(".") || null;
}

function parseType(node) {
  const kind = TYPE_KIND[node.type];
  const name = field(node, "name")?.text;
  if (!name) return null;
  const namespace = namespaceFor(node);
  const body = field(node, "body")
    ?? namedChildren(node).find((child) => ["class_body", "interface_body", "enum_body"].includes(child.type));
  const typeModifiers = modifiers(node);
  const properties = kind === "enum"
    ? enumProperties(body)
    : namedChildren(body).filter((child) => PROPERTY_NODES.has(child.type)).map((child) => parseProperty(child, kind)).filter(Boolean);
  const methods = namedChildren(body).filter((child) => METHOD_NODES.has(child.type)).map((child) => parseMethod(child, name));
  const isExported = exported(node);
  return {
    type: {
      kind,
      name,
      qualifiedName: namespace ? `${namespace}.${name}` : name,
      lineRange: lineRange(node),
      namespace,
      package: null,
      module: null,
      visibility: isExported ? "public" : null,
      visibilityStatus: isExported ? "known" : "not-declared",
      modifiers: typeModifiers,
      typeParameters: typeParameters(node),
      properties,
      extends: heritage(node, "extends_clause"),
      implements: heritage(node, "implements_clause"),
      mixins: [],
      exported: isExported
    },
    methods
  };
}

function walk(node, visit) {
  visit(node);
  namedChildren(node).forEach((child) => walk(child, visit));
}

function genericNodeName(node) {
  return field(node, "name")?.text
    ?? namedChildren(node).find((child) => [
      "identifier",
      "name",
      "type_identifier",
      "constant",
      "simple_identifier"
    ].includes(child.type))?.text
    ?? null;
}

function genericKind(node) {
  if (node.type === "type_spec") {
    if (namedChildren(node).some((child) => child.type === "interface_type")) return "interface";
    return "struct";
  }
  if (node.type === "class_declaration") {
    const header = node.text.slice(0, node.text.indexOf("{") === -1 ? node.text.length : node.text.indexOf("{"));
    if (/\binterface\b/.test(header)) return "interface";
    if (/\benum\s+class\b/.test(header)) return "enum";
    if (/\brecord\b/.test(header)) return "record";
  }
  return GENERIC_TYPE_KIND[node.type];
}

function packageScope(rootNode) {
  let result = null;
  for (const child of namedChildren(rootNode)) {
    if (!["package_declaration", "package_header", "package_clause"].includes(child.type)) continue;
    const match = child.text.match(/\bpackage\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/);
    if (match) result = match[1];
  }
  return result;
}

function ancestorScope(node, types) {
  const names = [];
  let current = node.parent;
  while (current) {
    if (types.has(current.type)) {
      const name = genericNodeName(current);
      if (name) names.push(name);
    }
    current = current.parent;
  }
  return names.reverse().join(".") || null;
}

function genericScope(node, rootNode) {
  const namespace = ancestorScope(node, new Set(["namespace_declaration", "file_scoped_namespace_declaration", "namespace_definition"]));
  const module = ancestorScope(node, new Set(["module", "module_declaration", "mod_item"]));
  const packageName = packageScope(rootNode);
  const enclosingType = ancestorScope(node, GENERIC_TYPE_NODES);
  return { namespace, module, package: packageName, enclosingType };
}

function genericVisibility(node) {
  const header = node.text.slice(0, Math.min(node.text.length, 300));
  const match = header.match(/\b(public|protected|private|internal)\b/);
  return match?.[1] ?? null;
}

function genericModifiers(node) {
  const header = node.text.slice(0, Math.min(node.text.length, 300));
  const known = ["abstract", "async", "const", "data", "export", "extern", "final", "open", "override", "partial", "readonly", "sealed", "static", "suspend"];
  return known.filter((modifier) => new RegExp(`\\b${modifier}\\b`).test(header));
}

function genericHeritage(node, language) {
  const bodyStart = node.text.indexOf("{");
  const header = node.text.slice(0, bodyStart === -1 ? Math.min(node.text.length, 500) : bodyStart);
  const result = { extends: [], implements: [], mixins: [] };
  const extendsMatch = header.match(/\bextends\s+([^:{]+?)(?=\bimplements\b|\bwith\b|$)/);
  const implementsMatch = header.match(/\bimplements\s+([^:{]+?)(?=\bwith\b|$)/);
  const mixinMatch = header.match(/\bwith\s+([^:{]+?)(?=\bimplements\b|$)/);
  if (extendsMatch) result.extends = extendsMatch[1].split(",").map((value) => value.trim()).filter(Boolean);
  if (implementsMatch) result.implements = implementsMatch[1].split(",").map((value) => value.trim()).filter(Boolean);
  if (mixinMatch) result.mixins = mixinMatch[1].split(",").map((value) => value.trim()).filter(Boolean);
  if (language === "csharp" && result.extends.length === 0 && result.implements.length === 0) {
    const baseMatch = header.match(/:\s*([^{}]+)/);
    if (baseMatch) {
      const values = baseMatch[1].split(",").map((value) => value.trim()).filter(Boolean);
      if (values.length > 0) {
        result.extends = [values[0]];
        result.implements = values.slice(1);
      }
    }
  }
  if (language === "python") {
    const baseMatch = header.match(/\(([^()]*)\)/);
    if (baseMatch) result.extends = baseMatch[1].split(",").map((value) => value.trim()).filter(Boolean);
  }
  return result;
}

function mergeGenericTypes(rootNode, language, base) {
  const observed = [];
  walk(rootNode, (node) => {
    if (!GENERIC_TYPE_NODES.has(node.type)) return;
    const name = genericNodeName(node);
    if (!name) return;
    const scope = genericScope(node, rootNode);
    const kind = genericKind(node);
    const heritage = genericHeritage(node, language);
    observed.push({
      kind,
      name,
      qualifiedName: [scope.namespace ?? scope.package ?? scope.module, scope.enclosingType, name].filter(Boolean).join("."),
      lineRange: lineRange(node),
      namespace: scope.namespace,
      module: scope.module,
      package: scope.package,
      visibility: genericVisibility(node),
      visibilityStatus: genericVisibility(node) ? "known" : "not-declared",
      modifiers: genericModifiers(node),
      typeParameters: [],
      properties: [],
      ...heritage,
      exported: null
    });
  });

  const consumed = new Set();
  const types = observed.map((entry) => {
    const candidates = base.types
      .map((type, index) => ({ type, index }))
      .filter(({ type, index }) => !consumed.has(index) && type.name === entry.name)
      .sort((left, right) => Math.abs(left.type.lineRange[0] - entry.lineRange[0]) - Math.abs(right.type.lineRange[0] - entry.lineRange[0]));
    const match = candidates[0];
    if (!match) return entry;
    consumed.add(match.index);
    return {
      ...match.type,
      ...entry,
      properties: match.type.properties.map((property) => ({
        ...property,
        kind: entry.kind === "enum" ? "enum-member" : property.kind,
        typeStatus: property.typeStatus ?? (property.type ? "known" : "unsupported"),
        defaultValue: property.defaultValue ?? null,
        defaultStatus: property.defaultStatus ?? "unsupported",
        visibilityStatus: property.visibilityStatus ?? (property.visibility ? "known" : "unsupported"),
        modifiers: property.modifiers ?? [],
        explicitValue: property.explicitValue ?? null
      })),
      extends: entry.extends.length ? entry.extends : match.type.extends,
      implements: entry.implements.length ? entry.implements : match.type.implements,
      mixins: entry.mixins,
      exported: match.type.exported ?? entry.exported
    };
  });
  base.types.forEach((type, index) => {
    if (!consumed.has(index)) types.push(type);
  });
  return types;
}

function insideType(node) {
  let current = node.parent;
  while (current) {
    if (TYPE_NODES.has(current.type)) return true;
    current = current.parent;
  }
  return false;
}

function insideCallable(node) {
  let current = node.parent;
  while (current) {
    if (METHOD_NODES.has(current.type) || FUNCTION_NODES.has(current.type)) return true;
    current = current.parent;
  }
  return false;
}

function parseFunction(node) {
  const name = field(node, "name")?.text;
  if (!name) return null;
  const returnNode = field(node, "return_type");
  const isExported = exported(node);
  const functionModifiers = modifiers(node);
  return {
    kind: "function",
    name,
    lineRange: lineRange(node),
    parameters: parseParameters(node),
    returnType: stripTypeAnnotation(returnNode?.text),
    returnTypeStatus: returnNode ? "known" : "not-declared",
    visibility: isExported ? "public" : null,
    visibilityStatus: isExported ? "known" : "not-declared",
    modifiers: functionModifiers,
    typeParameters: typeParameters(node),
    async: functionModifiers.includes("async"),
    exported: isExported
  };
}

function parseVariableFunction(node) {
  const name = field(node, "name")?.text;
  const value = field(node, "value");
  if (!name || !value || !FUNCTION_NODES.has(value.type)) return null;
  const returnNode = field(value, "return_type");
  let current = node.parent;
  let isExported = false;
  while (current && !["program", "internal_module"].includes(current.type)) {
    if (current.type === "export_statement") {
      isExported = true;
      break;
    }
    current = current.parent;
  }
  const functionModifiers = modifiers(value);
  return {
    kind: "function",
    name,
    lineRange: lineRange(node),
    parameters: parseParameters(value),
    returnType: stripTypeAnnotation(returnNode?.text),
    returnTypeStatus: returnNode ? "known" : "not-declared",
    visibility: isExported ? "public" : null,
    visibilityStatus: isExported ? "known" : "not-declared",
    modifiers: functionModifiers,
    typeParameters: typeParameters(value),
    async: functionModifiers.includes("async") || value.text.trimStart().startsWith("async "),
    exported: isExported
  };
}

function ownerFor(node) {
  let current = node.parent;
  while (current) {
    if (TYPE_NODES.has(current.type)) return field(current, "name")?.text ?? null;
    current = current.parent;
  }
  return null;
}

function callableContext(node) {
  if (METHOD_NODES.has(node.type)) {
    return {
      name: field(node, "name")?.text ?? "constructor",
      ownerName: ownerFor(node)
    };
  }
  if (["function_declaration", "generator_function_declaration"].includes(node.type)) {
    return { name: field(node, "name")?.text ?? null, ownerName: null };
  }
  if (["arrow_function", "function_expression", "generator_function"].includes(node.type) && node.parent?.type === "variable_declarator") {
    return { name: field(node.parent, "name")?.text ?? null, ownerName: null };
  }
  return null;
}

function extractCallCandidates(rootNode) {
  const calls = [];
  const visit = (node, stack) => {
    const context = callableContext(node);
    const nextStack = context?.name ? [...stack, context] : stack;
    if (node.type === "call_expression" && nextStack.length > 0) {
      const callee = field(node, "function");
      const argumentsNode = field(node, "arguments")
        ?? namedChildren(node).find((child) => child.type === "arguments");
      if (callee) {
        const caller = nextStack[nextStack.length - 1];
        const receiver = callee.type === "member_expression" || callee.type === "subscript_expression"
          ? field(callee, "object")?.text ?? namedChildren(callee)[0]?.text ?? null
          : null;
        calls.push({
          callerName: caller.name,
          callerOwnerName: caller.ownerName,
          calleeText: callee.text,
          receiverText: receiver,
          argumentCount: argumentsNode
            ? namedChildren(argumentsNode).filter((argument) => argument.type !== "comment").length
            : 0,
          lineNumber: node.startPosition.row + 1
        });
      }
    }
    namedChildren(node).forEach((child) => visit(child, nextStack));
  };
  visit(rootNode, []);
  return calls;
}

function importSpecifiers(node) {
  const clause = namedChildren(node).find((child) => child.type === "import_clause");
  if (!clause) return [];
  const values = [];
  for (const child of namedChildren(clause)) {
    if (child.type === "identifier") {
      values.push(child.text);
    } else if (child.type === "named_imports") {
      for (const specifier of namedChildren(child).filter((entry) => entry.type === "import_specifier")) {
        const imported = field(specifier, "name")?.text;
        const alias = field(specifier, "alias")?.text;
        if (imported) values.push(alias ? `${imported} as ${alias}` : imported);
      }
    } else if (child.type === "namespace_import") {
      const name = namedChildren(child).find((entry) => entry.type === "identifier")?.text;
      if (name) values.push(`* as ${name}`);
    }
  }
  return values;
}

function enrichImportCandidates(rootNode, candidates) {
  const specifiersByLine = new Map();
  walk(rootNode, (node) => {
    if (node.type !== "import_statement") return;
    specifiersByLine.set(node.startPosition.row + 1, importSpecifiers(node));
  });
  return candidates.map((candidate) => ({
    ...candidate,
    specifiers: specifiersByLine.get(candidate.lineNumber) ?? candidate.specifiers
  }));
}

function enrichTypeScript(rootNode, base) {
  const types = [];
  const methods = [];
  const functions = [];
  walk(rootNode, (node) => {
    if (TYPE_NODES.has(node.type)) {
      const parsed = parseType(node);
      if (parsed) {
        types.push(parsed.type);
        methods.push(...parsed.methods);
      }
    } else if (["function_declaration", "generator_function_declaration"].includes(node.type) && !insideType(node) && !insideCallable(node)) {
      const parsed = parseFunction(node);
      if (parsed) functions.push(parsed);
    } else if (node.type === "variable_declarator" && !insideType(node) && !insideCallable(node)) {
      const parsed = parseVariableFunction(node);
      if (parsed) functions.push(parsed);
    }
  });
  return {
    ...base,
    namespace: null,
    package: null,
    module: null,
    capabilityLevel: "enriched",
    supportedFacts: [...TS_SUPPORTED_FACTS],
    unsupportedFacts: ["operators", "partial-types"],
    types,
    methods,
    functions,
    importCandidates: enrichImportCandidates(rootNode, base.importCandidates),
    callCandidates: extractCallCandidates(rootNode),
    warnings: []
  };
}

export function enrichAnalysis(rootNode, { language, base }) {
  if ((language === "typescript" || language === "javascript") && Array.isArray(rootNode?.namedChildren)) {
    return enrichTypeScript(rootNode, base);
  }
  const types = Array.isArray(rootNode?.namedChildren) ? mergeGenericTypes(rootNode, language, base) : base.types;
  return {
    ...base,
    types,
    capabilityLevel: "baseline",
    supportedFacts: ["files", "types", "type-kinds", "qualified-names", "methods", "functions", "imports", "calls"],
    unsupportedFacts: [
      "member-kinds",
      "parameter-details",
      "visibility",
      "modifiers",
      "type-relations"
    ]
  };
}
