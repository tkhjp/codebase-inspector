// Adapted from Egonex-AI/Understand-Anything at 54754a6f97051d1d76c8758353d8ea41afe502a6.
// Original project and this adaptation are licensed under MIT; see repository NOTICE.

/** Recursively traverse an AST tree, calling the visitor for each node. */
export function traverse(node, visitor) {
  visitor(node);
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child) traverse(child, visitor);
  }
}

/** Extract the unquoted string value from a string-like node. */
export function getStringValue(node) {
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child && child.type === "string_fragment") return child.text;
  }
  return node.text.replace(/^['"`]|['"`]$/g, "");
}

/** Find the first child matching a type. */
export function findChild(node, type) {
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child && child.type === type) return child;
  }
  return null;
}

/** Find all children matching a type. */
export function findChildren(node, type) {
  const result = [];
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child && child.type === type) result.push(child);
  }
  return result;
}

/** Check if a node has a child of the given type. */
export function hasChildOfType(node, type) {
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child && child.type === type) return true;
  }
  return false;
}
