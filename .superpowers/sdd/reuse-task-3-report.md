# Task 3 Report: Code Graph, Analysis Report, and Markdown Indexes

## Implementation

Implemented the four fact-only artifact projections:

- `buildCodeGraph(symbolIndex, { analyzedAt })` projects canonical File, Type, Method, and Function IDs into schema-valid graph nodes. It creates only membership, resolved import, and resolved call edges, keeps `layers` and `tour` empty, and uses empty summaries, tags, and simple complexity.
- `buildAnalysisReport(...)` projects Symbol Index coverage, scanner warnings, parser warnings, unsupported paths, Task 2 relationship counts, and CLI options without new interpretation. Parser failures determine `complete` versus `partial`.
- `renderMarkdownIndexes(symbolIndex)` renders the three sorted indexes directly from Symbol Index facts.
- `serializeArtifacts(...)` validates the three JSON documents, uses `stableStringify`, LF-normalizes every output, and returns exactly the six required filenames.

No source files are reparsed and no semantic or LLM-derived fields are added.

## TDD Evidence

### RED

Before any production module existed, ran:

```text
cd .github/skills/codebase-inspector
npm test -- --run tests/unit/code-graph-builder.test.mjs tests/unit/analysis-report-builder.test.mjs tests/unit/markdown-renderer.test.mjs
```

Result: 3 failed suites, 0 collected tests. Each failed because its new production import did not exist:

```text
Cannot find module '../../lib/graph/build-code-graph.mjs'
Cannot find module '../../lib/reports/build-analysis-report.mjs'
Cannot find module '../../lib/output/artifacts.mjs'
```

This was the expected RED state for the absent Task 3 builders.

### GREEN

After the minimal implementations, the same focused command passed:

```text
Test Files  3 passed (3)
Tests       4 passed (4)
```

One initial GREEN run exposed an ordering defect in `contains` edges: lexical target IDs sorted `function` before `type`. The graph projection was corrected to order canonical membership families as Type, Method, Function, then the focused tests passed. A final review also made the complete node array path- and line-sorted.

## Golden File Decisions

The three golden files fix the public Markdown shape and ending newline behavior:

- `classes.md`: class kind, file, inclusive line range, method count, property count.
- `methods.md`: resolved canonical owner name, parameter name/type pairs, return type.
- `functions.md`: parameter name/type pairs and return type.

The test fixture includes an owner name and parameter name containing `|`, an embedded newline in a parameter name and return type, and `null` types. Expected output escapes pipes as `\|`, changes embedded newlines to spaces, and renders null as `-`. Tables use the required headers and exactly one trailing LF.

## Changed Files

- `.github/skills/codebase-inspector/lib/graph/build-code-graph.mjs`
- `.github/skills/codebase-inspector/lib/reports/build-analysis-report.mjs`
- `.github/skills/codebase-inspector/lib/reports/render-markdown.mjs`
- `.github/skills/codebase-inspector/lib/output/artifacts.mjs`
- `.github/skills/codebase-inspector/tests/unit/code-graph-builder.test.mjs`
- `.github/skills/codebase-inspector/tests/unit/analysis-report-builder.test.mjs`
- `.github/skills/codebase-inspector/tests/unit/markdown-renderer.test.mjs`
- `.github/skills/codebase-inspector/tests/fixtures/golden/classes.md`
- `.github/skills/codebase-inspector/tests/fixtures/golden/methods.md`
- `.github/skills/codebase-inspector/tests/fixtures/golden/functions.md`

## Verification

Focused tests:

```text
3 test files passed, 4 tests passed
```

Full suite:

```text
npm test
Test Files  17 passed (17)
Tests       78 passed (78)
```

Lint:

```text
npm run lint
eslint .
exit 0
```

Diff check:

```text
git diff --check
exit 0; no whitespace errors
```

Byte-determinism probe built the graph, report, Markdown, and serialized artifacts twice from identical facts:

```text
byteEqual=true
sha256=7f4d66c3b173f8347cb3cade4cd728294d63e3577d71c9a3590763f281585dd8
filenames=symbol-index.json,code-graph.json,analysis-report.json,classes.md,methods.md,functions.md
```

## Self-Review

- Canonical IDs are preserved for every graph node and edge endpoint; unresolved calls do not produce graph edges.
- Methods intentionally use graph node type `function`.
- Graph project time comes only from the supplied `analyzedAt` argument; no wall-clock API is used.
- Graph and Markdown order is explicit, report path lists are sorted, and text output is LF-normalized with one trailing LF.
- `relationshipCounts` is copied unchanged into report fields, preserving Task 2 internal/external/unresolved import and resolved/unresolved call totals.
- JSON validation occurs immediately before serialization for Symbol Index, Code Graph, and Analysis Report.
- Scope is limited to Task 3 projections, tests, goldens, and this report.

Concerns: none.
