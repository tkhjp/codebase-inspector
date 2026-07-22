# Codebase Inspector Upstream-Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish a standalone, no-LLM GitHub Copilot Skill by reusing the deterministic extractor set pinned from Understand-Anything and adding only the adapter, artifact generation, runtime, and packaging needed for `code-graph.json`, symbol JSON, and class/method/function Markdown indexes.

**Architecture:** Keep the scanner, schemas, stable JSON writer, and Tree-sitter runtime already present at baseline commit `708918e`. Replace custom language implementations with a mechanically generated vendored snapshot of the pinned Understand-Anything extractor subset, bridge the upstream `StructuralAnalysis` shape into the existing raw schema, normalize only syntax-level facts, and publish validated artifacts atomically.

**Tech Stack:** Node.js 22, JavaScript ES modules, `web-tree-sitter`, pinned Tree-sitter WASM packages, vendored Dart WASM, Zod 4, Vitest, ESLint, Git, and esbuild as a development-only snapshot generator.

## Global Constraints

- The complete runtime unit is `.github/skills/codebase-inspector/`; it must work after that directory alone is copied into another Git repository.
- Runtime requires Node.js 22 or newer and Git. `node_modules` is not bundled.
- Analysis must not call an LLM, AI API, MCP server, language server, target build, target test, target package script, or target executable.
- After dependency installation, analysis must work with outbound networking blocked.
- Supported languages are exactly those declared by the pinned Understand-Anything extractor snapshot: JavaScript, TypeScript, Python, Rust, Go, Java, Kotlin, C#, C/C++, PHP, Ruby, and Dart. Shell is unsupported.
- Upstream source is pinned to Egonex-AI/Understand-Anything commit `54754a6f97051d1d76c8758353d8ea41afe502a6`.
- Vendored files retain source provenance, SHA-256 hashes, MIT licensing, and the Dart grammar license inventory.
- No runtime import may resolve to a sibling Understand-Anything checkout or another Skill.
- The adapter may normalize paths, stable IDs, ownership reported by upstream, ordering, and conservative relationships. It must not infer architecture, business meaning, semantic types, or dynamic dispatch.
- Upstream extractor limitations are acceptable and documented. Exhaustive grammar coverage is not a release requirement.
- Generated paths use `/`, generated text uses LF, and identical input produces byte-identical tracked output.
- Default output is `.code-understanding/`; supported options remain `--tracked`, `--output <dir>`, and `--keep-intermediate`.
- Fatal failures preserve the previous successful output. Per-file parser failures produce schema-valid partial output with warnings.
- The repository and adapted upstream code are MIT licensed.

---

### Task 1: Vendored Upstream Snapshot and Runtime Bridge

**Files:**
- Create: `tools/vendor-understand-anything.mjs`
- Create: `.github/skills/codebase-inspector/vendor/understand-anything/manifest.json`
- Create: `.github/skills/codebase-inspector/vendor/understand-anything/extractors/base-extractor.mjs`
- Create: `.github/skills/codebase-inspector/vendor/understand-anything/extractors/{typescript,python,rust,go,java,kotlin,csharp,cpp,php,ruby,dart}-extractor.mjs`
- Create: `.github/skills/codebase-inspector/lib/extractors/upstream-adapter.mjs`
- Modify: `.github/skills/codebase-inspector/lib/parsers/registry.mjs`
- Modify: `.github/skills/codebase-inspector/lib/parsers/tree-sitter-runtime.mjs`
- Modify: `.github/skills/codebase-inspector/lib/scanner/languages.mjs`
- Modify: `.github/skills/codebase-inspector/package.json`
- Modify: `.github/skills/codebase-inspector/package-lock.json`
- Delete: `.github/skills/codebase-inspector/lib/extractors/{base,typescript,python,rust,go}-extractor.mjs`
- Replace tests: `.github/skills/codebase-inspector/tests/languages/{typescript,python,rust,go}.test.mjs`
- Create test: `.github/skills/codebase-inspector/tests/languages/upstream-snapshot.test.mjs`
- Create test: `.github/skills/codebase-inspector/tests/unit/vendor-manifest.test.mjs`

