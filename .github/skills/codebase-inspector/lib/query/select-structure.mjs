import { posix } from "node:path";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTypes(left, right) {
  return compareText(left.filePath, right.filePath)
    || left.lineRange[0] - right.lineRange[0]
    || compareText(left.name, right.name)
    || compareText(left.id, right.id);
}

function pathMatches(type, prefix) {
  if (!prefix) return true;
  return type.declarations.some((declaration) => (
    declaration.filePath === prefix || declaration.filePath.startsWith(`${prefix.replace(/\/+$/, "")}/`)
  ));
}

function typeIsPublic(type) {
  return type.visibility === "public" || type.exported === true;
}

function splitValue(type, file, splitBy) {
  if (splitBy === "language") return file.language;
  if (splitBy === "module") return type.module ?? "(module未取得)";
  if (splitBy === "package") return type.package ?? "(package未取得)";
  if (splitBy === "namespace") return type.namespace ?? "(namespace未取得)";
  if (splitBy === "path") return posix.dirname(type.filePath);
  return "all";
}

export function classificationFor(type) {
  return type.namespace ?? type.package ?? type.module ?? posix.dirname(type.filePath);
}

export function selectStructure(symbolIndex, filters) {
  const fileByPath = new Map(symbolIndex.files.map((file) => [file.path, file]));
  const propertyById = new Map(symbolIndex.properties.map((property) => [property.id, property]));
  const methodById = new Map(symbolIndex.methods.map((method) => [method.id, method]));
  let matched = symbolIndex.types.filter((type) => {
    const file = fileByPath.get(type.filePath);
    if (!pathMatches(type, filters.path)) return false;
    if (filters.language && file?.language !== filters.language) return false;
    if (filters.typeKind && type.kind !== filters.typeKind) return false;
    if (filters.visibility && type.visibility !== filters.visibility) return false;
    if (!filters.visibility && !filters.includeNonPublic && !typeIsPublic(type)) return false;
    if (filters.name && !type.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
    return true;
  }).sort(compareTypes);

  const matchedCount = matched.length;
  const truncated = matchedCount > filters.maxTypes;
  matched = matched.slice(0, filters.maxTypes);
  const typeIds = new Set(matched.map((type) => type.id));
  const memberVisible = (member) => (
    filters.includeNonPublic
    || member.visibility === "public"
  );
  const views = matched.map((type) => ({
    type,
    file: fileByPath.get(type.filePath),
    classification: classificationFor(type),
    properties: type.propertyIds.map((id) => propertyById.get(id)).filter(Boolean).filter(memberVisible)
      .sort((left, right) => compareText(left.filePath, right.filePath)
        || (left.lineRange?.[0] ?? 0) - (right.lineRange?.[0] ?? 0)
        || compareText(left.id, right.id)),
    methods: type.methodIds.map((id) => methodById.get(id)).filter(Boolean).filter(memberVisible)
      .sort((left, right) => compareText(left.filePath, right.filePath)
        || left.lineRange[0] - right.lineRange[0]
        || compareText(left.id, right.id))
  }));
  const visibleMemberIds = new Set(views.flatMap((view) => [
    ...view.properties.map((property) => property.id),
    ...view.methods.map((method) => method.id)
  ]));
  const outgoingRelations = symbolIndex.typeRelations.filter((relation) => {
    if (typeIds.has(relation.sourceId)) return true;
    const sourceMember = propertyById.get(relation.sourceId) ?? methodById.get(relation.sourceId);
    return sourceMember ? typeIds.has(sourceMember.ownerTypeId) : false;
  });
  const relations = outgoingRelations.filter((relation) => (
    typeIds.has(relation.sourceId) || visibleMemberIds.has(relation.sourceId)
  ));
  const groups = new Map();
  for (const view of views) {
    const key = splitValue(view.type, view.file, filters.splitBy);
    const entries = groups.get(key) ?? [];
    entries.push(view);
    groups.set(key, entries);
  }
  return {
    views,
    relations,
    groups: new Map([...groups].sort(([left], [right]) => compareText(left, right))),
    matchedCount,
    selectedCount: views.length,
    truncated,
    omittedCount: Math.max(0, matchedCount - views.length),
    omittedRelationCount: outgoingRelations.length - relations.length,
    typeIds
  };
}
