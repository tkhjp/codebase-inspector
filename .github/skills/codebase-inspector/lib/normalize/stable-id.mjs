export function stableId(kind, ...parts) {
  return [kind, ...parts.map((part) => encodeURIComponent(String(part).replaceAll("\\", "/")))].join(":");
}