**Interfaces:**
- Consumes upstream methods: `extractor.extractStructure(rootNode)` and `extractor.extractCallGraph(rootNode)`.
- Produces `createUpstreamAdapter(extractor): { extract(rootNode, context): RawFileAnalysis }`.
- Produces `createParserRegistry(skillDir): { languages, analyzeFile(file), close() }` for exactly the upstream-supported languages.

- [ ] **Step 1: Write failing manifest and registry tests**

Create `vendor-manifest.test.mjs` to assert the pinned commit, the exact eleven source extractor names, nonempty source/generated SHA-256 values, and no undeclared local patches:

```js
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const expected = ["cpp", "csharp", "dart", "go", "java", "kotlin", "php", "python", "ruby", "rust", "typescript"];

describe("vendored Understand-Anything snapshot", () => {
  test("is pinned and fully inventoried", async () => {
    const url = new URL("../../vendor/understand-anything/manifest.json", import.meta.url);
    const manifest = JSON.parse(await readFile(url, "utf8"));
    expect(manifest.upstream.commit).toBe("54754a6f97051d1d76c8758353d8ea41afe502a6");
    expect(manifest.extractors.map((entry) => entry.name).sort()).toEqual(expected);
    expect(manifest.extractors.every((entry) => /^[a-f0-9]{64}$/.test(entry.sourceSha256))).toBe(true);
    expect(manifest.extractors.every((entry) => /^[a-f0-9]{64}$/.test(entry.generatedSha256))).toBe(true);
    expect(manifest.localPatches).toEqual([]);
  });
});
```

Create a data-driven language test with representative source for every language. Assert each registry result passes `parseRawFileAnalysis`, contains at least one type or function, and does not return `No extractor is registered`:

```js
const cases = [
  ["javascript", "sample.js", "export class A { run() {} }"],
  ["typescript", "sample.ts", "export class A { run(value: string): void {} }"],
  ["python", "sample.py", "class A:\n    def run(self):\n        pass\n"],
  ["rust", "sample.rs", "pub struct A; impl A { pub fn run(&self) {} }"],
  ["go", "sample.go", "package sample\ntype A struct{}\nfunc (a A) Run() {}\n"],
  ["java", "A.java", "public class A { public void run() {} }"],
  ["kotlin", "A.kt", "class A { fun run() {} }"],
  ["csharp", "A.cs", "public class A { public void Run() {} }"],
  ["c", "a.c", "struct A { int value; }; int run(void) { return 0; }"],
  ["cpp", "a.cpp", "class A { public: void run() {} };"],
  ["php", "A.php", "<?php class A { public function run() {} }"],
  ["ruby", "a.rb", "class A\n  def run\n  end\nend\n"],
  ["dart", "a.dart", "class A { void run() {} }" ]
];
```

- [ ] **Step 2: Run tests and record RED**

Run:

```bash
cd .github/skills/codebase-inspector
npm test -- --run tests/unit/vendor-manifest.test.mjs tests/languages/upstream-snapshot.test.mjs
```

Expected: FAIL because the manifest, vendored modules, and registrations do not exist.

- [ ] **Step 3: Implement the deterministic snapshot generator**

Add `esbuild` as a pinned dev dependency. Implement `tools/vendor-understand-anything.mjs` with these exact operations:

