import { resolveRelationships } from "./relationships.mjs";
import {
  normalizedSignature,
  stableFunctionId,
  stableId,
  stableMethodId,
  stablePropertyId,
  stableTypeId
} from "./stable-id.mjs";
import { structuralFingerprint } from "./structural-fingerprint.mjs";
import { parseSymbolIndexV2 } from "../schema/symbol-index.mjs";

const BUILTIN_TYPES = new Set([
  "any", "bigint", "bool", "boolean", "byte", "char", "double", "dynamic",
  "float", "i8", "i16", "i32", "i64", "i128", "int", "integer", "long",
  "never", "number", "object", "short", "size_t", "str", "string", "symbol",
  "u8", "u16", "u32", "u64", "u128", "uint", "ulong", "undefined", "unknown",
  "usize", "void"
]);
const TYPE_KEYWORDS = new Set([
  "Array", "Dict", "Dictionary", "List", "Map", "None", "Nullable", "Option",
  "Promise", "Result", "Set", "Task", "Tuple"
]);
const BASELINE_FACTS = Object.freeze(["files", "types", "methods", "functions", "imports", "calls"]);
const ENRICHED_FACTS = Object.freeze([
  ...BASELINE_FACTS,
  "qualified-names",
  "type-kinds",
  "member-kinds",
  "parameters",
  "return-types",
  "visibility",
  "modifiers",
  "type-relations"
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSymbols(left, right) {
  return compareText(left.filePath, right.filePath)
    || left.lineRange[0] - right.lineRange[0]
    || compareText(left.id, right.id);
}

function compareRelations(left, right) {
  return compareText(left.sourceId, right.sourceId)
    || compareText(left.kind, right.kind)
    || compareText(left.origin, right.origin)
    || compareText(left.targetName, right.targetName)
    || compareText(left.id, right.id);
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))].sort(compareText);
}

function factStatus(value, explicitStatus, fallback = "unsupported") {
  if (explicitStatus) return explicitStatus;
  return value === null || value === undefined ? fallback : "known";
}

function normalizedParameter(raw, position) {
  return {
    position: raw.position ?? position,
    name: raw.name,
    type: raw.type ?? null,
    typeStatus: factStatus(raw.type, raw.typeStatus),
    defaultValue: raw.defaultValue ?? null,
    defaultStatus: factStatus(raw.defaultValue, raw.defaultStatus, "not-declared"),
    optional: raw.optional ?? false,
    variadic: raw.variadic ?? false
  };
}

function callableFields(raw, id, kind, filePath) {
  const parameters = raw.parameters.map(normalizedParameter);
  const canonical = {
    id,
    kind,
    name: raw.name,
    filePath,
    lineRange: [...raw.lineRange],
    signature: normalizedSignature(parameters),
    parameters,
    returnType: raw.returnType ?? null,
    returnTypeStatus: factStatus(raw.returnType, raw.returnTypeStatus, kind === "constructor" ? "not-declared" : "unsupported"),
    visibility: raw.visibility ?? null,
    visibilityStatus: factStatus(raw.visibility, raw.visibilityStatus),
    modifiers: uniqueSorted(raw.modifiers ?? []),
    typeParameters: [...(raw.typeParameters ?? [])],
    async: raw.async ?? null,
    exported: raw.exported ?? null
  };
  return {
    ...canonical,
    structuralFingerprint: structuralFingerprint({
      kind: canonical.kind,
      name: canonical.name,
      signature: canonical.signature,
      parameters: canonical.parameters,
      returnType: canonical.returnType,
      returnTypeStatus: canonical.returnTypeStatus,
      visibility: canonical.visibility,
      visibilityStatus: canonical.visibilityStatus,
      modifiers: canonical.modifiers,
      typeParameters: canonical.typeParameters,
      async: canonical.async,
      exported: canonical.exported
    })
  };
}

function canonicalProject(project, skillVersion) {
  return {
    name: project.name,
    root: project.root,
    gitCommitHash: project.gitCommitHash,
    workingTreeDirty: project.workingTreeDirty,
    languages: [...project.languages].sort(compareText),
    skillVersion
  };
}

function explicitScope(raw, analysis) {
  return {
    namespace: raw.namespace ?? analysis.namespace ?? null,
    package: raw.package ?? analysis.package ?? null,
    module: raw.module ?? analysis.module ?? null
  };
}

