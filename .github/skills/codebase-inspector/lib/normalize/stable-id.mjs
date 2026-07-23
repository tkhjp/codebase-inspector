export function stableId(kind, ...parts) {
  return [kind, ...parts.map((part) => encodeURIComponent(String(part).replaceAll("\\", "/")))].join(":");
}

export function normalizedSignature(parameters = []) {
  return parameters.map((parameter) => {
    const type = parameter.type?.trim() || "?";
    const optional = parameter.optional ? "?" : "";
    const variadic = parameter.variadic ? "..." : "";
    return `${variadic}${type}${optional}`;
  }).join(",");
}

export function stableTypeId({ language, filePath, kind, qualifiedName, hasExplicitScope }) {
  const scope = hasExplicitScope ? qualifiedName : `${filePath}#${qualifiedName}`;
  return stableId("type", language, kind, scope);
}

export function stableMethodId({ ownerTypeId, kind, name, parameters, fallback }) {
  const signature = normalizedSignature(parameters);
  const parts = [ownerTypeId, kind, name, signature];
  if (fallback) parts.push(fallback);
  return stableId("method", ...parts);
}

export function stableFunctionId({ language, filePath, module, kind, name, parameters, fallback }) {
  const scope = module ? `${module}.${name}` : `${filePath}#${name}`;
  const parts = [language, kind, scope, normalizedSignature(parameters)];
  if (fallback) parts.push(fallback);
  return stableId("function", ...parts);
}

export function stablePropertyId({ ownerTypeId, kind, name, fallback }) {
  const parts = [ownerTypeId, kind, name];
  if (fallback) parts.push(fallback);
  return stableId("property", ...parts);
}