```js
const PINNED_COMMIT = "54754a6f97051d1d76c8758353d8ea41afe502a6";
const EXTRACTORS = ["typescript", "python", "rust", "go", "java", "kotlin", "csharp", "cpp", "php", "ruby", "dart"];

// 1. Require: node tools/vendor-understand-anything.mjs --upstream /absolute/path/Understand-Anything
// 2. Verify `git -C <upstream> rev-parse HEAD` equals PINNED_COMMIT.
// 3. Hash each source extractor and base-extractor.ts with SHA-256.
// 4. Use esbuild.transform(source, { loader: "ts", format: "esm", target: "node22" }).
// 5. Rewrite only the generated local import literal `./base-extractor.js` to `./base-extractor.mjs`.
// 6. Prefix every generated file with the pinned source path and MIT provenance header.
// 7. Write LF-normalized `.mjs` files and manifest.json with sorted keys and generated hashes.
```

Reject a dirty or wrong-commit upstream checkout. Do not read or copy `packages/core/dist`, `node_modules`, or runtime package code.

- [ ] **Step 4: Generate the snapshot and implement the bridge**

Run the generator against the local pinned checkout. Implement `createUpstreamAdapter` as the sole behavior-changing layer:

```js
export function createUpstreamAdapter(extractor) {
  return {
    extract(rootNode, { filePath, language }) {
      const structure = extractor.extractStructure(rootNode);
      const calls = extractor.extractCallGraph(rootNode);
      const exported = new Set(structure.exports.map((entry) => entry.name));
      const ownedNames = new Set(structure.classes.flatMap((entry) => entry.methods));

      const types = structure.classes.map((entry) => ({
        kind: "class",
        name: entry.name,
        lineRange: entry.lineRange,
        properties: entry.properties.map((name) => ({ name, type: null, visibility: null, static: null, lineRange: null })),
        extends: [],
        implements: [],
        exported: exported.has(entry.name) ? true : null
      }));

      const methods = [];
      for (const owner of structure.classes) {
        for (const name of owner.methods) {
          const callable = structure.functions.find((entry) => entry.name === name);
          methods.push({
            name,
            ownerName: owner.name,
            lineRange: callable?.lineRange ?? owner.lineRange,
            parameters: (callable?.params ?? []).map((parameter) => ({ name: parameter, type: null })),
            returnType: callable?.returnType ?? null,
            visibility: null,
            async: null,
            exported: exported.has(name) ? true : null,
            static: null
          });
        }
      }

      return {
        filePath,
        language,
        types,
        methods,
        functions: structure.functions.filter((entry) => !ownedNames.has(entry.name)).map((entry) => toRawFunction(entry, exported)),
        importCandidates: structure.imports.map((entry) => ({ ...entry, kind: "module" })),
        callCandidates: calls.map((entry) => ({ callerName: entry.caller || null, callerOwnerName: null, calleeText: entry.callee, lineNumber: entry.lineNumber })),
        warnings: ownershipWarnings(structure)
      };
    }
  };
}
```

Define the helpers in the same module:

```js
function toRawFunction(entry, exported) {
  return {
    name: entry.name,
    lineRange: entry.lineRange,
    parameters: entry.params.map((name) => ({ name, type: null })),
    returnType: entry.returnType ?? null,
    visibility: null,
    async: null,
    exported: exported.has(entry.name) ? true : null
  };
}

function ownershipWarnings(structure) {
  const ownersByMethod = new Map();
  for (const owner of structure.classes) {
    for (const method of owner.methods) {
      const owners = ownersByMethod.get(method) ?? [];
      owners.push(owner.name);
      ownersByMethod.set(method, owners);
    }
  }
  return [...ownersByMethod]
    .filter(([method, owners]) => owners.length > 1 || !structure.functions.some((entry) => entry.name === method))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([method, owners]) => owners.length > 1
      ? `Upstream ownership is ambiguous for method ${method}: ${owners.sort().join(", ")}`
      : `Upstream method ${owners[0]}.${method} has no callable detail record`);
}
```

This warning is a documented upstream-shape limitation, not a reason to infer ownership.

- [ ] **Step 5: Register the exact upstream language set**