function qualifiedName(raw, scope) {
  if (raw.qualifiedName) return raw.qualifiedName;
  const prefix = scope.namespace ?? scope.package ?? scope.module;
  return prefix ? `${prefix}.${raw.name}` : raw.name;
}

function typeIdentity(raw, analysis) {
  const scope = explicitScope(raw, analysis);
  const name = qualifiedName(raw, scope);
  return {
    scope,
    qualifiedName: name,
    id: stableTypeId({
      language: analysis.language,
      filePath: analysis.filePath,
      kind: raw.kind,
      qualifiedName: name,
      hasExplicitScope: Boolean(
        scope.namespace
        || scope.package
        || scope.module
        || (raw.qualifiedName && raw.qualifiedName !== raw.name)
      )
    })
  };
}

function collisionFallback(baseId, seenIds, filePath, lineRange) {
  if (!seenIds.has(baseId)) return null;
  const fileFallback = filePath;
  const fileId = stableId("collision", baseId, fileFallback);
  if (!seenIds.has(fileId)) return fileFallback;
  return `${filePath}:${lineRange[0]}-${lineRange[1]}`;
}

function createProperty(raw, owner, filePath, seenIds) {
  const kind = raw.kind ?? "property";
  const baseId = stablePropertyId({ ownerTypeId: owner.id, kind, name: raw.name });
  const fallback = collisionFallback(baseId, seenIds, filePath, raw.lineRange ?? owner.lineRange);
  const id = stablePropertyId({ ownerTypeId: owner.id, kind, name: raw.name, fallback });
  seenIds.add(id);
  const canonical = {
    id,
    name: raw.name,
    kind,
    ownerTypeId: owner.id,
    filePath,
    lineRange: raw.lineRange === null || raw.lineRange === undefined ? null : [...raw.lineRange],
    type: raw.type ?? null,
    typeStatus: factStatus(raw.type, raw.typeStatus),
    defaultValue: raw.defaultValue ?? null,
    defaultStatus: factStatus(raw.defaultValue, raw.defaultStatus, "not-declared"),
    visibility: raw.visibility ?? null,
    visibilityStatus: factStatus(raw.visibility, raw.visibilityStatus),
    modifiers: uniqueSorted(raw.modifiers ?? []),
    static: raw.static ?? null,
    explicitValue: raw.explicitValue ?? null
  };
  return {
    ...canonical,
    structuralFingerprint: structuralFingerprint({
      kind: canonical.kind,
      name: canonical.name,
      type: canonical.type,
      typeStatus: canonical.typeStatus,
      defaultValue: canonical.defaultValue,
      defaultStatus: canonical.defaultStatus,
      visibility: canonical.visibility,
      visibilityStatus: canonical.visibilityStatus,
      modifiers: canonical.modifiers,
      static: canonical.static,
      explicitValue: canonical.explicitValue
    })
  };
}

function typeNames(typeText) {
  if (!typeText) return [];
  return uniqueSorted((String(typeText).match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) ?? [])
    .filter((name) => !TYPE_KEYWORDS.has(name)));
}

function relationTarget(name, typesByName) {
  const matches = typesByName.get(name) ?? [];
  if (matches.length === 1) return { targetId: matches[0].id, targetCategory: "internal" };
  if (matches.length > 1) return { targetId: null, targetCategory: "unresolved" };
  if (BUILTIN_TYPES.has(name.toLowerCase())) return { targetId: null, targetCategory: "builtin" };
  if (/^[A-Z_$]/.test(name) || name.includes(".")) return { targetId: null, targetCategory: "external" };
  return { targetId: null, targetCategory: "unresolved" };
}

