# Issue #1 Structure Documents Implementation Plan

Date: 2026-07-23
Status: Complete
Base commit: `1561edb`
Target release: `0.2.0`

## 1. Constraints

- Keep `.github/skills/codebase-inspector/` as the complete distributable Skill.
- Keep analysis deterministic, local, and independent of LLMs, MCP servers, language servers, and target-code execution.
- Keep the pinned Understand-Anything extractors as the baseline parser implementation.
- Use `symbol-index.json` as the authoritative persisted snapshot.
- Keep `code-graph.json` as an Understand-Anything compatibility projection.
- Render filtered documents from an existing snapshot without reparsing source files.
- Preserve both repository-root ZIP distributions.

## 2. Target Data Flow

```text
tracked files
  -> Tree-sitter parse
  -> vendored Understand-Anything extraction
  -> deterministic AST enrichment
  -> symbol-index.json schema 2.0.0
       -> code-graph.json compatibility projection
       -> existing indexes
       -> filtered structure selection
       -> クラス定義書.md
       -> クラス図.md
```

## 3. Symbol Index 2.0

- Promote properties and enum members to first-class records with stable IDs.
- Add qualified names, declaration kind, callable kind, namespace/package/module, visibility, modifiers, type parameters, export state, and source ranges.
- Preserve parameter order, type, default text, optional state, and variadic state when available.
- Represent unavailable facts as `known`, `not-declared`, `unsupported`, or `failed`.
- Base type identity on qualified name and callable identity on owner, kind, name, and normalized signature. Use source location only as a fallback for anonymous or otherwise indistinguishable declarations.
- Store inheritance, implementation, nesting, mixin, and type-reference relations separately from imports and calls.
- Preserve ambiguous call candidates instead of selecting one.
- Store structural fingerprints and reject schema 1.x snapshots in the renderer with reanalysis guidance.

## 4. Extraction

- Parse every source file once.
- Run the pinned upstream extractor first.
- Run a deterministic language enrichment pass against the same Tree-sitter root.
- Merge records by declaration range and name without inventing semantic facts.
- Support all existing languages at their available syntax level and publish a capability matrix.

## 5. Snapshot Renderer

Add a `render` command:

```text
/codebase-inspector render
  [--snapshot <symbol-index.json>]
  [--path <prefix>]
  [--language <name>]
  [--type-kind <kind>]
  [--visibility <visibility>]
  [--name <text>]
  [--include-non-public]
  [--omit-diagram-members]
  [--max-types <count>]
  [--split-size <count>]
  [--split-by <none|language|module|package|namespace|path>]
  [--output <dir>]
  [--definition-output <name>]
  [--diagram-output <name>]
```

The command writes `クラス定義書.md`, `クラス図.md`, and
`structure-render-report.json`. Both Markdown files must use the same selected
type IDs.

## 6. Compatibility

- Bump Skill/package version to `0.2.0`.
- Bump `symbol-index.json` and `analysis-report.json` to `2.0.0`.
- Keep `code-graph.json` version `1.0.0` and its existing node/edge vocabulary.
- Existing analysis invocation remains valid.
- A schema 1.x snapshot is not migrated silently; users are told to rerun analysis.
- Existing six analysis artifacts remain present. Rendering creates three separate artifacts in its selected output directory.

## 7. Test Gates

- Stable identity across inserted lines and repeated analysis.
- Namespace/package-separated same-name types and same-name methods.
- Overloads, constructors, getters, setters, operators, generics, nested types, enums, and enum members.
- Windows path normalization and absence of absolute paths.
- Resolved, ambiguous, unresolved, and dynamic call reporting.
- Inheritance, implementation, nesting, and property/parameter/return type references.
- Deterministic filtering, splitting, Japanese Markdown, and Mermaid syntax.
- Matching type sets between definition and diagram.
- Existing no-network/no-target-execution, atomic output, standalone copy, and cross-platform release tests.
- Slim and bundled ZIP verification on macOS, Linux, and Windows.

## 8. Delivery Sequence

1. Schema 2.0 and stable identity.
2. Shared enrichment and language capability reporting.
3. Type/call relationship resolution and fingerprints.
4. Snapshot filtering and document rendering.
5. Documentation, migration guidance, complete test suite, ZIP rebuild, push, and GitHub Actions verification.