Instantiate each vendored extractor in `registry.mjs`, wrap it with `createUpstreamAdapter`, map JavaScript and TypeScript to the TypeScript extractor, and map C and C++ to the C++ extractor. Remove `shell` from `registry.languages` and scanner detection. Keep TSX parsing through the TypeScript extractor.

Keep `tree-sitter-runtime.mjs` calling the adapter's existing `extract(rootNode, context)` contract. Change no runtime behavior beyond removing imports or branches that refer to deleted custom extractors. No vendored module may import the old custom extractors.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
cd .github/skills/codebase-inspector
npm test
npm run lint
if rg -n '@understand-anything|\.\./Understand-Anything|packages/core/(src|dist)' lib scripts vendor/understand-anything/extractors package.json; then exit 1; else rc=$?; test "$rc" -eq 1; fi
git diff --check
```

Expected: all tests pass, the forbidden runtime reference scan returns no matches, and the worktree diff is clean.

Commit:

```bash
git add tools .github/skills/codebase-inspector
git commit -m "refactor: vendor upstream deterministic extractors"
```

---

### Task 2: Thin Symbol Normalization and Conservative Relationships

**Files:**
- Create: `.github/skills/codebase-inspector/lib/normalize/stable-id.mjs`
- Create: `.github/skills/codebase-inspector/lib/normalize/relationships.mjs`
- Create: `.github/skills/codebase-inspector/lib/normalize/symbol-index.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/stable-id.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/relationships.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/symbol-index-builder.test.mjs`

**Interfaces:**
- Produces `stableId(kind, ...parts): string`.
- Produces `resolveRelationships(indexDraft, rawAnalyses): { imports, calls, unresolvedCalls, relationshipCounts }`.
- Produces `buildSymbolIndex({ project, scan, analyses, skillVersion }): { symbolIndex, relationshipCounts }`; `symbolIndex` is validated by `parseSymbolIndex`.

- [ ] **Step 1: Write failing stable-ID and ownership tests**

Assert readable IDs include normalized path, symbol kind, name or owner, and one-based line:

```js
expect(stableId("method", "src/a.ts", "Greeter", "run", 12))
  .toBe("method:src%2Fa.ts:Greeter:run:12");
```

Build a raw file with one class, one owned method, and one free function. Assert `buildSymbolIndex(...).symbolIndex` contains exactly one method and one function, bidirectional file/type membership is valid, and `parseSymbolIndex` accepts the result.

- [ ] **Step 2: Run focused tests and record RED**

Run:

```bash
cd .github/skills/codebase-inspector
npm test -- --run tests/unit/stable-id.test.mjs tests/unit/relationships.test.mjs tests/unit/symbol-index-builder.test.mjs
```

Expected: FAIL because the normalization modules do not exist.

- [ ] **Step 3: Implement stable records**

Implement IDs without hashing or machine-specific values:

```js
export function stableId(kind, ...parts) {
  return [kind, ...parts.map((part) => encodeURIComponent(String(part).replaceAll("\\", "/")))].join(":");
}
```

`buildSymbolIndex` must:

1. sort files by path;
2. create File IDs as `stableId("file", path)`;
3. create Type, Method, and Function IDs from path, owner/name, and start line;
4. copy only facts present in raw analysis;
5. attach method IDs to both owner Type and File;
6. set parse status to `warning` when raw warnings are nonempty;
7. include unsupported tracked files as File records with empty memberships;
8. call `resolveRelationships`, then attach its imports, calls, and unresolved calls;
9. call `parseSymbolIndex`; and
10. return the validated `symbolIndex` with `relationshipCounts`.

- [ ] **Step 4: Implement bounded relationship resolution**

Internal imports are resolved only when a candidate maps uniquely to a tracked file. For a relative source, test these candidates in order:

```js
const extensions = ["", ".js", ".jsx", ".ts", ".tsx", ".py", ".rs", ".go", ".java", ".kt", ".cs", ".c", ".h", ".cpp", ".hpp", ".php", ".rb", ".dart"];
const indexNames = extensions.filter(Boolean).map((extension) => `/index${extension}`);
```

Non-relative package names remain unresolved and are counted in `analysis-report.json`; they do not receive graph edges.

Resolve a call only when its caller matches one callable in the same file and its callee text matches one callable name project-wide. Otherwise append an `unresolvedCalls` record with the existing schema reason. Do not infer dynamic dispatch or receiver types.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
cd .github/skills/codebase-inspector
npm test
npm run lint
git diff --check
```