function buildTypeRelations({ types, properties, methods, functions }) {
  const typesByName = new Map();
  for (const type of types) {
    for (const name of new Set([type.name, type.qualifiedName])) {
      const entries = typesByName.get(name) ?? [];
      entries.push(type);
      typesByName.set(name, entries);
    }
  }
  const typeById = new Map(types.map((type) => [type.id, type]));
  const propertyById = new Map(properties.map((property) => [property.id, property]));
  const methodById = new Map(methods.map((method) => [method.id, method]));
  const sourceTypeFor = (sourceId) => {
    if (typeById.has(sourceId)) return typeById.get(sourceId);
    const ownerId = propertyById.get(sourceId)?.ownerTypeId ?? methodById.get(sourceId)?.ownerTypeId;
    return ownerId ? typeById.get(ownerId) : null;
  };
  const relations = [];
  const add = ({ kind, sourceId, targetName, origin }) => {
    if (!targetName) return;
    const sourceType = sourceTypeFor(sourceId);
    let target = relationTarget(targetName, typesByName);
    if (target.targetCategory === "unresolved" && sourceType) {
      const scopedMatches = (typesByName.get(targetName) ?? []).filter((candidate) => (
        candidate.namespace === sourceType.namespace
        && candidate.package === sourceType.package
        && candidate.module === sourceType.module
      ));
      if (scopedMatches.length === 1) target = { targetId: scopedMatches[0].id, targetCategory: "internal" };
    }
    const id = stableId("relation", kind, sourceId, origin, targetName);
    if (relations.some((relation) => relation.id === id)) return;
    relations.push({ id, kind, sourceId, targetName, origin, ...target });
  };

  for (const type of types) {
    const declarationTarget = (value) => typeNames(value).find((name) => !type.typeParameters.includes(name)) ?? value;
    type.extends.forEach((name) => add({ kind: "inherits", sourceId: type.id, targetName: declarationTarget(name), origin: "declaration" }));
    type.implements.forEach((name) => add({ kind: "implements", sourceId: type.id, targetName: declarationTarget(name), origin: "declaration" }));
    type.mixins.forEach((name) => add({ kind: "mixin", sourceId: type.id, targetName: declarationTarget(name), origin: "declaration" }));
    const separator = type.qualifiedName.lastIndexOf(".");
    if (separator > 0) {
      const parentName = type.qualifiedName.slice(0, separator);
      if ((typesByName.get(parentName) ?? []).length === 1) {
        add({ kind: "nested", sourceId: type.id, targetName: parentName, origin: "declaration" });
      }
    }
  }
  for (const property of properties) {
    const owner = typeById.get(property.ownerTypeId);
    typeNames(property.type)
      .filter((name) => !owner?.typeParameters.includes(name))
      .forEach((name) => add({ kind: "references", sourceId: property.id, targetName: name, origin: "property-type" }));
  }
  for (const callable of [...methods, ...functions]) {
    const owner = "ownerTypeId" in callable ? typeById.get(callable.ownerTypeId) : null;
    callable.parameters.forEach((parameter) => {
      typeNames(parameter.type)
        .filter((name) => !owner?.typeParameters.includes(name))
        .forEach((name) => add({ kind: "references", sourceId: callable.id, targetName: name, origin: "parameter-type" }));
    });
    typeNames(callable.returnType)
      .filter((name) => !owner?.typeParameters.includes(name))
      .forEach((name) => add({ kind: "references", sourceId: callable.id, targetName: name, origin: "return-type" }));
  }
  return relations.sort(compareRelations);
}

function languageCapabilities(analyses) {
  const byLanguage = new Map();
  for (const analysis of analyses) {
    const current = byLanguage.get(analysis.language);
    const level = analysis.capabilityLevel ?? "baseline";
    const supportedFacts = analysis.supportedFacts ?? (level === "enriched" ? ENRICHED_FACTS : BASELINE_FACTS);
    const unsupportedFacts = analysis.unsupportedFacts ?? (level === "enriched" ? [] : ENRICHED_FACTS.filter((fact) => !BASELINE_FACTS.includes(fact)));
    if (!current || (current.level === "baseline" && level === "enriched")) {
      byLanguage.set(analysis.language, {
        language: analysis.language,
        level,
        supportedFacts: uniqueSorted(supportedFacts),
        unsupportedFacts: uniqueSorted(unsupportedFacts)
      });
    }
  }
  return [...byLanguage.values()].sort((left, right) => compareText(left.language, right.language));
}

