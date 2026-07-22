# Codebase Inspector Upstream-Reuse Design

Date: 2026-07-22  
Status: Proposed after scope simplification

## 1. Decision

Codebase Inspector will reuse the deterministic extractors already implemented by Egonex-AI/Understand-Anything instead of independently extending each language parser.

The selected approach is a vendored, executable JavaScript snapshot pinned to Understand-Anything commit `54754a6f97051d1d76c8758353d8ea41afe502a6`. The Skill will add only the runtime bridge and output adapter needed to run those extractors as a standalone GitHub Copilot Skill.

This replaces the earlier goal of building a richer, separately hardened parser implementation for every language.

## 2. Alternatives Considered

### A. Import a sibling Understand-Anything checkout

Rejected. It is simple locally but the Skill stops working after `.github/skills/codebase-inspector/` is copied into another repository.

### B. Depend on the complete Understand-Anything core package

Rejected. The local source is a workspace package rather than a stable standalone runtime dependency. This would bring build and workspace assumptions that are unrelated to the Skill.

### C. Vendor the deterministic extractor subset

Selected. The Skill ships the exact extractor subset it needs, with provenance and licenses, and remains standalone. Updating the upstream snapshot is an explicit maintenance operation rather than an implicit dependency upgrade.

## 3. Scope

The supported language set is exactly the set declared by the selected upstream extractors:

- JavaScript and TypeScript
- Python
- Rust
- Go
- Java
- Kotlin
- C#
- C and C++ where handled by the upstream C++ extractor
- PHP
- Ruby
- Dart

Shell analysis and languages without an upstream extractor are outside the first release.

The first release generates:

- `code-graph.json`
- `symbol-index.json`
- `classes.md`
- `methods.md`
- `functions.md`
- `analysis-report.json`

`symbol-index.json` is a thin normalized representation of upstream facts. It is not a new semantic-analysis engine.

## 4. Architecture

```text
Git tracked files
    |
    v
existing scanner and language detection
    |
    v
existing standalone Tree-sitter runtime
    |
    v
vendor/understand-anything/extractors/*.mjs
    |  StructuralAnalysis + CallGraphEntry
    v
thin upstream adapter
    |  ownership and stable IDs only
    +----> symbol-index.json
    +----> code-graph.json
    +----> classes.md
    +----> methods.md
    +----> functions.md
```

### 4.1 Vendored snapshot

The vendored directory contains mechanically converted ESM versions of upstream:

- `base-extractor.ts`
- `types.ts` as local interface documentation or runtime-free schema definitions
- each selected language extractor

Type-only imports are removed during conversion. Runtime imports are rewritten only to local vendored modules. Extractor behavior is otherwise kept aligned with upstream.

The snapshot includes:

- the upstream repository URL and pinned commit;
- a source-to-vendored-file manifest;
- source hashes;
- the applicable MIT license notice; and
- the separately required Dart grammar provenance.

### 4.2 Thin adapter

The adapter converts upstream `StructuralAnalysis` and `CallGraphEntry` output into stable records. Its responsibilities are limited to:

- normalized repository-relative paths;
- stable IDs;
- method ownership already reported by upstream class/type records;
- separation of owned methods from free functions;
- deterministic sorting;
- schema validation; and
- Markdown rendering from the normalized records.

The adapter must not infer architecture, business roles, semantic types, dynamic dispatch, or missing ownership.

### 4.3 Existing code disposition

The existing scanner, schema validation, stable JSON writer, Tree-sitter runtime, CLI foundation, and atomic output work remain reusable.

Custom TypeScript, Python, Rust, and Go extractor enhancements created before this design change will be replaced by or reduced to the vendored upstream snapshot. The replacement will be performed by normal commits so the history remains auditable.

## 5. Data Flow

1. Resolve the target Git worktree and tracked files.
2. Apply exclusions and language detection.
3. Parse each supported file with the existing local Tree-sitter runtime.
4. Invoke the corresponding vendored upstream extractor.
5. Collect upstream structure and call-graph records.
6. Normalize paths, IDs, ownership references, and ordering.
7. Validate all generated JSON.
8. Render Markdown indexes from the validated normalized data.
9. Publish output atomically.

A parser or extractor failure becomes a file-level warning. It does not cause the analyzer to invent missing records.

## 6. Security and Runtime Boundaries

- Analysis does not call an LLM, AI API, MCP server, or language server.
- Analysis does not execute target code, builds, tests, package scripts, or binaries.
- No runtime import points to an Understand-Anything checkout outside the Skill.
- After Skill dependency installation, analysis can run with outbound networking blocked.
- The analyzer reads tracked source files and emits structural information already exposed by the upstream extractors: names, line ranges, parameters, types, imports, exports, and call targets.
- The first release does not claim stronger source-redaction semantics than the pinned upstream extractors provide.
- Generated files contain no intentional source-body dump. Upstream-compatible syntax fragments such as signatures, type text, or call targets may appear where the extractor reports them.
- Symlink and repository-boundary protections remain owned by the existing scanner.

## 7. Compatibility Statement

`code-graph.json` preserves the useful outer graph shape expected from Understand-Anything-derived tooling, but it is not semantically equivalent to the LLM-backed `/understand` result.

The no-LLM Skill can deterministically report syntax-level structure and relationships. It cannot produce business understanding, architecture narratives, role inference, or natural-language explanations without a separate LLM reading the generated artifacts.

## 8. Testing Strategy

Testing is intentionally narrower than the superseded language-by-language reimplementation plan:

- port the relevant upstream extractor fixtures and expectations;
- smoke-test every registered language through the standalone registry;
- test adapter ownership and free-function separation;
- test deterministic JSON and Markdown output;
- test standalone execution after copying only the Skill directory;
- test that target repository scripts are never executed;
- test offline execution after dependency installation; and
- verify the vendored manifest, source hashes, and license inventory.

The release gate does not require exhaustive support for every valid grammar form. Upstream behavior and explicitly documented limitations are acceptable.

## 9. Update Policy

Upstream updates are deliberate:

1. choose a new Understand-Anything commit;
2. regenerate the vendored snapshot;
3. review the manifest and license changes;
4. run upstream-derived tests and Skill integration tests; and
5. commit the snapshot update separately from adapter changes.

Local language-specific patches should be avoided. A necessary patch must be small, documented in the manifest, and covered by a focused regression test.

## 10. Success Criteria

- The copied Skill runs without an Understand-Anything checkout.
- No LLM or target program is invoked during analysis.
- Every upstream-supported extractor can be loaded by the standalone registry.
- A representative repository produces the six declared artifacts.
- Classes, methods, and free functions remain distinguishable in JSON and Markdown.
- Repeated analysis of identical input produces byte-identical tracked output.
- Provenance, source hashes, and licenses are complete.
- The implementation contains no independent promise to support syntax beyond the pinned upstream extractor behavior.