Commit:

```bash
git add .github/skills/codebase-inspector/lib/normalize .github/skills/codebase-inspector/tests/unit
git commit -m "feat: normalize upstream symbols and relationships"
```

---

### Task 3: Code Graph, Analysis Report, and Markdown Indexes

**Files:**
- Create: `.github/skills/codebase-inspector/lib/graph/build-code-graph.mjs`
- Create: `.github/skills/codebase-inspector/lib/reports/build-analysis-report.mjs`
- Create: `.github/skills/codebase-inspector/lib/reports/render-markdown.mjs`
- Create: `.github/skills/codebase-inspector/lib/output/artifacts.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/code-graph-builder.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/analysis-report-builder.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/markdown-renderer.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/fixtures/golden/classes.md`
- Create: `.github/skills/codebase-inspector/tests/fixtures/golden/methods.md`
- Create: `.github/skills/codebase-inspector/tests/fixtures/golden/functions.md`

**Interfaces:**
- Produces `buildCodeGraph(symbolIndex, { analyzedAt }): CodeGraph` validated by `parseCodeGraph`.
- Produces `buildAnalysisReport({ symbolIndex, scan, analyses, relationshipCounts, options }): AnalysisReport` validated by `parseAnalysisReport`.
- Produces `renderMarkdownIndexes(symbolIndex): { "classes.md", "methods.md", "functions.md" }`.
- Produces `serializeArtifacts({ symbolIndex, codeGraph, report, markdown }): Map<string, string>` after validating all JSON documents and normalizing every file to one trailing LF.

- [ ] **Step 1: Write failing artifact tests**

Use one File, Type, Method, Function, Import, and Call. Assert graph nodes reuse canonical IDs, method nodes use graph type `function`, and only canonical relationships create edges. Assert Markdown equals the three LF-normalized golden files and contains no generated timestamp.

The expected Markdown headers are:

```md
# Classes

| Name | Kind | File | Lines | Methods | Properties |
|---|---|---|---:|---:|---:|
```

```md
# Methods

| Owner | Method | File | Lines | Parameters | Return |
|---|---|---|---:|---|---|
```

```md
# Functions

| Function | File | Lines | Parameters | Return |
|---|---|---:|---|---|
```

- [ ] **Step 2: Run focused tests and record RED**

Run:

```bash
cd .github/skills/codebase-inspector
npm test -- --run tests/unit/code-graph-builder.test.mjs tests/unit/analysis-report-builder.test.mjs tests/unit/markdown-renderer.test.mjs
```

Expected: FAIL because the builders do not exist.

- [ ] **Step 3: Implement the graph projection**

Project facts without LLM text:

```js
const nodeDefaults = { summary: "", tags: [], complexity: "simple" };
```

- File records become `file` nodes.
- Type records become `class` nodes, retaining their canonical ID and line range.
- Method and Function records become `function` nodes.
- File membership creates `contains` edges.
- Resolved imports create `imports` edges.
- Resolved calls create `calls` edges.
- All edges are `direction: "forward"`; contains/imports/calls weights are `1`, `0.8`, and `0.7` respectively.
- `layers` and `tour` remain empty.
- `project.analyzedAt` is supplied by Git commit metadata, never wall-clock time.

- [ ] **Step 4: Implement report and Markdown rendering**