export function buildSymbolIndex({ project, scan, analyses, skillVersion, resolvedImportsByPath = new Map() }) {
  const analysisByPath = new Map();
  for (const analysis of analyses) {
    if (analysisByPath.has(analysis.filePath)) throw new Error(`Duplicate raw analysis for ${analysis.filePath}`);
    analysisByPath.set(analysis.filePath, analysis);
  }

  const trackedFiles = [...scan.files, ...scan.unsupportedFiles].sort((left, right) => compareText(left.path, right.path));
  const files = trackedFiles.map((file) => ({
    id: stableId("file", file.path),
    path: file.path,
    language: file.language,
    category: file.category,
    lineCount: file.lineCount,
    parseStatus: file.category === "unsupported"
      ? "unsupported"
      : (analysisByPath.get(file.path)?.warnings.length ? "warning" : "parsed"),
    typeIds: [],
    propertyIds: [],
    methodIds: [],
    functionIds: []
  }));
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const typeById = new Map();
  const ownerMaps = new Map();

  for (const analysis of [...analyses].sort((left, right) => compareText(left.filePath, right.filePath))) {
    const file = fileByPath.get(analysis.filePath);
    if (!file) throw new Error(`Raw analysis does not match a tracked file: ${analysis.filePath}`);
    const owners = new Map();
    for (const raw of analysis.types) {
      const identity = typeIdentity(raw, analysis);
      let type = typeById.get(identity.id);
      const declaration = { filePath: analysis.filePath, lineRange: [...raw.lineRange] };
      if (!type) {
        type = {
          id: identity.id,
          kind: raw.kind,
          name: raw.name,
          qualifiedName: identity.qualifiedName,
          filePath: analysis.filePath,
          lineRange: [...raw.lineRange],
          declarations: [declaration],
          ...identity.scope,
          visibility: raw.visibility ?? null,
          visibilityStatus: factStatus(raw.visibility, raw.visibilityStatus),
          modifiers: uniqueSorted(raw.modifiers ?? []),
          typeParameters: [...(raw.typeParameters ?? [])],
          propertyIds: [],
          methodIds: [],
          extends: uniqueSorted(raw.extends),
          implements: uniqueSorted(raw.implements),
          mixins: uniqueSorted(raw.mixins ?? []),
          exported: raw.exported ?? null,
          structuralFingerprint: "0".repeat(64)
        };
        typeById.set(type.id, type);
      } else {
        type.declarations.push(declaration);
        type.modifiers = uniqueSorted([...type.modifiers, ...(raw.modifiers ?? [])]);
        type.typeParameters = [...new Set([...type.typeParameters, ...(raw.typeParameters ?? [])])];
        type.extends = uniqueSorted([...type.extends, ...raw.extends]);
        type.implements = uniqueSorted([...type.implements, ...raw.implements]);
        type.mixins = uniqueSorted([...type.mixins, ...(raw.mixins ?? [])]);
        if (type.visibility === null && raw.visibility !== null && raw.visibility !== undefined) {
          type.visibility = raw.visibility;
          type.visibilityStatus = factStatus(raw.visibility, raw.visibilityStatus);
        }
        if (raw.exported === true) type.exported = true;
      }
      file.typeIds.push(type.id);
      const byName = owners.get(raw.name) ?? [];
      byName.push({ type, raw });
      owners.set(raw.name, byName);
    }
    ownerMaps.set(analysis.filePath, owners);
  }

  const properties = [];
  const methods = [];
  const functions = [];
  const seenPropertyIds = new Set();
  const seenMethodIds = new Set();
  const seenFunctionIds = new Set();

  for (const analysis of [...analyses].sort((left, right) => compareText(left.filePath, right.filePath))) {
    const file = fileByPath.get(analysis.filePath);
    const owners = ownerMaps.get(analysis.filePath);
    for (const entries of owners.values()) {
      entries.forEach(({ type, raw }) => {
        raw.properties.forEach((property) => {
          const canonical = createProperty(property, type, analysis.filePath, seenPropertyIds);
          properties.push(canonical);
          type.propertyIds.push(canonical.id);
          file.propertyIds.push(canonical.id);
        });
      });
    }

    for (const raw of analysis.methods) {
      const matches = owners.get(raw.ownerName) ?? [];
      const containing = matches.filter(({ raw: owner }) => raw.lineRange[0] >= owner.lineRange[0] && raw.lineRange[1] <= owner.lineRange[1]);
      const selected = containing.length === 1 ? containing[0] : (matches.length === 1 ? matches[0] : null);
      if (!selected) throw new Error(`Method owner is not unique in ${analysis.filePath}: ${raw.ownerName}`);
      const kind = raw.kind ?? "method";
      const parameters = raw.parameters.map(normalizedParameter);
      const baseId = stableMethodId({ ownerTypeId: selected.type.id, kind, name: raw.name, parameters });
      const fallback = collisionFallback(baseId, seenMethodIds, analysis.filePath, raw.lineRange);
      const id = stableMethodId({ ownerTypeId: selected.type.id, kind, name: raw.name, parameters, fallback });
      seenMethodIds.add(id);
      const method = {
        ...callableFields(raw, id, kind, analysis.filePath),
        ownerTypeId: selected.type.id,
        static: raw.static ?? null
      };
      methods.push(method);
      selected.type.methodIds.push(method.id);
      file.methodIds.push(method.id);
    }

    for (const raw of analysis.functions) {
      const kind = raw.kind ?? "function";
      const parameters = raw.parameters.map(normalizedParameter);
      const baseId = stableFunctionId({
        language: analysis.language,
        filePath: analysis.filePath,
        module: analysis.module ?? null,
        kind,
        name: raw.name,
        parameters
      });
      const fallback = collisionFallback(baseId, seenFunctionIds, analysis.filePath, raw.lineRange);
      const id = stableFunctionId({
        language: analysis.language,
        filePath: analysis.filePath,
        module: analysis.module ?? null,
        kind,
        name: raw.name,
        parameters,
        fallback
      });
      seenFunctionIds.add(id);
      const func = callableFields(raw, id, kind, analysis.filePath);
      functions.push(func);
      file.functionIds.push(func.id);
    }
  }

  const types = [...typeById.values()];
  for (const type of types) {
    type.declarations.sort((left, right) => compareText(left.filePath, right.filePath) || left.lineRange[0] - right.lineRange[0]);
    type.filePath = type.declarations[0].filePath;
    type.lineRange = [...type.declarations[0].lineRange];
    type.propertyIds = uniqueSorted(type.propertyIds);
    type.methodIds = uniqueSorted(type.methodIds);
    type.structuralFingerprint = structuralFingerprint({
      kind: type.kind,
      qualifiedName: type.qualifiedName,
      namespace: type.namespace,
      package: type.package,
      module: type.module,
      visibility: type.visibility,
      visibilityStatus: type.visibilityStatus,
      modifiers: type.modifiers,
      typeParameters: type.typeParameters,
      properties: type.propertyIds.map((id) => properties.find((property) => property.id === id)?.structuralFingerprint),
      methods: type.methodIds.map((id) => methods.find((method) => method.id === id)?.structuralFingerprint),
      extends: type.extends,
      implements: type.implements,
      mixins: type.mixins,
      exported: type.exported
    });
  }
  types.sort(compareSymbols);
  properties.sort((left, right) => compareText(left.filePath, right.filePath) || (left.lineRange?.[0] ?? 0) - (right.lineRange?.[0] ?? 0) || compareText(left.id, right.id));
  methods.sort(compareSymbols);
  functions.sort(compareSymbols);
  files.forEach((file) => {
    file.typeIds = uniqueSorted(file.typeIds);
    file.propertyIds = uniqueSorted(file.propertyIds);
    file.methodIds = uniqueSorted(file.methodIds);
    file.functionIds = uniqueSorted(file.functionIds);
  });

  const indexDraft = { files, types, properties, methods, functions };
  const relationships = resolveRelationships(indexDraft, analyses, resolvedImportsByPath);
  const unresolvedCalls = relationships.unresolvedCalls.map((call) => ({ ...call, candidateIds: call.candidateIds ?? [] }));
  const typeRelations = buildTypeRelations(indexDraft);
  const capabilities = languageCapabilities(analyses);
  const warningFiles = scan.files.filter((file) => analysisByPath.get(file.path)?.warnings.length).length;
  const projectRecord = canonicalProject(project, skillVersion);
  const snapshotFingerprint = structuralFingerprint({
    project: projectRecord,
    files: files.map(({ id, path, language, parseStatus }) => ({ id, path, language, parseStatus })),
    types: types.map(({ id, structuralFingerprint: fingerprint }) => ({ id, fingerprint })),
    properties: properties.map(({ id, structuralFingerprint: fingerprint }) => ({ id, fingerprint })),
    methods: methods.map(({ id, structuralFingerprint: fingerprint }) => ({ id, fingerprint })),
    functions: functions.map(({ id, structuralFingerprint: fingerprint }) => ({ id, fingerprint })),
    imports: relationships.imports,
    calls: relationships.calls,
    unresolvedCalls,
    typeRelations
  });
  const symbolIndex = parseSymbolIndexV2({
    schemaVersion: "2.0.0",
    snapshotFingerprint,
    project: projectRecord,
    ...indexDraft,
    imports: relationships.imports,
    calls: relationships.calls,
    unresolvedCalls,
    typeRelations,
    languageCapabilities: capabilities,
    coverage: {
      trackedFiles: trackedFiles.length,
      supportedFiles: scan.files.length,
      parsedFiles: scan.files.length - warningFiles,
      warningFiles,
      unsupportedFiles: scan.unsupportedFiles.length
    }
  });

  return { symbolIndex, relationshipCounts: relationships.relationshipCounts };
}