The analysis report must list parser warnings and unsupported files in path order and compute complete/partial status from parser failures. Markdown cells must escape `|`, replace embedded newlines with spaces, render `null` as `-`, and sort by file path, start line, owner, then name.

Every Markdown file ends with exactly one LF. Render from `symbol-index.json` facts in memory; do not reparse source files.

`serializeArtifacts` must use `stableStringify` for JSON, call `parseSymbolIndex`, `parseCodeGraph`, and `parseAnalysisReport` before serialization, and return exactly the six filenames declared by the spec.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
cd .github/skills/codebase-inspector
npm test
npm run lint
git diff --check
```

Commit:

```bash
git add .github/skills/codebase-inspector/lib/{graph,reports} .github/skills/codebase-inspector/tests
git commit -m "feat: render graph and symbol indexes"
```

---

### Task 4: Runtime Preflight, Orchestration, and Atomic Publication

**Files:**
- Create: `.github/skills/codebase-inspector/scripts/setup.mjs`
- Modify: `.github/skills/codebase-inspector/scripts/run.mjs`
- Create: `.github/skills/codebase-inspector/lib/runtime/preflight.mjs`
- Create: `.github/skills/codebase-inspector/lib/runtime/lock.mjs`
- Create: `.github/skills/codebase-inspector/lib/output/publish.mjs`
- Create: `.github/skills/codebase-inspector/lib/orchestrator.mjs`
- Create: `.github/skills/codebase-inspector/tests/integration/run-analysis.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/integration/atomic-output.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/integration/output-modes.test.mjs`

**Interfaces:**
- Produces `ensureRuntime({ skillDir }): Promise<void>`.
- Produces `preflight(options, skillDir): Promise<RunConfig>`.
- Produces `withAnalysisLock(gitDir, action): Promise<unknown>`.
- Produces `publishArtifacts({ targetRoot, outputPath, artifacts, tracked }): Promise<void>`.
- Produces `runAnalysis(runConfig): Promise<{ status, outputPath }>`.

- [ ] **Step 1: Write failing end-to-end and preservation tests**

Create a temporary tracked repository containing one TypeScript class and one Python function. Invoke `scripts/run.mjs` and assert the output directory contains exactly:

```js
[
  "analysis-report.json",
  "classes.md",
  "code-graph.json",
  "functions.md",
  "methods.md",
  "symbol-index.json"
]
```

Write a sentinel successful output, inject an analysis failure, rerun, and assert the sentinel remains unchanged. Assert two simultaneous runs cause the second process to fail with `analysis already running`.

- [ ] **Step 2: Run integration tests and record RED**

Run:

```bash
cd .github/skills/codebase-inspector
npm run test:integration
```

Expected: FAIL because runtime, orchestrator, and publisher modules do not exist.

- [ ] **Step 3: Implement setup and preflight**

`ensureRuntime` must require Node 22 and run `npm ci --omit=dev` in `skillDir` only when production dependencies are absent or invalid. It must never inspect or install the target repository's package manifest.

`preflight` must resolve the target Git root, validate the output path remains inside that root, obtain Git HEAD hash and commit timestamp, and return:

```js
{
  skillDir,
  targetRoot,
  outputPath,
  gitDir,
  gitCommitHash,
  gitCommitTimestamp,
  options: { tracked, output, keepIntermediate }
}
```

- [ ] **Step 4: Implement lock and atomic publication**

Store `codebase-inspector.lock` under the target repository's Git directory using exclusive file creation. Always remove it in `finally`.

Publish through a temporary sibling directory, validate all artifacts before writing, rename the previous output to a backup, rename the temporary directory into place, then remove the backup. On failure, restore the backup. Temporary and backup names must not appear inside generated artifacts.

Default mode maintains only a marked block in `.git/info/exclude`:

```text
# BEGIN Codebase Inspector
.code-understanding/
# END Codebase Inspector
```

`--tracked` removes only that exact owned block. Never edit tracked `.gitignore`.

- [ ] **Step 5: Implement orchestration**

`runAnalysis` must execute this fixed flow:

```js
return withAnalysisLock(runConfig.gitDir, async () => {
  const scan = await scanProject(runConfig);
  const registry = await createParserRegistry(runConfig.skillDir);
  try {
    const analyses = await Promise.all(scan.files.map((file) => registry.analyzeFile(file)));
    const { symbolIndex, relationshipCounts } = buildSymbolIndex({ project: runConfig, scan, analyses, skillVersion: "0.1.0" });
    const codeGraph = buildCodeGraph(symbolIndex, { analyzedAt: runConfig.gitCommitTimestamp });
    const report = buildAnalysisReport({ symbolIndex, scan, analyses, relationshipCounts, options: runConfig.options });
    const markdown = renderMarkdownIndexes(symbolIndex);
    const artifacts = serializeArtifacts({ symbolIndex, codeGraph, report, markdown });
    await publishArtifacts({
      targetRoot: runConfig.targetRoot,
      outputPath: runConfig.outputPath,
      artifacts,
      tracked: runConfig.options.tracked
    });
    return { status: report.status, outputPath: runConfig.outputPath };
  } finally {
    await registry.close();
  }
});
```

Do not execute source files or target commands during this flow.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
cd .github/skills/codebase-inspector
npm test
npm run lint
git diff --check
```

Commit:

```bash
git add .github/skills/codebase-inspector/scripts .github/skills/codebase-inspector/lib .github/skills/codebase-inspector/tests/integration
git commit -m "feat: run and publish standalone analysis"
```

---

### Task 5: Copilot Skill, Documentation, Licensing, CI, and Release Gate

**Files:**
- Create: `.github/skills/codebase-inspector/SKILL.md`
- Create: `.github/skills/codebase-inspector/README.ja.md`
- Create: `.github/skills/codebase-inspector/scripts/package-release.mjs`
- Create: `.github/skills/codebase-inspector/scripts/check-licenses.mjs`
- Create: `.github/skills/codebase-inspector/THIRD_PARTY_LICENSES.json`
- Create: `README.md`
- Create: `README.ja.md`
- Create: `LICENSE`
- Create: `NOTICE`
- Create: `.github/workflows/ci.yml`
- Create: `.github/skills/codebase-inspector/tests/integration/standalone-copy.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/integration/offline-and-no-exec.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/integration/release-package.test.mjs`
- Modify: `.github/skills/codebase-inspector/package.json`
- Modify: `.github/skills/codebase-inspector/package-lock.json`
- Modify: `docs/superpowers/plans/2026-07-22-codebase-inspector-implementation.md`

**Interfaces:**
- Produces `/codebase-inspector [project-path] [--tracked] [--output <dir>] [--keep-intermediate]` as a project Skill command.
- Produces `codebase-inspector-0.1.0.zip` containing the Skill directory without dependencies or development files.
- Produces a machine-readable production dependency license inventory.

- [ ] **Step 1: Write failing standalone, offline, no-exec, and package tests**

The standalone test copies only `.github/skills/codebase-inspector/` into a fresh repository, runs `npm ci --omit=dev`, invokes the analyzer, and validates all six artifacts.

The no-exec fixture contains executable `package.json` scripts, a Makefile, and source files that create a sentinel if run. Start analysis with outbound network connections rejected by a child-process preload shim; assert success and that no sentinel exists.

The package test opens the release zip and asserts it includes `SKILL.md`, runtime source, vendored extractors, manifest, Dart WASM, licenses, and lockfile, while excluding:

```js
["node_modules/", "tests/", ".code-understanding/", ".superpowers/", ".git/", "*.tmp", "*.bak"]
```

- [ ] **Step 2: Run release tests and record RED**

Run:

```bash
cd .github/skills/codebase-inspector
npm test -- --run tests/integration/standalone-copy.test.mjs tests/integration/offline-and-no-exec.test.mjs tests/integration/release-package.test.mjs
```

Expected: FAIL because Skill metadata, release scripts, licenses, and package rules do not exist.

- [ ] **Step 3: Write the Skill and Japanese usage documentation**

Use this exact frontmatter:

```yaml
---
name: codebase-inspector
description: Deterministically indexes repository files, classes, methods, functions, imports, and calls without LLM-based analysis.
argument-hint: "[project-path] [--tracked] [--output <dir>] [--keep-intermediate]"
user-invocable: true
disable-model-invocation: false
---
```

`SKILL.md` instructs Copilot to run `node scripts/run.mjs "$ARGUMENTS"` from the Skill directory after normal shell authorization. It must state that the script itself uses no LLM and that generated artifacts contain syntax-level facts, not business understanding.

`README.ja.md` documents prerequisites, installation by copying the Skill directory, invocation, six outputs, local versus tracked mode, supported languages, security boundaries, upstream limitations, and the distinction from LLM-backed `/understand`.

- [ ] **Step 4: Complete license and provenance inventory**

Create repository MIT `LICENSE`. `NOTICE` must list:

- Understand-Anything repository URL and pinned commit;
- every vendored source path and generated destination from the manifest;
- the upstream MIT license;
- Dart grammar source/build method and its shipped MIT LICENSE text;
- the observed Dart package-metadata ISC versus shipped LICENSE/BUILD MIT discrepancy without resolving it silently; and
- all local patches, which must be `none` for version 0.1.0.

Clarify `vendor/tree-sitter-dart/BUILD.md` to say the upstream npm release does not ship a `web-tree-sitter@0.26`-compatible WASM, avoiding the current contradictory wording.

Generate `THIRD_PARTY_LICENSES.json` from production dependencies only. Upgrade `vitest` to at least `3.2.7` and `adm-zip` to at least `0.6.0`, or remove them, so the previously observed dev-only advisories do not remain at the release gate.

- [ ] **Step 5: Implement release packaging and CI**

`package-release.mjs` must create `codebase-inspector-0.1.0.zip` with sorted entries and fixed ZIP timestamps for reproducibility. Include only runtime files, `SKILL.md`, `README.ja.md`, package manifests, vendor assets, and license inventory.

CI on macOS, Ubuntu, and Windows runs:

```bash
npm ci
npm test
npm run lint
npm audit --omit=dev
npm run check:licenses
npm run release:zip
```

Mark the old 17-task plan header as `Superseded by 2026-07-23-codebase-inspector-upstream-reuse-implementation.md`; do not delete it because it documents commits already present in history.

- [ ] **Step 6: Run the complete release gate and commit**

Run:

```bash
cd .github/skills/codebase-inspector
npm ci
npm test
npm run lint
npm audit --omit=dev
npm run check:licenses
npm run release:zip
node -e "import('./lib/parsers/registry.mjs').then(() => console.log('standalone-import-ok'))"
if rg -n '@understand-anything|\.\./Understand-Anything|packages/core/(src|dist)' lib scripts vendor/understand-anything/extractors package.json; then exit 1; fi
git diff --check
```

Expected: all tests and audits pass, `standalone-import-ok` is printed, the forbidden-reference scan has no matches, and the release zip test passes.

Commit:

```bash
git add .github README.md README.ja.md LICENSE NOTICE docs/superpowers/plans
git commit -m "feat: package codebase inspector skill"
```

---

## Final Review

After Task 5:

1. Generate one review package from baseline `708918e` to HEAD.
2. Use a fresh reviewer to verify the approved reuse design, all five task reports, provenance, security boundaries, and release artifacts.
3. Fix only findings that violate the approved spec or documented interfaces.
4. Rerun the complete release gate.
5. Confirm the worktree is clean and report the branch, HEAD, test count, audit result, package path, and remaining upstream limitations.
