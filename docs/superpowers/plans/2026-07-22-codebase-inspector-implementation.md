# Codebase Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained GitHub Copilot Project Skill that deterministically indexes repository files, types, methods, functions, imports, and calls without using an LLM in the analysis engine.

**Architecture:** The distributable unit lives entirely under `.github/skills/codebase-inspector/`. A Node.js 22 ESM pipeline scans Git-tracked files, parses supported languages with Tree-sitter or the bounded Shell parser, normalizes one canonical Symbol Index, projects it into a KnowledgeGraph-compatible graph, renders Markdown from the canonical index, validates every artifact, and publishes through a lock-protected atomic directory replacement.

**Tech Stack:** Node.js 22, JavaScript ES modules, `web-tree-sitter`, pinned Tree-sitter WASM grammar packages, vendored Dart WASM, `ignore`, `jsonc-parser`, `yaml`, `zod`, Vitest, ESLint, GitHub Actions.

## Global Constraints

- Repository name, Skill name, and slash command are all `codebase-inspector`; invocation is `/codebase-inspector [project-path]`.
- The complete distributable unit is `.github/skills/codebase-inspector/`; it must run after that directory alone is copied into another Git repository.
- Production code is directly executable JavaScript ESM. Runtime setup and analysis must not require TypeScript compilation, a repository-level build, or generated `dist/` files.
- Node.js 22 or newer and Git are required. Node.js and `node_modules` are not bundled.
- First-run setup installs only the Skill's locked dependencies with `npm ci --omit=dev` in the Skill directory after normal Copilot shell authorization.
- Analysis must not call an LLM, AI API, MCP server, language server, target build, target test, target package script, or target executable.
- After setup, analysis must succeed with outbound sockets blocked.
- Supported code languages are JavaScript, TypeScript, Python, Rust, Go, Java, Kotlin, C#, C, C++, PHP, Ruby, Dart, and Shell.
- The default output directory is `.code-understanding/`; `--output <dir>`, `--tracked`, and `--keep-intermediate` are the only first-release options.
- Default mode may add only a marked Codebase Inspector block to `.git/info/exclude`; it must never modify tracked `.gitignore`.
- `--tracked` removes only the matching tool-owned exclude block and emits no wall-clock time, duration, absolute machine path, temporary path, process ID, or environment-specific diagnostic.
- For identical tracked contents, ignore rules, Skill version, dependency lockfile, and CLI options, tracked output must be byte-for-byte identical on repeated runs and across supported operating systems.
- Paths in all generated artifacts use `/`; source text line endings are normalized before parsing and generated text uses LF.
- Stable IDs include normalized path, symbol kind, name or owner, and one-based start line exactly as specified in the approved design.
- Unknown statically unavailable values are `null`; the analyzer must not infer types, visibility, ownership, or export status from naming conventions unless that convention is part of the language specification.
- Generated outputs contain identifiers, signatures, types, paths, and relationships, but no source bodies and no parameter default-value literals.
- Fatal failures preserve the previous successful output. One parser failure may publish schema-valid partial output with explicit warnings.
- The lock is stored under the target repository's Git directory. Publication uses a temporary sibling and backup-and-rename sequence.
- `code-graph.json` keeps the Understand-Anything KnowledgeGraph outer shape. Compatibility does not mean semantic equivalence to the LLM-backed `/understand` output.
- Rich Type, Method, Function, Property, Import, and Call records in `symbol-index.json` are authoritative; `code-graph.json` is a compatibility projection.
- `code-graph.json.project.analyzedAt` is the analyzed Git commit timestamp, never the wall-clock run time.
- The initial Skill package version is `0.1.0`; the Symbol Index and report schema version is `1.0.0`.
- Adapted source is pinned to Egonex-AI/Understand-Anything commit `54754a6f97051d1d76c8758353d8ea41afe502a6`; adapted files retain origin headers and are inventoried in `NOTICE`.
- The repository license is MIT. Release artifacts include a dependency-license report and exclude `node_modules`, caches, temporary outputs, and repository-level development files.

---

## Planned File Structure

```text
codebase-inspector/
├── README.md                                  # installation, usage, security boundary, schemas
├── LICENSE                                    # MIT license for this repository
├── NOTICE                                     # upstream adaptation and third-party inventory
├── CHANGELOG.md                               # release-visible behavior and schema changes
├── .gitignore                                 # repository-level release artifacts
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                             # Node 22 three-OS verification matrix
│   │   └── release.yml                        # ZIP, checksum, and license report
│   └── skills/codebase-inspector/
│       ├── SKILL.md                           # Copilot discovery and invocation contract
│       ├── package.json                       # pinned runtime and development dependencies
│       ├── package-lock.json                  # reproducible dependency lock
│       ├── eslint.config.mjs                  # JavaScript static checks
│       ├── .gitignore                         # Skill-local dependencies and test artifacts
│       ├── scripts/
│       │   ├── setup.mjs                      # Node/npm/dependency preflight
│       │   ├── run.mjs                        # dependency-safe CLI entry point
│       │   └── package-release.mjs            # deterministic release ZIP and checksum
│       ├── lib/
│       │   ├── cli/args.mjs                   # option parsing and normalized run options
│       │   ├── runtime/preflight.mjs          # target Git root and writable-output checks
│       │   ├── scanner/
│       │   │   ├── languages.mjs              # extensions, display names, categories
│       │   │   ├── ignore-rules.mjs           # built-ins and .codeinspectorignore
│       │   │   ├── git-files.mjs              # tracked-file and Git metadata reads
│       │   │   └── scan.mjs                   # safe content reads and File candidates
│       │   ├── parsers/
│       │   │   ├── tree-sitter-runtime.mjs    # WASM loading, parsing, cleanup
│       │   │   ├── registry.mjs               # language-to-parser/extractor dispatch
│       │   │   └── shell-parser.mjs           # bounded Shell declaration/reference parser
│       │   ├── extractors/
│       │   │   ├── base-extractor.mjs         # AST traversal and text helpers
│       │   │   ├── typescript-extractor.mjs   # JavaScript and TypeScript
│       │   │   ├── python-extractor.mjs
│       │   │   ├── rust-extractor.mjs
│       │   │   ├── go-extractor.mjs
│       │   │   ├── java-extractor.mjs
│       │   │   ├── kotlin-extractor.mjs
│       │   │   ├── cpp-extractor.mjs          # C and C++
│       │   │   ├── csharp-extractor.mjs
│       │   │   ├── php-extractor.mjs
│       │   │   ├── ruby-extractor.mjs
│       │   │   └── dart-extractor.mjs
│       │   ├── imports/
│       │   │   ├── file-candidates.mjs        # extension/index/package candidate expansion
│       │   │   ├── module-config.mjs           # tsconfig, go.mod, Composer, pubspec readers
│       │   │   ├── path-languages.mjs          # JS/TS, Python, Ruby, PHP, Dart, Shell
│       │   │   ├── namespace-languages.mjs     # Go, Rust, Java, Kotlin, C/C++, C#
│       │   │   └── resolve-imports.mjs         # resolver dispatch and normalized records
│       │   ├── symbols/
│       │   │   ├── stable-id.mjs              # stable ID and sort-key construction
│       │   │   ├── normalize.mjs              # canonical Symbol Index construction
│       │   │   └── resolve-calls.mjs           # conservative unambiguous call linking
│       │   ├── graph/build-graph.mjs           # KnowledgeGraph compatibility projection
│       │   ├── reports/
│       │   │   ├── markdown.mjs               # escaping, links, signatures, warnings
│       │   │   └── render.mjs                 # six Markdown report renderers
│       │   ├── schema/
│       │   │   ├── raw-analysis.mjs           # extractor boundary schemas
│       │   │   ├── symbol-index.mjs           # canonical schema and validator
│       │   │   ├── code-graph.mjs             # compatibility graph schema and validator
│       │   │   └── analysis-report.mjs         # coverage and warning schema
│       │   ├── output/
│       │   │   ├── stable-json.mjs            # sorted-key JSON and LF text writer
│       │   │   ├── git-exclude.mjs            # exact marked-block management
│       │   │   ├── lock.mjs                   # live/stale process lock protocol
│       │   │   └── publisher.mjs              # validation and atomic replacement
│       │   └── orchestrator.mjs                # fixed end-to-end analysis flow
│       ├── vendor/tree-sitter-dart/
│       │   ├── tree-sitter-dart.wasm          # copied grammar binary
│       │   ├── BUILD.md                        # reproducible upstream build provenance
│       │   └── LICENSE                         # grammar license
│       └── tests/
│           ├── helpers/
│           │   ├── fixture-repo.mjs            # isolated temporary Git repository helper
│           │   ├── parse-fixture.mjs           # direct parser/extractor helper
│           │   └── block-network.cjs           # outbound socket failure shim
│           ├── unit/                            # focused component tests
│           ├── languages/                       # one fixture suite per supported language
│           ├── integration/                     # copied-Skill, safety, atomicity, mode tests
│           └── golden/                          # complete expected generated artifacts
└── docs/superpowers/
    ├── specs/2026-07-22-codebase-inspector-design.md
    └── plans/2026-07-22-codebase-inspector-implementation.md
```

## Shared Internal Contracts

Every task uses these exact JavaScript object boundaries. Runtime validation is implemented with Zod; JSDoc typedefs keep production code directly executable.

```js
// RawFileAnalysis, returned by every extractor
{
  filePath: "src/example.ts",
  language: "typescript",
  types: [{
    kind: "class",
    name: "Example",
    lineRange: [1, 12],
    properties: [{ name: "value", type: "string", visibility: "private", static: false, lineRange: [2, 2] }],
    extends: [],
    implements: [],
    exported: true
  }],
  methods: [{
    name: "run",
    ownerName: "Example",
    lineRange: [4, 8],
    parameters: [{ name: "input", type: "string" }],
    returnType: "Promise<void>",
    visibility: "public",
    static: false,
    async: true,
    exported: true
  }],
  functions: [],
  importCandidates: [{ source: "./helper.js", specifiers: ["helper"], lineNumber: 1, kind: "module" }],
  callCandidates: [{ callerName: "run", callerOwnerName: "Example", calleeText: "helper", lineNumber: 5 }],
  warnings: []
}
```

```js
// Main function boundaries
parseArgs(argv, cwd) -> CliOptions
preflight(options, skillDir) -> Promise<RunConfig>
scanProject(runConfig, { fsOps } = {}) -> Promise<ScanResult>
createParserRegistry(skillDir) -> Promise<ParserRegistry>
registry.analyzeFile(fileCandidate) -> Promise<RawFileAnalysis>
resolveImports(scanResult, rawAnalyses) -> Promise<ImportResolutionResult>
normalizeSymbols(projectMeta, scanResult, rawAnalyses, importResult) -> { index: SymbolIndex, warnings: NormalizationWarning[] }
resolveCalls(symbolIndex, rawAnalyses) -> SymbolIndex
buildCodeGraph(symbolIndex, gitMeta) -> KnowledgeGraph
renderReports(symbolIndex, analysisReport) -> Map<string, string>
publishOutputs(runConfig, artifacts) -> Promise<PublishResult>
runAnalysis(runConfig) -> Promise<AnalysisResult>
```

### Task 1: Executable Skill Skeleton and CLI Contract

**Files:**
- Create: `.github/skills/codebase-inspector/package.json`
- Create: `.github/skills/codebase-inspector/package-lock.json`
- Create: `.github/skills/codebase-inspector/eslint.config.mjs`
- Create: `.github/skills/codebase-inspector/.gitignore`
- Create: `.github/skills/codebase-inspector/lib/cli/args.mjs`
- Create: `.github/skills/codebase-inspector/scripts/run.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/args.test.mjs`

**Interfaces:**
- Consumes: `process.argv.slice(2)` and `process.cwd()`.
- Produces: `parseArgs(argv, cwd) -> { targetPath, tracked, output, keepIntermediate }`; `scripts/run.mjs` exits nonzero and prints one concise error line for invalid CLI syntax.

- [ ] **Step 1: Create the pinned package manifest and lint configuration**

```json
{
  "name": "codebase-inspector-skill",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "lint": "eslint .",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:languages": "vitest run tests/languages",
    "test:integration": "vitest run tests/integration --no-file-parallelism",
    "release:zip": "node scripts/package-release.mjs"
  },
  "dependencies": {
    "@tree-sitter-grammars/tree-sitter-kotlin": "1.1.0",
    "ignore": "7.0.5",
    "jsonc-parser": "3.3.1",
    "tree-sitter-c-sharp": "0.23.1",
    "tree-sitter-cpp": "0.23.4",
    "tree-sitter-go": "0.25.0",
    "tree-sitter-java": "0.23.5",
    "tree-sitter-javascript": "0.25.0",
    "tree-sitter-php": "0.23.11",
    "tree-sitter-python": "0.25.0",
    "tree-sitter-ruby": "0.23.1",
    "tree-sitter-rust": "0.24.0",
    "tree-sitter-typescript": "0.23.2",
    "web-tree-sitter": "0.26.6",
    "yaml": "2.8.3",
    "zod": "4.3.6"
  },
  "devDependencies": {
    "@eslint/js": "9.39.2",
    "adm-zip": "0.5.16",
    "eslint": "9.39.2",
    "license-checker-rseidelsohn": "4.4.2",
    "vitest": "3.2.4"
  }
}
```

```js
// eslint.config.mjs
import js from "@eslint/js";

export default [
  { ignores: ["node_modules/**", "tests/tmp/**"] },
  js.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { console: "readonly", process: "readonly", Buffer: "readonly" } },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] }
  }
];
```

```text
# .gitignore
node_modules/
coverage/
tests/tmp/
*.log
.codebase-inspector-runtime.json
```

Run: `cd .github/skills/codebase-inspector && npm install --package-lock-only`

Expected: `package-lock.json` is created with `lockfileVersion: 3` and no `node_modules/` directory is required.

- [ ] **Step 2: Write failing CLI contract tests**

```js
// tests/unit/args.test.mjs
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../lib/cli/args.mjs";

describe("parseArgs", () => {
  it("defaults to cwd, local mode, and .code-understanding", () => {
    expect(parseArgs([], "/repo")).toEqual({
      targetPath: "/repo",
      tracked: false,
      output: ".code-understanding",
      keepIntermediate: false
    });
  });

  it("accepts target, tracked, output, and keep-intermediate", () => {
    expect(parseArgs(["../app", "--tracked", "--output", ".analysis", "--keep-intermediate"], "/repo")).toEqual({
      targetPath: "/app",
      tracked: true,
      output: ".analysis",
      keepIntermediate: true
    });
  });

  it.each([["--unknown"], ["--output"], ["a", "b"]])("rejects invalid argv %j", (argv) => {
    expect(() => parseArgs(argv, "/repo")).toThrow(/Usage: \/codebase-inspector/);
  });
});
```

- [ ] **Step 3: Run the test and verify the missing module failure**

Run: `cd .github/skills/codebase-inspector && npm ci && npm run test:unit -- tests/unit/args.test.mjs`

Expected: FAIL because `lib/cli/args.mjs` does not exist.

- [ ] **Step 4: Implement argument parsing and a dependency-safe entry point**

```js
// lib/cli/args.mjs
import { resolve } from "node:path";

const USAGE = "Usage: /codebase-inspector [project-path] [--tracked] [--output <dir>] [--keep-intermediate]";

export function parseArgs(argv, cwd) {
  let projectPath;
  let output = ".code-understanding";
  let tracked = false;
  let keepIntermediate = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--tracked") tracked = true;
    else if (value === "--keep-intermediate") keepIntermediate = true;
    else if (value === "--output") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(USAGE);
      output = next;
      index += 1;
    } else if (value.startsWith("--") || projectPath) throw new Error(USAGE);
    else projectPath = value;
  }

  return { targetPath: resolve(cwd, projectPath ?? "."), tracked, output, keepIntermediate };
}
```

```js
// scripts/run.mjs
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../lib/cli/args.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const options = parseArgs(process.argv.slice(2), process.cwd());
  const { ensureRuntime } = await import("./setup.mjs");
  await ensureRuntime({ skillDir });
  const { preflight } = await import("../lib/runtime/preflight.mjs");
  const { runAnalysis } = await import("../lib/orchestrator.mjs");
  const result = await runAnalysis(await preflight(options, skillDir));
  console.log(`Codebase Inspector: ${result.status}; output=${result.outputPath}`);
} catch (error) {
  console.error(`Codebase Inspector: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
```

`setup.mjs`, `preflight.mjs`, and `orchestrator.mjs` are introduced by Task 15. This task tests `args.mjs` directly; running `scripts/run.mjs` becomes an integration gate only after those modules exist.

- [ ] **Step 5: Run the CLI unit tests and commit**

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/args.test.mjs`

Expected: 3 tests PASS.

```bash
git add .github/skills/codebase-inspector
git commit -m "feat: scaffold codebase inspector skill"
```

### Task 2: Runtime Schemas, Stable JSON, and Canonical Contracts

**Files:**
- Create: `.github/skills/codebase-inspector/lib/schema/raw-analysis.mjs`
- Create: `.github/skills/codebase-inspector/lib/schema/symbol-index.mjs`
- Create: `.github/skills/codebase-inspector/lib/schema/code-graph.mjs`
- Create: `.github/skills/codebase-inspector/lib/schema/analysis-report.mjs`
- Create: `.github/skills/codebase-inspector/lib/output/stable-json.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/schemas.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/stable-json.test.mjs`

**Interfaces:**
- Consumes: raw extractor objects, canonical index objects, compatibility graph objects, report objects.
- Produces: `parseRawFileAnalysis`, `parseSymbolIndex`, `parseCodeGraph`, `parseAnalysisReport`, `stableStringify`, and `normalizeText`.

- [ ] **Step 1: Write failing schema and serialization tests**

```js
// tests/unit/stable-json.test.mjs
import { expect, it } from "vitest";
import { normalizeText, stableStringify } from "../../lib/output/stable-json.mjs";

it("sorts object keys recursively, preserves array order, and writes LF", () => {
  expect(stableStringify({ z: 1, a: { y: 2, x: 3 }, list: [{ b: 2, a: 1 }] }))
    .toBe('{\n  "a": {\n    "x": 3,\n    "y": 2\n  },\n  "list": [\n    {\n      "a": 1,\n      "b": 2\n    }\n  ],\n  "z": 1\n}\n');
  expect(normalizeText("a\r\nb\rc")).toBe("a\nb\nc");
});
```

```js
// tests/unit/schemas.test.mjs
import { expect, it } from "vitest";
import { parseRawFileAnalysis } from "../../lib/schema/raw-analysis.mjs";
import { parseSymbolIndex } from "../../lib/schema/symbol-index.mjs";

it("rejects source bodies and parameter defaults at the extractor boundary", () => {
  expect(() => parseRawFileAnalysis({ filePath: "a.ts", language: "typescript", types: [], methods: [], functions: [], importCandidates: [], callCandidates: [], warnings: [], sourceBody: "secret" })).toThrow();
  expect(() => parseRawFileAnalysis({ filePath: "a.ts", language: "typescript", types: [], methods: [], functions: [{ name: "f", lineRange: [1, 1], parameters: [{ name: "x", type: null, defaultValue: "secret" }], returnType: null, visibility: null, async: null, exported: null }], importCandidates: [], callCandidates: [], warnings: [] })).toThrow();
});

it("requires methods to reference an existing owner type", () => {
  const invalid = { schemaVersion: "1.0.0", project: { name: "x", root: null, gitCommitHash: "a", workingTreeDirty: false, languages: [], skillVersion: "0.1.0" }, files: [], types: [], methods: [{ id: "method:a:X:m:1", name: "m", ownerTypeId: "type:a:class:X:1", filePath: "a", lineRange: [1, 1], parameters: [], returnType: null, visibility: null, static: null, async: null, exported: null }], functions: [], imports: [], calls: [], unresolvedCalls: [], coverage: { trackedFiles: 0, supportedFiles: 0, parsedFiles: 0, warningFiles: 0, unsupportedFiles: 0 } };
  expect(() => parseSymbolIndex(invalid)).toThrow(/ownerTypeId/);
});
```

- [ ] **Step 2: Run tests and verify missing-module failures**

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/schemas.test.mjs tests/unit/stable-json.test.mjs`

Expected: FAIL because schema and stable JSON modules do not exist.

- [ ] **Step 3: Implement exact Zod boundaries**

Implement `raw-analysis.mjs` with strict objects and these exported schemas: `LineRangeSchema`, `ParameterSchema`, `PropertySchema`, `RawTypeSchema`, `RawMethodSchema`, `RawFunctionSchema`, `ImportCandidateSchema`, `CallCandidateSchema`, `RawFileAnalysisSchema`, and `parseRawFileAnalysis`.

```js
import { z } from "zod";

export const LineRangeSchema = z.tuple([z.number().int().positive(), z.number().int().positive()]).refine(([start, end]) => start <= end);
export const VisibilitySchema = z.enum(["public", "protected", "private", "internal", "package"]).nullable();
export const ParameterSchema = z.object({ name: z.string().min(1), type: z.string().min(1).nullable() }).strict();
export const PropertySchema = z.object({ name: z.string().min(1), type: z.string().min(1).nullable(), visibility: VisibilitySchema, static: z.boolean().nullable(), lineRange: LineRangeSchema.nullable() }).strict();
export const RawTypeSchema = z.object({ kind: z.enum(["class", "interface", "struct", "enum", "trait", "module"]), name: z.string().min(1), lineRange: LineRangeSchema, properties: z.array(PropertySchema), extends: z.array(z.string()), implements: z.array(z.string()), exported: z.boolean().nullable() }).strict();
const CallableFields = { name: z.string().min(1), lineRange: LineRangeSchema, parameters: z.array(ParameterSchema), returnType: z.string().min(1).nullable(), visibility: VisibilitySchema, async: z.boolean().nullable(), exported: z.boolean().nullable() };
export const RawMethodSchema = z.object({ ...CallableFields, ownerName: z.string().min(1), static: z.boolean().nullable() }).strict();
export const RawFunctionSchema = z.object(CallableFields).strict();
export const ImportCandidateSchema = z.object({ source: z.string().min(1), specifiers: z.array(z.string()), lineNumber: z.number().int().positive(), kind: z.enum(["module", "include", "source"]) }).strict();
export const CallCandidateSchema = z.object({ callerName: z.string().min(1).nullable(), callerOwnerName: z.string().min(1).nullable(), calleeText: z.string().min(1), lineNumber: z.number().int().positive() }).strict();
export const RawFileAnalysisSchema = z.object({ filePath: z.string().min(1), language: z.string().min(1), types: z.array(RawTypeSchema), methods: z.array(RawMethodSchema), functions: z.array(RawFunctionSchema), importCandidates: z.array(ImportCandidateSchema), callCandidates: z.array(CallCandidateSchema), warnings: z.array(z.string()) }).strict();
export const parseRawFileAnalysis = (value) => RawFileAnalysisSchema.parse(value);
```

Implement the canonical schemas in `symbol-index.mjs` by extending these fields with IDs and `filePath`. Canonical Type records store embedded `properties[]`; this resolves the design text's `propertyIds[]`/embedded-property inconsistency in favor of section 7.6, which explicitly says there is no separate Property collection in schema `1.0.0`. Add one `superRefine` that builds Type, Method, Function, and File ID sets and rejects every dangling File ID, `ownerTypeId`, `typeIds`, `methodIds`, `functionIds`, internal import endpoint, and resolved call endpoint. Export `SymbolIndexSchema` and `parseSymbolIndex`.

Implement `code-graph.mjs` with strict schemas for the approved outer shape and only node types `file`, `class`, and `function`, edge types `contains`, `imports`, and `calls`, fixed `direction: "forward"`, weight in `[0, 1]`, and required `project.analyzedAt`.

Implement `analysis-report.mjs` with strict fields: `schemaVersion`, `skillVersion`, `status`, `coverage`, `warnings`, `parserFailures`, `unsupportedFiles`, `relationships`, and `options`. `status` is `complete | partial`; `options` contains only `tracked`, `output`, and `keepIntermediate`.

- [ ] **Step 4: Implement deterministic text and JSON output**

```js
// lib/output/stable-json.mjs
export function normalizeText(value) {
  return value.replace(/\r\n?/g, "\n");
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

export function stableStringify(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}
```

- [ ] **Step 5: Run tests, add dangling-reference cases, and commit**

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/schemas.test.mjs tests/unit/stable-json.test.mjs`

Expected: all schema and serialization tests PASS.

```bash
git add .github/skills/codebase-inspector/lib/schema .github/skills/codebase-inspector/lib/output/stable-json.mjs .github/skills/codebase-inspector/tests/unit
git commit -m "feat: define deterministic analysis schemas"
```

### Task 3: Git-Tracked Scanner, Ignore Rules, and Symlink Boundary

**Files:**
- Create: `.github/skills/codebase-inspector/lib/scanner/languages.mjs`
- Create: `.github/skills/codebase-inspector/lib/scanner/ignore-rules.mjs`
- Create: `.github/skills/codebase-inspector/lib/scanner/git-files.mjs`
- Create: `.github/skills/codebase-inspector/lib/scanner/scan.mjs`
- Create: `.github/skills/codebase-inspector/tests/helpers/fixture-repo.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/scanner.test.mjs`

**Interfaces:**
- Consumes: `RunConfig { targetRoot, gitDir, options }`.
- Produces: `getGitMetadata(targetRoot, { ignoredPaths })`, `scanProject(runConfig, { fsOps } = {}) -> { files, unsupportedFiles, warnings, git }`; production defaults `fsOps` to `node:fs/promises`, while tests may inject `lstat`, `realpath`, and `readFile`. Each supported file includes normalized relative path, language, category, line count, bytes, and normalized content, while each unsupported text file includes path, `language: "unknown"`, `category: "unsupported"`, line count, and bytes without persisted content.

- [ ] **Step 1: Write an isolated Git fixture helper and failing scanner test**

```js
// tests/helpers/fixture-repo.mjs
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

export async function createFixtureRepo(files) {
  const root = await mkdtemp(join(tmpdir(), "codebase-inspector-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "fixture@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Fixture"]);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-qm", "fixture"]);
  return root;
}
```

```js
// tests/unit/scanner.test.mjs
import { symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { createFixtureRepo } from "../helpers/fixture-repo.mjs";
import { scanProject } from "../../lib/scanner/scan.mjs";

it.skipIf(process.platform === "win32")("reads tracked working-tree contents, applies ignore rules, and blocks symlink escape", async () => {
  const root = await createFixtureRepo({ "src/a.ts": "export function a() { return 1; }\r\n", "vendor/v.py": "def v(): pass\n", "README.md": "x\n", ".codeinspectorignore": "vendor/\n" });
  await writeFile(join(root, "src/a.ts"), "export function a() { return 2; }\r\n");
  const outside = join(dirname(root), "outside.ts");
  await writeFile(outside, "export const secret = true;\n");
  await symlink(outside, join(root, "src/outside.ts"));
  execFileSync("git", ["-C", root, "add", "src/outside.ts"]);
  const result = await scanProject({ targetRoot: root, gitDir: join(root, ".git"), options: {} });
  expect(result.files.map((file) => file.path)).toEqual(["src/a.ts"]);
  expect(result.files[0]).toMatchObject({ language: "typescript", lineCount: 2, content: "export function a() { return 2; }\n" });
  expect(result.unsupportedFiles).toContainEqual(expect.objectContaining({ path: "README.md", language: "unknown", category: "unsupported" }));
  expect(result.warnings).toContainEqual(expect.stringMatching(/outside\.ts.*symlink/));
});
```

- [ ] **Step 2: Run the scanner test and verify it fails**

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/scanner.test.mjs`

Expected: FAIL because `scan.mjs` does not exist.

- [ ] **Step 3: Implement language detection and deterministic Git reads**

In `languages.mjs`, export one frozen extension map covering exactly: `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.py`, `.pyi`, `.rs`, `.go`, `.java`, `.kt`, `.kts`, `.cs`, `.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`, `.php`, `.rb`, `.rake`, `.dart`, `.sh`, `.bash`, and `.zsh`. Classify files as `source`, `test`, or `entrypoint` using the approved language config patterns; category classification must not change whether a file is analyzed.

In `git-files.mjs`, call Git only with `execFile` and argument arrays:

```js
git -C <root> rev-parse --show-toplevel
git -C <root> rev-parse --absolute-git-dir
git -C <root> ls-files -z
git -C <root> rev-parse HEAD
git -C <root> show -s --format=%cI HEAD
git -C <root> status --porcelain=v1 -z
```

Return normalized root, Git directory, tracked path list, commit hash, ISO commit timestamp, and dirty boolean. Determine dirty state after removing status entries under the normalized configured output path, so a previous generated output cannot change the next generated `workingTreeDirty` value. Do not invoke a shell and do not interpolate a target path into a command string.

- [ ] **Step 4: Implement ignore and safe content reads**

Use `ignore` with built-ins `.git/`, `.code-understanding/`, the configured output directory, `node_modules/`, common binary/media extensions, and `.codeinspectorignore`. For each `git ls-files` path:

1. Normalize separators and reject absolute or `..` paths.
2. `lstat` the working-tree path.
3. If it is a symlink, resolve `realpath` and include it only when the resolved path remains under `realpath(targetRoot)` and is a regular file.
4. Read the working-tree content, reject NUL-containing files as binary, decode UTF-8, normalize CRLF/CR to LF, and compute `lineCount` as `0` for empty text or `text.split("\n").length` otherwise.
5. Record unsupported tracked text-file metadata separately. Content may be read only long enough to reject binary data and count normalized lines; it must not remain on the unsupported record or appear in generated output.

- [ ] **Step 5: Run focused tests and commit**

Add cases for uppercase extensions, an internal symlink, an ignored output override, NUL bytes, dirty state, and paths containing spaces. Add an injected-filesystem unit case that reports an outside-root symlink on every operating system; the real-symlink case is skipped on Windows because standard CI runners may not grant file-symlink privilege.

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/scanner.test.mjs`

Expected: all scanner cases PASS.

```bash
git add .github/skills/codebase-inspector/lib/scanner .github/skills/codebase-inspector/tests/helpers/fixture-repo.mjs .github/skills/codebase-inspector/tests/unit/scanner.test.mjs
git commit -m "feat: scan tracked files within repository boundary"
```

### Task 4: Standalone Tree-sitter Runtime and Dart Grammar

**Files:**
- Create: `.github/skills/codebase-inspector/lib/parsers/tree-sitter-runtime.mjs`
- Create: `.github/skills/codebase-inspector/lib/parsers/registry.mjs`
- Create: `.github/skills/codebase-inspector/lib/extractors/base-extractor.mjs`
- Create: `.github/skills/codebase-inspector/vendor/tree-sitter-dart/tree-sitter-dart.wasm`
- Create: `.github/skills/codebase-inspector/vendor/tree-sitter-dart/BUILD.md`
- Create: `.github/skills/codebase-inspector/vendor/tree-sitter-dart/LICENSE`
- Create: `.github/skills/codebase-inspector/tests/unit/parser-runtime.test.mjs`

**Interfaces:**
- Consumes: a supported `FileCandidate` and registered extractor implementing `extract(rootNode, context) -> RawFileAnalysis`.
- Produces: `createParserRegistry(skillDir) -> { languages, analyzeFile, close }`; parser failures become structured warnings, not process crashes.

- [ ] **Step 1: Write a failing runtime test with a fake extractor**

```js
// tests/unit/parser-runtime.test.mjs
import { expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createParserRegistry } from "../../lib/parsers/registry.mjs";

it("loads JavaScript grammar and returns strict raw analysis", async () => {
  const registry = await createParserRegistry(fileURLToPath(new URL("../..", import.meta.url)));
  const result = await registry.analyzeFile({ path: "a.js", language: "javascript", content: "function a() {}\n" });
  expect(result).toMatchObject({ filePath: "a.js", language: "javascript", warnings: [] });
  await registry.close();
});
```

- [ ] **Step 2: Run the runtime test and verify it fails**

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/parser-runtime.test.mjs`

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Copy the upstream AST helpers and Dart artifact with provenance**

Run from the repository root:

```bash
UPSTREAM=../Understand-Anything/understand-anything-plugin/packages/core/dist/plugins/extractors
cp "$UPSTREAM/base-extractor.js" .github/skills/codebase-inspector/lib/extractors/base-extractor.mjs
cp ../Understand-Anything/understand-anything-plugin/packages/tree-sitter-dart-wasm/tree-sitter-dart.wasm .github/skills/codebase-inspector/vendor/tree-sitter-dart/tree-sitter-dart.wasm
cp ../Understand-Anything/understand-anything-plugin/packages/tree-sitter-dart-wasm/BUILD.md .github/skills/codebase-inspector/vendor/tree-sitter-dart/BUILD.md
```

Prepend this exact header to the adapted helper:

```js
// Adapted from Egonex-AI/Understand-Anything at 54754a6f97051d1d76c8758353d8ea41afe502a6.
// Original project and this adaptation are licensed under MIT; see repository NOTICE.
```

Add the Dart grammar's actual upstream license text as `vendor/tree-sitter-dart/LICENSE`, after verifying it in the grammar source referenced by `BUILD.md`. The license check is a release blocker; do not label an unknown license as MIT.

- [ ] **Step 4: Implement grammar configuration and parser cleanup**

Create a frozen configuration table with exact package/file pairs from the approved design and upstream configs. C and C++ both use `tree-sitter-cpp/tree-sitter-cpp.wasm`; Dart uses `resolve(skillDir, "vendor/tree-sitter-dart/tree-sitter-dart.wasm")`; Shell has no Tree-sitter grammar.

`tree-sitter-runtime.mjs` must:

1. Call `Parser.init()` once.
2. Resolve npm grammar WASM with `createRequire(import.meta.url).resolve()`.
3. Load all grammars concurrently and retain per-language load failures.
4. Select TSX grammar for `.tsx`.
5. Parse normalized content, pass the root node to the extractor, validate the result with `parseRawFileAnalysis`, and always call both `tree.delete()` and `parser.delete()` in `finally`.
6. Return a valid empty `RawFileAnalysis` plus a warning when one grammar or extractor fails.

`registry.mjs` must not import any Understand-Anything package. Initially register a minimal JavaScript extractor that returns the one top-level function needed by the test; Task 5 replaces it with the adapted full extractor.

- [ ] **Step 5: Verify independent resolution and commit**

Run:

```bash
cd .github/skills/codebase-inspector
npm ci
npm run test:unit -- tests/unit/parser-runtime.test.mjs
node -e "import('./lib/parsers/registry.mjs').then(() => console.log('standalone-ok'))"
```

Expected: runtime test PASS and `standalone-ok`; `rg -n "@understand-anything|\.\./Understand-Anything" lib scripts package.json` returns no matches.

```bash
git add .github/skills/codebase-inspector/lib/parsers .github/skills/codebase-inspector/lib/extractors/base-extractor.mjs .github/skills/codebase-inspector/vendor .github/skills/codebase-inspector/tests/unit/parser-runtime.test.mjs
git commit -m "feat: add standalone tree sitter runtime"
```

### Task 5: JavaScript, TypeScript, and Python Rich Symbol Extraction

**Files:**
- Create: `.github/skills/codebase-inspector/lib/extractors/typescript-extractor.mjs`
- Create: `.github/skills/codebase-inspector/lib/extractors/python-extractor.mjs`
- Modify: `.github/skills/codebase-inspector/lib/parsers/registry.mjs`
- Create: `.github/skills/codebase-inspector/tests/languages/typescript.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/languages/python.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/fixtures/languages/typescript/sample.ts`
- Create: `.github/skills/codebase-inspector/tests/fixtures/languages/python/sample.py`

**Interfaces:**
- Consumes: Tree-sitter root node and `{ filePath, language }` context.
- Produces: strict `RawFileAnalysis`; class methods are emitted only in `methods`, top-level callables only in `functions`, and every parameter is `{ name, type }` without a default literal.

- [ ] **Step 1: Create fixtures that expose ownership and modifier requirements**

```ts
// tests/fixtures/languages/typescript/sample.ts
import { format } from "./format.js";
export interface Runner { run(input: string): Promise<string>; }
export class Greeter implements Runner {
  private prefix: string;
  constructor(prefix: string) { this.prefix = prefix; }
  public async run(input: string = "secret"): Promise<string> { return format(this.prefix + input); }
  static create(): Greeter { return new Greeter("hi"); }
}
export function add(left: number, right: number): number { return left + right; }
```

```python
# tests/fixtures/languages/python/sample.py
from .formatting import format_name

class Greeter(BaseGreeter):
    prefix: str

    def __init__(self, prefix: str):
        self.prefix = prefix

    async def greet(self, name: str = "secret") -> str:
        return format_name(self.prefix + name)

def add(left: int, right: int) -> int:
    return left + right
```

- [ ] **Step 2: Write failing assertions for canonical raw records**

For TypeScript assert two types (`Runner` as `interface`, `Greeter` as `class`), three Greeter methods including constructor, one free function, typed parameters, `run.async === true`, `run.visibility === "public"`, `create.static === true`, a `format` call candidate owned by `Greeter.run`, and no serialized string `secret`. For Python assert one class, two methods owned by `Greeter`, one free function, `greet.async === true`, inferred language export convention represented as `exported: null`, typed parameters, a `format_name` call candidate owned by `Greeter.greet`, and no default literal.

Run: `cd .github/skills/codebase-inspector && npm run test:languages -- tests/languages/typescript.test.mjs tests/languages/python.test.mjs`

Expected: FAIL because rich extractors are absent.

- [ ] **Step 3: Copy and adapt the pinned upstream extractors**

```bash
UPSTREAM=../Understand-Anything/understand-anything-plugin/packages/core/dist/plugins/extractors
cp "$UPSTREAM/typescript-extractor.js" .github/skills/codebase-inspector/lib/extractors/typescript-extractor.mjs
cp "$UPSTREAM/python-extractor.js" .github/skills/codebase-inspector/lib/extractors/python-extractor.mjs
```

Prepend the origin header from Task 4. Replace `extractStructure`/`extractCallGraph` public output with `extract(rootNode, context) -> RawFileAnalysis`. Preserve upstream AST traversal, then make these exact changes:

- Parameter helpers return `{ name, type }`; they inspect only annotation/type nodes and discard initializer/default expression text.
- TypeScript declaration kinds map class/interface/enum to canonical kinds; Python class maps to `class`.
- Every class body callable captures `ownerName`; it is removed from top-level `functions`.
- Constructor return type is `null`; TypeScript visibility defaults to `public` only where the language specifies that default; Python visibility remains `null`.
- TypeScript `export` syntax controls `exported`; JavaScript CommonJS exports are recorded only when statically explicit; Python export is `null`.
- Call candidates carry both caller name and current owner from traversal context.
- Imports remain textual candidates and are not resolved inside extractors.

- [ ] **Step 4: Register both extractors and run the language tests**

The registry maps `javascript` and `typescript` to one `TypeScriptExtractor` instance, and `python` to one `PythonExtractor` instance.

Run: `cd .github/skills/codebase-inspector && npm run test:languages -- tests/languages/typescript.test.mjs tests/languages/python.test.mjs`

Expected: both suites PASS and snapshots contain no source body or `secret` literal.

- [ ] **Step 5: Commit the language group**

```bash
git add .github/skills/codebase-inspector/lib/extractors .github/skills/codebase-inspector/lib/parsers/registry.mjs .github/skills/codebase-inspector/tests/languages .github/skills/codebase-inspector/tests/fixtures/languages
git commit -m "feat: extract javascript typescript and python symbols"
```

### Task 6: Rust and Go Rich Symbol Extraction

**Files:**
- Create: `.github/skills/codebase-inspector/lib/extractors/rust-extractor.mjs`
- Create: `.github/skills/codebase-inspector/lib/extractors/go-extractor.mjs`
- Modify: `.github/skills/codebase-inspector/lib/parsers/registry.mjs`
- Create: `.github/skills/codebase-inspector/tests/languages/rust.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/languages/go.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/fixtures/languages/rust/sample.rs`
- Create: `.github/skills/codebase-inspector/tests/fixtures/languages/go/sample.go`

**Interfaces:**
- Consumes: Task 4 parser runtime and Task 2 raw schema.
- Produces: Rust struct/enum/trait/impl ownership and Go struct/interface/receiver-method records without duplicating methods as free functions.

- [ ] **Step 1: Create fixtures and failing language tests**

```rust
use crate::format::format_name;
pub struct Greeter { prefix: String }
pub trait Runner { fn run(&self, input: &str) -> String; }
impl Greeter {
    pub fn new(prefix: String) -> Self { Self { prefix } }
    pub async fn run(&self, input: &str) -> String { format_name(input) }
}
pub fn add(left: i32, right: i32) -> i32 { left + right }
```

```go
package sample
import "example.local/project/format"
type Greeter struct { Prefix string }
type Runner interface { Run(input string) string }
func NewGreeter(prefix string) *Greeter { return &Greeter{Prefix: prefix} }
func (g *Greeter) Run(input string) string { return format.Name(input) }
```

Assert Rust `Greeter` is `struct`, `Runner` is `trait`, impl methods are owned by `Greeter`, `run.async` is true, `add` is a free function, `format_name` is emitted as a call candidate, and `&self` is not emitted as a user parameter. Assert Go receiver `Run` is a method owned by `Greeter`, `NewGreeter` is free, uppercase names are exported, interface method ownership is `Runner`, field/property types are preserved, and `format.Name` is emitted as a call candidate.

Run: `cd .github/skills/codebase-inspector && npm run test:languages -- tests/languages/rust.test.mjs tests/languages/go.test.mjs`

Expected: FAIL because the extractors are not registered.

- [ ] **Step 2: Copy and adapt pinned upstream files**

```bash
UPSTREAM=../Understand-Anything/understand-anything-plugin/packages/core/dist/plugins/extractors
cp "$UPSTREAM/rust-extractor.js" .github/skills/codebase-inspector/lib/extractors/rust-extractor.mjs
cp "$UPSTREAM/go-extractor.js" .github/skills/codebase-inspector/lib/extractors/go-extractor.mjs
```

Apply the origin header. Rust ownership comes from the enclosing `impl_item` type; trait signatures belong to the trait Type. Go ownership comes from `method_declaration.receiver`; interface method signatures belong to the interface Type. Use language-defined visibility: Rust `pub` and Go initial uppercase letter. Go has no async modifier, so `async: null`; Rust `async` syntax yields a boolean. Preserve generic/type text but never body text.

- [ ] **Step 3: Register, verify, and commit**

Run: `cd .github/skills/codebase-inspector && npm run test:languages -- tests/languages/rust.test.mjs tests/languages/go.test.mjs`

Expected: both suites PASS.

```bash
git add .github/skills/codebase-inspector/lib/extractors/{rust,go}-extractor.mjs .github/skills/codebase-inspector/lib/parsers/registry.mjs .github/skills/codebase-inspector/tests/languages/{rust,go}.test.mjs .github/skills/codebase-inspector/tests/fixtures/languages/{rust,go}
git commit -m "feat: extract rust and go symbols"
```

### Task 7: Java and Kotlin Rich Symbol Extraction

**Files:**
- Create: `.github/skills/codebase-inspector/lib/extractors/java-extractor.mjs`
- Create: `.github/skills/codebase-inspector/lib/extractors/kotlin-extractor.mjs`
- Modify: `.github/skills/codebase-inspector/lib/parsers/registry.mjs`
- Create: `.github/skills/codebase-inspector/tests/languages/java.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/languages/kotlin.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/fixtures/languages/java/Greeter.java`
- Create: `.github/skills/codebase-inspector/tests/fixtures/languages/kotlin/Greeter.kt`

**Interfaces:**
- Consumes: Tree-sitter Java/Kotlin roots.
- Produces: classes, interfaces, enums, fields/properties, constructors, methods, and top-level Kotlin functions with explicit JVM-language modifiers.

- [ ] **Step 1: Create fixtures and failing assertions**

```java
package demo;
import demo.format.Formatter;
public final class Greeter implements Runner {
  private final String prefix;
  public Greeter(String prefix) { this.prefix = prefix; }
  public static Greeter create() { return new Greeter("hi"); }
  @Override public String run(String input) { return Formatter.format(input); }
}
interface Runner { String run(String input); }
```

```kotlin
package demo
import demo.format.formatName
interface Runner { fun run(input: String): String }
class Greeter(private val prefix: String) : Runner {
    override fun run(input: String): String = formatName(input)
    companion object { fun create(): Greeter = Greeter("hi") }
}
suspend fun load(): String = "ok"
```

Assert Java constructor ownership, public/private/static fields, interface kind, implements list, `Formatter.format` call candidates, and no function duplication. Assert Kotlin primary-constructor property, interface, class method, `formatName` call candidates, companion method ownership under a stable `Greeter.Companion` module/type record, top-level `load` as a function, and `suspend` represented as `async: true`.

Run: `cd .github/skills/codebase-inspector && npm run test:languages -- tests/languages/java.test.mjs tests/languages/kotlin.test.mjs`

Expected: FAIL because extractors are absent.

- [ ] **Step 2: Copy, adapt, and register**

```bash
UPSTREAM=../Understand-Anything/understand-anything-plugin/packages/core/dist/plugins/extractors
cp "$UPSTREAM/java-extractor.js" .github/skills/codebase-inspector/lib/extractors/java-extractor.mjs
cp "$UPSTREAM/kotlin-extractor.js" .github/skills/codebase-inspector/lib/extractors/kotlin-extractor.mjs
```

Apply the origin header. Preserve Java package-default visibility as `package`; Kotlin declarations without an explicit visibility modifier are `public` per language rules. Map Kotlin `internal` exactly. Constructors are methods named after their owner. Annotations are not copied into output. For Java/Kotlin nested types, use a dotted owner name such as `Outer.Inner`; for Kotlin companion object, emit kind `module` with name `Greeter.Companion` so method ownership is not lost.

- [ ] **Step 3: Run tests and commit**

Run: `cd .github/skills/codebase-inspector && npm run test:languages -- tests/languages/java.test.mjs tests/languages/kotlin.test.mjs`

Expected: both suites PASS.

```bash
git add .github/skills/codebase-inspector/lib/extractors/{java,kotlin}-extractor.mjs .github/skills/codebase-inspector/lib/parsers/registry.mjs .github/skills/codebase-inspector/tests/languages/{java,kotlin}.test.mjs .github/skills/codebase-inspector/tests/fixtures/languages/{java,kotlin}
git commit -m "feat: extract java and kotlin symbols"
```

### Task 8: C, C++, and C# Rich Symbol Extraction

**Files:**
- Create: `.github/skills/codebase-inspector/lib/extractors/cpp-extractor.mjs`
- Create: `.github/skills/codebase-inspector/lib/extractors/csharp-extractor.mjs`
- Modify: `.github/skills/codebase-inspector/lib/parsers/registry.mjs`
- Create: `.github/skills/codebase-inspector/tests/languages/cpp.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/languages/csharp.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/fixtures/languages/cpp/sample.hpp`
- Create: `.github/skills/codebase-inspector/tests/fixtures/languages/cpp/sample.cpp`
- Create: `.github/skills/codebase-inspector/tests/fixtures/languages/csharp/Greeter.cs`

**Interfaces:**
- Consumes: C/C++ grammar for `.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`; C# grammar for `.cs`.
- Produces: C structs and free functions, C++ classes/structs/out-of-class methods, and C# classes/interfaces/records/methods/properties.

- [ ] **Step 1: Create fixtures and failing tests**

```cpp
// sample.hpp
#include "format.hpp"
class Greeter {
public:
  explicit Greeter(const char* prefix);
  static Greeter create();
  const char* run(const char* input) const;
private:
  const char* prefix_;
};
```

```cpp
// sample.cpp
#include "sample.hpp"
Greeter::Greeter(const char* prefix) : prefix_(prefix) {}
Greeter Greeter::create() { return Greeter("hi"); }
const char* Greeter::run(const char* input) const { return format(input); }
int add(int left, int right) { return left + right; }
```

```csharp
using Demo.Format;
public interface IRunner { string Run(string input); }
public sealed class Greeter : IRunner {
  private string Prefix { get; }
  public Greeter(string prefix) { Prefix = prefix; }
  public static Greeter Create() => new("hi");
  public async Task<string> Run(string input) => await Formatter.Format(input);
}
```

Assert out-of-class C++ definitions remain owned by `Greeter`, access sections control visibility, C free functions remain free, `format` is emitted as a call candidate, and headers/sources do not create duplicate symbols with the same source location. Assert C# property type/visibility, interface kind, constructor, static method, async method, owner IDs, and `Formatter.Format` call candidates.

Run: `cd .github/skills/codebase-inspector && npm run test:languages -- tests/languages/cpp.test.mjs tests/languages/csharp.test.mjs`

Expected: FAIL because extractors are absent.

- [ ] **Step 2: Copy, adapt, and register**

```bash
UPSTREAM=../Understand-Anything/understand-anything-plugin/packages/core/dist/plugins/extractors
cp "$UPSTREAM/cpp-extractor.js" .github/skills/codebase-inspector/lib/extractors/cpp-extractor.mjs
cp "$UPSTREAM/csharp-extractor.js" .github/skills/codebase-inspector/lib/extractors/csharp-extractor.mjs
```

Apply the origin header. In C++, owner comes from an enclosing class or a qualified declarator such as `Greeter::run`; visibility follows the current access specifier, with `class` defaulting private and `struct` defaulting public. In C mode, `struct` is a Type and function definitions are free Functions. In C#, constructors and methods are Methods, properties are embedded Property records, explicit modifier nodes drive visibility/static/async, and absent visibility follows C# defaults (`private` for class members, `public` for interface members).

- [ ] **Step 3: Run tests and commit**

Run: `cd .github/skills/codebase-inspector && npm run test:languages -- tests/languages/cpp.test.mjs tests/languages/csharp.test.mjs`

Expected: both suites PASS.

```bash
git add .github/skills/codebase-inspector/lib/extractors/{cpp,csharp}-extractor.mjs .github/skills/codebase-inspector/lib/parsers/registry.mjs .github/skills/codebase-inspector/tests/languages/{cpp,csharp}.test.mjs .github/skills/codebase-inspector/tests/fixtures/languages/{cpp,csharp}
git commit -m "feat: extract c cpp and csharp symbols"
```

### Task 9: PHP, Ruby, Dart, and Shell Rich Symbol Extraction

**Files:**
- Create: `.github/skills/codebase-inspector/lib/extractors/php-extractor.mjs`
- Create: `.github/skills/codebase-inspector/lib/extractors/ruby-extractor.mjs`
- Create: `.github/skills/codebase-inspector/lib/extractors/dart-extractor.mjs`
- Create: `.github/skills/codebase-inspector/lib/parsers/shell-parser.mjs`
- Modify: `.github/skills/codebase-inspector/lib/parsers/registry.mjs`
- Create: `.github/skills/codebase-inspector/tests/languages/php.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/languages/ruby.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/languages/dart.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/languages/shell.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/fixtures/languages/php/Greeter.php`
- Create: `.github/skills/codebase-inspector/tests/fixtures/languages/ruby/greeter.rb`
- Create: `.github/skills/codebase-inspector/tests/fixtures/languages/dart/greeter.dart`
- Create: `.github/skills/codebase-inspector/tests/fixtures/languages/shell/sample.sh`

**Interfaces:**
- Consumes: Task 4 parser registry and RawFileAnalysis schema.
- Produces: rich PHP/Ruby/Dart records and bounded Shell function/source records with no Shell execution.

- [ ] **Step 1: Create fixtures and failing tests**

```php
<?php
namespace Demo;
use Demo\Format\Formatter;
trait Named { public function name(): string { return "x"; } }
class Greeter implements Runner {
    private string $prefix;
    public function __construct(string $prefix) { $this->prefix = $prefix; }
    public static function create(): Greeter { return new Greeter("hi"); }
    public function run(string $input = "secret"): string { return Formatter::format($input); }
}
function add(int $left, int $right): int { return $left + $right; }
```

```ruby
require_relative "formatting"
module Named
  def name = "x"
end
class Greeter
  attr_reader :prefix
  def initialize(prefix) = @prefix = prefix
  def self.create = new("hi")
  def run(input = "secret") = Formatting.format(input)
end
def add(left, right) = left + right
```

```dart
import 'formatting.dart';
abstract class Runner { String run(String input); }
class Greeter implements Runner {
  final String prefix;
  Greeter(this.prefix);
  static Greeter create() => Greeter('hi');
  @override Future<String> run(String input) async => formatName(input);
}
int add(int left, int right) => left + right;
```

```bash
#!/usr/bin/env bash
source "./formatting.sh"
greet() {
  local name="$1"
  format_name "$name"
}
function add {
  printf '%s\n' "$(( $1 + $2 ))"
}
main() {
  greet "world"
  missing_command
}
```

Assert PHP class/trait kinds, owned constructor/static/instance methods, property types, free function, and call candidates without default literals. Assert Ruby module/class kinds, `self.create` as a static method named `create`, `attr_reader` property, instance method ownership, unknown types as null, and direct literal calls. Assert Dart interface-like abstract class remains `class` with abstract method ownership, method async/static flags, field type, free function, and call candidates. Assert Shell emits three free functions, one `source` import candidate, and direct literal command heads `greet` and `missing_command` as call candidates, with every unavailable type/modifier set to null.

Run: `cd .github/skills/codebase-inspector && npm run test:languages -- tests/languages/php.test.mjs tests/languages/ruby.test.mjs tests/languages/dart.test.mjs tests/languages/shell.test.mjs`

Expected: FAIL because the extractors and Shell parser are absent.

- [ ] **Step 2: Copy the pinned upstream implementations**

```bash
UPSTREAM=../Understand-Anything/understand-anything-plugin/packages/core/dist/plugins/extractors
cp "$UPSTREAM/php-extractor.js" .github/skills/codebase-inspector/lib/extractors/php-extractor.mjs
cp "$UPSTREAM/ruby-extractor.js" .github/skills/codebase-inspector/lib/extractors/ruby-extractor.mjs
cp "$UPSTREAM/dart-extractor.js" .github/skills/codebase-inspector/lib/extractors/dart-extractor.mjs
cp ../Understand-Anything/understand-anything-plugin/packages/core/dist/plugins/parsers/shell-parser.js .github/skills/codebase-inspector/lib/parsers/shell-parser.mjs
```

Apply the Task 4 origin header to all four files.

- [ ] **Step 3: Adapt the language contracts**

- PHP class/interface/trait/enum declarations use their real canonical kind; explicit PHP visibility and `static` modifiers are retained; absent class-member visibility follows the PHP default `public`; public top-level functions use `exported: null` because PHP has no module export syntax.
- Ruby class/module declarations use `class`/`module`; ordinary `def` under a type is a Method; `def self.name` is a Method with `static: true` and canonical name `name`; top-level `def` is a Function; visibility changes made by `private`, `protected`, and `public` calls apply only to subsequent declarations in that lexical type.
- Dart constructors are Methods named after the owner, methods beginning `_` are private and not exported, other names are public/exported by Dart's library rule, and `async` syntax sets `async: true`.
- Shell parser recognizes only function declarations, `source`/`.` references, and direct literal command heads inside known function bodies. It strips comments for matching, counts braces without evaluating expansions, ignores assignments/control keywords/builtins/redirections/substitutions, emits literal command names as call candidates, and never invokes a shell.

- [ ] **Step 4: Register, verify, and commit**

Run: `cd .github/skills/codebase-inspector && npm run test:languages -- tests/languages/php.test.mjs tests/languages/ruby.test.mjs tests/languages/dart.test.mjs tests/languages/shell.test.mjs`

Expected: all four suites PASS, including Dart parsing through the vendored WASM.

```bash
git add .github/skills/codebase-inspector/lib/extractors/{php,ruby,dart}-extractor.mjs .github/skills/codebase-inspector/lib/parsers/{registry,shell-parser}.mjs .github/skills/codebase-inspector/tests/languages .github/skills/codebase-inspector/tests/fixtures/languages
git commit -m "feat: extract php ruby dart and shell symbols"
```

### Task 10: Path-Oriented Import Resolution

**Files:**
- Create: `.github/skills/codebase-inspector/lib/imports/file-candidates.mjs`
- Create: `.github/skills/codebase-inspector/lib/imports/module-config.mjs`
- Create: `.github/skills/codebase-inspector/lib/imports/path-languages.mjs`
- Create: `.github/skills/codebase-inspector/lib/imports/resolve-imports.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/path-imports.test.mjs`

**Interfaces:**
- Consumes: scanned file paths/content plus raw import candidates for JavaScript, TypeScript, Python, Ruby, PHP, Dart, and Shell.
- Produces: `resolveImports(scanResult, rawAnalyses) -> { internal, external, unresolved, warnings }`; every internal record has `sourceFileId`, `targetFileId`, `source`, and `lineNumber`.

- [ ] **Step 1: Write failing table-driven resolution tests**

```js
// tests/unit/path-imports.test.mjs
import { describe, expect, it } from "vitest";
import { resolvePathImport } from "../../lib/imports/path-languages.mjs";

const paths = [
  "src/app.ts", "src/lib/format.ts", "src/lib/index.ts",
  "pkg/app.py", "pkg/formatting.py", "pkg/__init__.py",
  "lib/app.rb", "lib/formatting.rb",
  "lib/app.dart", "lib/formatting.dart",
  "scripts/app.sh", "scripts/formatting.sh"
];

describe("resolvePathImport", () => {
  it.each([
    ["typescript", "src/app.ts", "@lib/format", "src/lib/format.ts"],
    ["python", "pkg/app.py", ".formatting", "pkg/formatting.py"],
    ["ruby", "lib/app.rb", "./formatting", "lib/formatting.rb"],
    ["dart", "lib/app.dart", "formatting.dart", "lib/formatting.dart"],
    ["shell", "scripts/app.sh", "./formatting.sh", "scripts/formatting.sh"]
  ])("resolves %s %s", (language, from, source, expected) => {
    expect(resolvePathImport({ language, from, source, paths, config: { tsPaths: { "@lib/*": ["src/lib/*"] } } })).toEqual([expected]);
  });
});
```

Add separate tests for TypeScript extension/index candidates, JS `package.json` exports remaining external, Python multi-dot relative imports, Ruby `require_relative`, PHP Composer PSR-4 class imports, Dart `package:` imports using `pubspec.yaml`, and Shell `source` paths. Ambiguous internal candidates must return an unresolved reason, not a guessed target.

- [ ] **Step 2: Run tests and verify missing-module failures**

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/path-imports.test.mjs`

Expected: FAIL because import modules do not exist.

- [ ] **Step 3: Implement structured module configuration readers**

`module-config.mjs` reads only tracked configuration files:

- Parse `tsconfig.json`/`jsconfig.json` with `jsonc-parser`; collect `compilerOptions.baseUrl` and `paths` without resolving project references.
- Parse `composer.json` with `JSON.parse`; collect `autoload.psr-4` and `autoload-dev.psr-4` maps.
- Parse `pubspec.yaml` with `yaml.parse`; collect package `name`.
- Parse no target package manifest by executing package tooling.
- On malformed configuration, return a warning and continue with relative resolution only.

`file-candidates.mjs` exposes `existingCandidates(basePath, language, trackedPathSet)` and checks a fixed, language-specific extension list plus index/package forms. Candidate generation normalizes paths before membership checks and never touches the filesystem outside the scanned path set.

- [ ] **Step 4: Implement conservative path resolvers**

Use these exact resolution rules:

1. JS/TS: relative specifiers, then tsconfig `baseUrl`/`paths`; no Node package resolution into `node_modules`.
2. Python: leading-dot package-relative imports; absolute imports resolve from each tracked package root identified by `__init__.py`.
3. Ruby: `require_relative` from source directory; `require` from repository `lib/` only.
4. PHP: relative include paths plus exact longest-prefix Composer PSR-4 mapping.
5. Dart: relative URI plus `package:<project-name>/...` to `lib/...`; `dart:` and other packages are external.
6. Shell: relative `source`/`.` paths only; variables, command substitutions, and globbing are unresolved with reason `dynamic-source`.

`resolve-imports.mjs` dispatches by language, creates one internal record per target file, classifies package/runtime imports as external, classifies zero or multiple internal targets as unresolved with `not-found` or `ambiguous`, and sorts all groups by source file, line, source text, and target.

- [ ] **Step 5: Verify and commit**

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/path-imports.test.mjs`

Expected: all path-oriented import cases PASS.

```bash
git add .github/skills/codebase-inspector/lib/imports .github/skills/codebase-inspector/tests/unit/path-imports.test.mjs
git commit -m "feat: resolve path oriented imports"
```

### Task 11: Namespace- and Package-Oriented Import Resolution

**Files:**
- Modify: `.github/skills/codebase-inspector/lib/imports/module-config.mjs`
- Create: `.github/skills/codebase-inspector/lib/imports/namespace-languages.mjs`
- Modify: `.github/skills/codebase-inspector/lib/imports/resolve-imports.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/namespace-imports.test.mjs`

**Interfaces:**
- Consumes: Go module path, Rust file layout, JVM/C# package declarations, and C/C++ quoted includes.
- Produces: the same deterministic `ImportResolutionResult` from Task 10.

- [ ] **Step 1: Write failing package-resolution tests**

```js
// tests/unit/namespace-imports.test.mjs
import { expect, it } from "vitest";
import { resolveNamespaceImport } from "../../lib/imports/namespace-languages.mjs";

it("maps a Go module import to every tracked source file in that package", () => {
  expect(resolveNamespaceImport({
    language: "go",
    from: "cmd/app/main.go",
    source: "example.local/project/format",
    paths: ["cmd/app/main.go", "format/a.go", "format/b.go"],
    config: { goModule: "example.local/project" }
  })).toEqual(["format/a.go", "format/b.go"]);
});

it("maps Rust crate modules deterministically", () => {
  expect(resolveNamespaceImport({ language: "rust", from: "src/main.rs", source: "crate::format", paths: ["src/main.rs", "src/format.rs"], config: {} })).toEqual(["src/format.rs"]);
});
```

Add tests for Rust `mod name`, Java/Kotlin exact type import and wildcard package import, C/C++ quoted include, and C# namespace imports. Namespace/package imports may yield multiple internal file targets; exact type imports must prefer the one file declaring that type.

- [ ] **Step 2: Run tests and verify they fail**

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/namespace-imports.test.mjs`

Expected: FAIL because `namespace-languages.mjs` does not exist.

- [ ] **Step 3: Extend configuration and declaration indexes**

Parse `go.mod` as text using the anchored first non-comment `module <path>` directive; no other Go directives are needed. Build indexes from already parsed source facts:

```js
{
  jvmTypes: Map<"demo.format.Formatter", ["src/main/java/demo/format/Formatter.java"]>,
  jvmPackages: Map<"demo.format", ["src/main/java/demo/format/Formatter.java"]>,
  csharpNamespaces: Map<"Demo.Format", ["src/Format/Formatter.cs"]>
}
```

Extractors must therefore retain package/namespace declarations as import candidates with `kind: "module"` and a reserved specifier entry `"@declaration"`; `resolve-imports.mjs` consumes those declaration candidates to build indexes and excludes them from emitted import records.

- [ ] **Step 4: Implement exact namespace rules**

1. Go internal import prefix `<module>/` maps to every tracked `.go` file under the corresponding directory, excluding `_test.go` unless the source is also a test file.
2. Rust `crate::`, `self::`, and `super::` map to `name.rs` or `name/mod.rs`; `mod name` uses the source directory. External crates remain external.
3. Java/Kotlin exact imports first query `jvmTypes`; wildcard/package imports query `jvmPackages`; same-package references are not fabricated as import edges without an import declaration.
4. C/C++ quoted includes resolve relative to the source directory, then repository root. Angle-bracket includes are external. No compiler include path or macro expansion is attempted.
5. C# `using` resolves to every file in the exact tracked namespace. `global using`, alias using, and `using static` use their target namespace/type text; zero matches remain external when the first namespace segment is not declared internally, otherwise unresolved.

- [ ] **Step 5: Run both import suites and commit**

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/path-imports.test.mjs tests/unit/namespace-imports.test.mjs`

Expected: both suites PASS with stable ordering.

```bash
git add .github/skills/codebase-inspector/lib/imports .github/skills/codebase-inspector/tests/unit/namespace-imports.test.mjs .github/skills/codebase-inspector/lib/extractors
git commit -m "feat: resolve package and namespace imports"
```

### Task 12: Stable IDs and Canonical Symbol Normalization

**Files:**
- Create: `.github/skills/codebase-inspector/lib/symbols/stable-id.mjs`
- Create: `.github/skills/codebase-inspector/lib/symbols/normalize.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/stable-id.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/normalize.test.mjs`

**Interfaces:**
- Consumes: project metadata, `ScanResult`, all strict `RawFileAnalysis` records, and `ImportResolutionResult`.
- Produces: schema-valid Symbol Index with unresolved calls not yet populated and deterministic collection ordering.

- [ ] **Step 1: Write failing ID and ownership tests**

```js
// tests/unit/stable-id.test.mjs
import { expect, it } from "vitest";
import { fileId, functionId, methodId, typeId } from "../../lib/symbols/stable-id.mjs";

it("normalizes separators and includes source location", () => {
  expect(fileId("src\\a.ts")).toBe("file:src/a.ts");
  expect(typeId("src/a.ts", "class", "Greeter", 3)).toBe("type:src/a.ts:class:Greeter:3");
  expect(methodId("src/a.ts", "Greeter", "run", 8)).toBe("method:src/a.ts:Greeter:run:8");
  expect(functionId("src/a.ts", "run", 20)).toBe("function:src/a.ts:run:20");
});
```

```js
// tests/unit/normalize.test.mjs
import { expect, it } from "vitest";
import { normalizeSymbols } from "../../lib/symbols/normalize.mjs";

it("resolves owner by file, owner name, and containing source location", () => {
  const { index } = normalizeSymbols(
    { name: "demo", root: null, gitCommitHash: "abc", workingTreeDirty: false, languages: ["typescript"], skillVersion: "0.1.0" },
    { files: [{ path: "a.ts", language: "typescript", category: "source", lineCount: 10 }], unsupportedFiles: [] },
    [{ filePath: "a.ts", language: "typescript", types: [{ kind: "class", name: "A", lineRange: [1, 8], properties: [], extends: [], implements: [], exported: true }], methods: [{ name: "m", ownerName: "A", lineRange: [2, 3], parameters: [], returnType: null, visibility: "public", static: false, async: false, exported: true }], functions: [], importCandidates: [], callCandidates: [], warnings: [] }],
    { internal: [], external: [], unresolved: [], warnings: [] }
  );
  expect(index.types[0].methodIds).toEqual([index.methods[0].id]);
  expect(index.files[0].methodIds).toEqual([index.methods[0].id]);
});
```

- [ ] **Step 2: Run tests and verify missing-module failures**

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/stable-id.test.mjs tests/unit/normalize.test.mjs`

Expected: FAIL because symbol modules do not exist.

- [ ] **Step 3: Implement exact IDs, deduplication, and ordering**

`stable-id.mjs` percent-encodes literal `:` and `%` inside path/name components so IDs remain parseable, but leaves `/` path separators. `normalize.mjs` must:

1. Create one File record for every supported or unsupported scanned text file. Unsupported records use `language: "unknown"`, `category: "unsupported"`, `parseStatus: "unsupported"`, and empty symbol arrays. Parser-warning files retain their detected language and use `parseStatus: "warning"`.
2. Convert raw types first and index them by `(filePath, name)`.
3. Resolve each Method owner only against a same-file type with the exact `ownerName`; for nested names, use the exact dotted name. A missing or multiple owner creates `{ filePath, code: "owner-not-found" | "owner-ambiguous", message }`, marks the File record as warning, and omits the method because canonical methods require an owner.
4. Create Functions only from raw free functions; never copy Methods into `functions[]`.
5. Remove only exact duplicate records with the same final ID; keep overloads at distinct start lines.
6. Attach type/method/function IDs to File records and method IDs to Type records.
7. Copy internal imports with stable IDs, and place external/unresolved import counts in coverage/report inputs rather than inventing File nodes.
8. Sort files by path; types by file/start/kind/name; methods/functions by file/start/name; imports by source/line/target.
9. Validate with `parseSymbolIndex` and return `{ index, warnings }`.

- [ ] **Step 4: Add tracked/local project-field tests, run, and commit**

Assert tracked project root is null, local project root may be absolute, unsupported files affect coverage but not `status`, and parser warnings produce `parseStatus: "warning"`.

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/stable-id.test.mjs tests/unit/normalize.test.mjs`

Expected: all cases PASS.

```bash
git add .github/skills/codebase-inspector/lib/symbols/{stable-id,normalize}.mjs .github/skills/codebase-inspector/tests/unit/{stable-id,normalize}.test.mjs
git commit -m "feat: normalize canonical symbol index"
```

### Task 13: Conservative Call Resolution and KnowledgeGraph Projection

**Files:**
- Create: `.github/skills/codebase-inspector/lib/symbols/resolve-calls.mjs`
- Create: `.github/skills/codebase-inspector/lib/graph/build-graph.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/resolve-calls.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/build-graph.test.mjs`

**Interfaces:**
- Consumes: canonical Symbol Index, raw call candidates, and Git commit timestamp.
- Produces: Symbol Index with resolved/unresolved calls, plus schema-valid KnowledgeGraph compatibility projection.

- [ ] **Step 1: Write failing call-resolution tests**

```js
// tests/unit/resolve-calls.test.mjs
import { expect, it } from "vitest";
import { resolveCalls } from "../../lib/symbols/resolve-calls.mjs";

it("resolves only one unambiguous reachable symbol", () => {
  const index = {
    schemaVersion: "1.0.0",
    project: { name: "x", root: null, gitCommitHash: "abc", workingTreeDirty: false, languages: ["typescript"], skillVersion: "0.1.0" },
    files: [
      { id: "file:a.ts", path: "a.ts", language: "typescript", category: "source", lineCount: 3, parseStatus: "parsed", typeIds: [], methodIds: [], functionIds: ["function:a.ts:caller:1"] },
      { id: "file:b.ts", path: "b.ts", language: "typescript", category: "source", lineCount: 1, parseStatus: "parsed", typeIds: [], methodIds: [], functionIds: ["function:b.ts:helper:1"] }
    ],
    types: [], methods: [],
    functions: [
      { id: "function:a.ts:caller:1", name: "caller", filePath: "a.ts", lineRange: [1, 3], parameters: [], returnType: null, visibility: null, async: false, exported: true },
      { id: "function:b.ts:helper:1", name: "helper", filePath: "b.ts", lineRange: [1, 1], parameters: [], returnType: null, visibility: null, async: false, exported: true }
    ],
    imports: [{ sourceFileId: "file:a.ts", targetFileId: "file:b.ts", source: "./b", lineNumber: 1 }], calls: [], unresolvedCalls: [],
    coverage: { trackedFiles: 2, supportedFiles: 2, parsedFiles: 2, warningFiles: 0, unsupportedFiles: 0 }
  };
  const result = resolveCalls(index, [{ filePath: "a.ts", callCandidates: [{ callerName: "caller", callerOwnerName: null, calleeText: "helper", lineNumber: 2 }] }]);
  expect(result.calls).toEqual([{ callerId: "function:a.ts:caller:1", calleeId: "function:b.ts:helper:1", filePath: "a.ts", lineNumber: 2 }]);
});
```

Add cases for same-owner method calls, imported calls, `Owner.method`, ambiguous duplicate names, unknown caller, dynamic/member expressions, and recursive calls. Ambiguous or unsupported calls must produce an unresolved record with one of: `caller-not-found`, `callee-not-found`, `ambiguous-callee`, or `dynamic-call`.

- [ ] **Step 2: Write a failing graph projection test**

Assert:

- File, Type, Method, and Function become deterministic graph nodes.
- Type node uses `type: "class"` and tags `kind:<actual-kind>`.
- Method node uses `type: "function"` and tags `method` and `owner:<type-id>`.
- File-to-Type, File-to-Function, Type-to-Method are `contains` edges.
- Imports and resolved calls are projected once.
- `layers` and `tour` are empty.
- Node summaries are empty strings and complexity is `simple`; no LLM-derived field is fabricated.
- `project.analyzedAt` equals the supplied Git commit timestamp.

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/resolve-calls.test.mjs tests/unit/build-graph.test.mjs`

Expected: FAIL because resolver and builder do not exist.

- [ ] **Step 3: Implement conservative call resolution**

For each candidate:

1. Resolve caller by same file, exact name, exact owner, and line containment; require exactly one.
2. Normalize callee text only by removing language punctuation that does not alter identity, such as `()` and leading `this.`/`self.`; do not evaluate expressions.
3. Search same owner, same file, then directly imported files. Stop at the first scope containing exactly one match.
4. Resolve qualified `Owner.method` only against an exact Type name and Method name visible in the same or imported file.
5. Emit a resolved call only for one match; otherwise emit a reason-coded unresolved record.
6. Sort and validate the updated Symbol Index.

- [ ] **Step 4: Implement and validate graph projection**

Graph IDs equal canonical symbol/File IDs. Use `summary: ""`, `complexity: "simple"`, `direction: "forward"`, and `weight: 1`. Add `language:<language>` to File tags, `kind:<kind>` to Type tags, and the approved method/function tags. Deduplicate edges by `(source, target, type)` and sort by type/source/target. Build `project` with `frameworks: []`, `description: "Deterministic static code structure generated without LLM analysis."`, Git hash, and commit timestamp. Validate with `parseCodeGraph`.

- [ ] **Step 5: Run tests and commit**

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/resolve-calls.test.mjs tests/unit/build-graph.test.mjs`

Expected: both suites PASS.

```bash
git add .github/skills/codebase-inspector/lib/symbols/resolve-calls.mjs .github/skills/codebase-inspector/lib/graph .github/skills/codebase-inspector/tests/unit/{resolve-calls,build-graph}.test.mjs
git commit -m "feat: resolve calls and build compatible graph"
```

### Task 14: Analysis Report and Markdown Views

**Files:**
- Create: `.github/skills/codebase-inspector/lib/reports/markdown.mjs`
- Create: `.github/skills/codebase-inspector/lib/reports/render.mjs`
- Create: `.github/skills/codebase-inspector/tests/helpers/report-fixtures.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/reports.test.mjs`

**Interfaces:**
- Consumes: one validated Symbol Index and one validated Analysis Report.
- Produces: `renderReports(symbolIndex, analysisReport) -> Map<string, string>` containing exactly `summary.md`, `files.md`, `classes.md`, `methods.md`, `functions.md`, and `dependencies.md`.

- [ ] **Step 1: Write failing report assertions**

```js
// tests/unit/reports.test.mjs
import { expect, it } from "vitest";
import { renderReports } from "../../lib/reports/render.mjs";
import { analysisReportFixture, symbolIndexFixture } from "../helpers/report-fixtures.mjs";

it("renders six LF-terminated reports from canonical facts", () => {
  const reports = renderReports(symbolIndexFixture, analysisReportFixture);
  expect([...reports.keys()]).toEqual(["summary.md", "files.md", "classes.md", "methods.md", "functions.md", "dependencies.md"]);
  expect(reports.get("methods.md")).toContain("| Greeter | run | `run(input: string)` | `Promise<string>` | public | No | Yes | `src/a.ts` | 4-8 |");
  expect(reports.get("classes.md")).toContain("| class | Greeter | `src/a.ts` | 1-12 | `value: string` | 1 | - | Runner |");
  expect(reports.get("summary.md")).not.toMatch(/\/Users\/|[A-Z]:\\/);
  for (const text of reports.values()) expect(text.endsWith("\n")).toBe(true);
});
```

Create `tests/helpers/report-fixtures.mjs` with exported complete, schema-valid `symbolIndexFixture` and `analysisReportFixture` objects containing the Greeter rows asserted above. Add cases for pipe/backtick escaping, empty values rendered as `-`, partial coverage warning at the top of every report, unresolved/external dependency sections, and deterministic row ordering.

- [ ] **Step 2: Run tests and verify the missing module failure**

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/reports.test.mjs`

Expected: FAIL because report modules do not exist.

- [ ] **Step 3: Implement common Markdown formatting**

```js
// lib/reports/markdown.mjs
export function escapeCell(value) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function code(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `\`${String(value).replace(/`/g, "\\`")}\``;
}

export function lineText(lineRange) {
  return lineRange ? `${lineRange[0]}-${lineRange[1]}` : "-";
}

export function signature(callable) {
  const parameters = callable.parameters.map((parameter) => parameter.type ? `${parameter.name}: ${parameter.type}` : parameter.name);
  return `${callable.name}(${parameters.join(", ")})`;
}

export function partialBanner(report) {
  return report.status === "partial"
    ? `> Warning: Partial analysis. ${report.parserFailures.length} supported file(s) failed to parse. See analysis-report.json.\n\n`
    : "";
}
```

- [ ] **Step 4: Implement all six renderers from in-memory index data**

`render.mjs` must not accept a target path or read source files. Render the exact columns from design section 10. Use relative Markdown links between report files in `summary.md`. In dependencies, group internal imports by source File path, then render separate `External dependencies` and `Unresolved imports` sections from report inputs. Do not include source snippets, parser stack traces, absolute paths, run duration, or environment data in Markdown.

- [ ] **Step 5: Run tests and commit**

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/reports.test.mjs`

Expected: all report cases PASS.

```bash
git add .github/skills/codebase-inspector/lib/reports .github/skills/codebase-inspector/tests/unit/reports.test.mjs .github/skills/codebase-inspector/tests/helpers/report-fixtures.mjs
git commit -m "feat: render canonical codebase reports"
```

### Task 15: Setup, Preflight, Locking, Output Modes, and Orchestration

**Files:**
- Create: `.github/skills/codebase-inspector/scripts/setup.mjs`
- Create: `.github/skills/codebase-inspector/lib/runtime/preflight.mjs`
- Create: `.github/skills/codebase-inspector/lib/output/git-exclude.mjs`
- Create: `.github/skills/codebase-inspector/lib/output/lock.mjs`
- Create: `.github/skills/codebase-inspector/lib/output/publisher.mjs`
- Create: `.github/skills/codebase-inspector/lib/orchestrator.mjs`
- Modify: `.github/skills/codebase-inspector/scripts/run.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/setup.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/preflight.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/git-exclude.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/lock.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/unit/publisher.test.mjs`

**Interfaces:**
- Consumes: CLI options, Skill path, target Git repository, completed artifact objects.
- Produces: `ensureRuntime`, `preflight`, `acquireLock`, `updateLocalExclude`, `publishOutputs`, and `runAnalysis` implementing the fixed processing flow.

- [ ] **Step 1: Write failing setup and preflight tests**

Inject `nodeVersion`, `platform`, and `runProcess` into `ensureRuntime` so unit tests do not install packages. Assert Node 21 fails before npm, a matching lockfile SHA-256 state plus valid `npm ls --omit=dev --silent` skips install, a missing/mismatched state or invalid dependency tree runs exactly `npm ci --omit=dev --no-audit --no-fund` with `cwd: skillDir`, successful installation writes a deterministic `.codebase-inspector-runtime.json`, and npm failure preserves the target untouched.

For `preflight`, create a fixture Git repo and assert it resolves the real Git root/Git dir, rejects non-Git input, rejects an output path outside the target root or inside the Git directory, verifies the output parent is writable, and produces:

```js
{
  skillDir,
  targetRoot,
  gitDir,
  outputPath,
  options: { tracked, output, keepIntermediate },
  git: { commitHash, commitTimestamp, dirty }
}
```

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/setup.test.mjs tests/unit/preflight.test.mjs`

Expected: FAIL because setup and preflight modules do not exist.

- [ ] **Step 2: Implement dependency-safe setup and Git preflight**

```js
// scripts/setup.mjs
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function defaultRunProcess(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: "inherit", shell: false });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export async function ensureRuntime({ skillDir, nodeVersion = process.versions.node, platform = process.platform, arch = process.arch, runProcess = defaultRunProcess }) {
  const nodeMajor = Number(nodeVersion.split(".")[0]);
  if (nodeMajor < 22) throw new Error(`Node.js 22 or newer is required; found ${nodeVersion}`);
  const npm = platform === "win32" ? "npm.cmd" : "npm";
  const lockSha256 = createHash("sha256").update(await readFile(join(skillDir, "package-lock.json"))).digest("hex");
  const statePath = join(skillDir, ".codebase-inspector-runtime.json");
  let state = null;
  try { state = JSON.parse(await readFile(statePath, "utf8")); } catch { state = null; }
  if (state?.lockSha256 === lockSha256 && state.nodeMajor === nodeMajor && state.platform === platform && state.arch === arch) {
    const valid = await runProcess(npm, ["ls", "--omit=dev", "--silent"], { cwd: skillDir });
    if (valid === 0) return { installed: false };
  }
  console.log("Codebase Inspector: installing locked Skill dependencies; npm access and dependency install scripts may run.");
  const installed = await runProcess(npm, ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: skillDir });
  if (installed !== 0) throw new Error("Skill dependency installation failed");
  const verified = await runProcess(npm, ["ls", "--omit=dev", "--silent"], { cwd: skillDir });
  if (verified !== 0) throw new Error("Installed Skill dependency tree is invalid");
  await writeFile(statePath, `${JSON.stringify({ arch, lockSha256, nodeMajor, platform }, null, 2)}\n`);
  return { installed: true };
}
```

`preflight.mjs` uses the Task 3 Git helpers, `realpath`, and `path.relative` boundary checks. Resolve `--output` relative to the target root, even when the process cwd differs. Forbid output `.` and every path under the real Git directory. Check write access on the nearest existing parent without creating the final output.

- [ ] **Step 3: Write failing lock, exclude, and atomic publication tests**

Test exact marked-block behavior:

```text
# BEGIN codebase-inspector:.code-understanding
/.code-understanding/
# END codebase-inspector:.code-understanding
```

Assert local mode adds one block, repeated local runs do not duplicate it, tracked mode removes only that exact block, a custom output gets its own normalized marker, and unrelated `.git/info/exclude` lines remain byte-identical.

For locking, assert `open(..., "wx")` creates one JSON lock, a live local PID causes a clear refusal, a dead PID permits stale-lock replacement, a malformed lock is not silently removed, and `release()` removes only a lock with the acquired random token.

For publication, start with a valid old output, force validation/write/rename failures through injected filesystem operations, and assert the old output remains unchanged. A successful publish must replace all old files, not merge stale files.

Run: `cd .github/skills/codebase-inspector && npm run test:unit -- tests/unit/git-exclude.test.mjs tests/unit/lock.test.mjs tests/unit/publisher.test.mjs`

Expected: FAIL because output modules do not exist.

- [ ] **Step 4: Implement exact exclude, lock, and publication protocols**

`git-exclude.mjs` normalizes an output relative path and renders the exact marker above. It reads/writes LF text and removes only a full exact begin/body/end block. It uses a temporary file next to `info/exclude` and rename for updates.

`lock.mjs` writes `{ pid, hostname, startedAt, token }` under `<gitDir>/codebase-inspector/analysis.lock`. `startedAt` is diagnostic lock metadata and is never copied into tracked output. Treat a lock as live only when hostname equals the local hostname and `process.kill(pid, 0)` succeeds or returns `EPERM`. A remote-host lock is live. A malformed lock requires manual removal and reports its path. Release compares token before unlinking.

`publisher.mjs` creates `<output>.tmp-<random-token>` and `<output>.backup-<random-token>` as siblings. It writes JSON through `stableStringify`, Markdown as LF text, and intermediates only when requested. It validates all three JSON objects before any final rename. Publication sequence is: remove stale same-token paths, rename current output to backup if present, rename temp to output, remove backup; on failure after backup rename, restore backup before rethrowing.

- [ ] **Step 5: Implement the fixed orchestrator**

```js
// lib/orchestrator.mjs
import { scanProject } from "./scanner/scan.mjs";
import { createParserRegistry } from "./parsers/registry.mjs";
import { resolveImports } from "./imports/resolve-imports.mjs";
import { normalizeSymbols } from "./symbols/normalize.mjs";
import { resolveCalls } from "./symbols/resolve-calls.mjs";
import { buildCodeGraph } from "./graph/build-graph.mjs";
import { renderReports } from "./reports/render.mjs";
import { parseAnalysisReport } from "./schema/analysis-report.mjs";
import { acquireLock } from "./output/lock.mjs";
import { updateLocalExclude } from "./output/git-exclude.mjs";
import { publishOutputs } from "./output/publisher.mjs";

export async function runAnalysis(runConfig) {
  const lock = await acquireLock(runConfig.gitDir);
  let registry;
  try {
    await updateLocalExclude(runConfig);
    const scan = await scanProject(runConfig);
    registry = await createParserRegistry(runConfig.skillDir);
    const raw = [];
    for (const file of scan.files) raw.push(await registry.analyzeFile(file));
    const imports = await resolveImports(scan, raw);
    const project = {
      name: runConfig.targetRoot.split(/[\\/]/).at(-1),
      root: runConfig.options.tracked ? null : runConfig.targetRoot,
      gitCommitHash: runConfig.git.commitHash,
      workingTreeDirty: runConfig.git.dirty,
      languages: [...new Set(scan.files.map((file) => file.language))].sort(),
      skillVersion: "0.1.0"
    };
    const normalized = normalizeSymbols(project, scan, raw, imports);
    let index = normalized.index;
    index = resolveCalls(index, raw);
    const graph = buildCodeGraph(index, runConfig.git);
    const parserFailures = [
      ...raw.filter((analysis) => analysis.warnings.length > 0).map((analysis) => ({ filePath: analysis.filePath, warnings: analysis.warnings })),
      ...normalized.warnings.map((warning) => ({ filePath: warning.filePath, warnings: [`${warning.code}: ${warning.message}`] }))
    ];
    const report = parseAnalysisReport({
      schemaVersion: "1.0.0", skillVersion: "0.1.0", status: parserFailures.length ? "partial" : "complete",
      coverage: index.coverage, warnings: [...scan.warnings, ...imports.warnings], parserFailures,
      unsupportedFiles: scan.unsupportedFiles.map((file) => file.path),
      relationships: { internalImports: index.imports.length, externalImports: imports.external.length, unresolvedImports: imports.unresolved.length, resolvedCalls: index.calls.length, unresolvedCalls: index.unresolvedCalls.length },
      options: runConfig.options
    });
    const markdown = renderReports(index, { ...report, externalImports: imports.external, unresolvedImports: imports.unresolved });
    const scanManifest = { ...scan, files: scan.files.map(({ content: _content, ...file }) => file) };
    const published = await publishOutputs(runConfig, { index, graph, report, markdown, intermediates: { scan: scanManifest, raw, imports } });
    return { status: report.status, outputPath: published.outputPath };
  } finally {
    await registry?.close();
    await lock.release();
  }
}
```

Adjust `analysis-report.mjs` so `options.output` is the normalized relative output value and `options.keepIntermediate` is allowed. Local-only absolute root remains only in `symbol-index.json.project.root`; tracked mode is null. Parser error messages are sanitized to file-relative message text without stack traces. Even with `--keep-intermediate`, the publisher may write only the sanitized scan manifest, strict RawFileAnalysis records, and import-resolution records; it must never persist `FileCandidate.content`.

- [ ] **Step 6: Run all unit tests and commit**

Run: `cd .github/skills/codebase-inspector && npm run test:unit`

Expected: every unit suite PASS.

```bash
git add .github/skills/codebase-inspector/scripts .github/skills/codebase-inspector/lib/runtime .github/skills/codebase-inspector/lib/output .github/skills/codebase-inspector/lib/orchestrator.mjs .github/skills/codebase-inspector/tests/unit
git commit -m "feat: orchestrate atomic codebase analysis"
```

### Task 16: Golden, Safety, Partial-Failure, and Determinism Integration Gates

**Files:**
- Create: `.github/skills/codebase-inspector/tests/helpers/block-network.cjs`
- Create: `.github/skills/codebase-inspector/tests/helpers/run-skill.mjs`
- Create: `.github/skills/codebase-inspector/tests/integration/copied-skill.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/integration/security.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/integration/output-modes.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/integration/partial-and-atomic.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/integration/determinism.test.mjs`
- Create: `.github/skills/codebase-inspector/tests/golden/mixed-project/package.json`
- Create: `.github/skills/codebase-inspector/tests/golden/mixed-project/tsconfig.json`
- Create: `.github/skills/codebase-inspector/tests/golden/mixed-project/go.mod`
- Create: `.github/skills/codebase-inspector/tests/golden/mixed-project/composer.json`
- Create: `.github/skills/codebase-inspector/tests/golden/mixed-project/pubspec.yaml`
- Create: `.github/skills/codebase-inspector/tests/golden/mixed-project/src/{javascript,typescript,python,rust,go,java,kotlin,c,cpp,csharp,php,ruby,dart,shell}/**`
- Create: `.github/skills/codebase-inspector/tests/golden/expected/{code-graph.json,symbol-index.json,analysis-report.json,summary.md,files.md,classes.md,methods.md,functions.md,dependencies.md}`

**Interfaces:**
- Consumes: the complete copied Skill directory and isolated Git target fixtures.
- Produces: release-blocking evidence for standalone execution, safety, partial output, output modes, complete golden files, and byte stability.

- [ ] **Step 1: Build one mixed-language golden fixture**

Create a small tracked project containing one file for every supported language, with internal imports across files only where that language supports it. Every Tree-sitter language fixture includes one literal call that resolves to a known same-file or imported symbol and one literal call that remains unresolved; the Shell fixture includes one known local function command and one unknown literal command. Add a malicious target `package.json` whose `preinstall`, `postinstall`, `test`, and `build` scripts each create a unique marker file; add an executable `analyze-me` script that creates a fifth marker. Commit with fixed author/committer identity and timestamp:

```bash
GIT_AUTHOR_DATE=2026-01-02T03:04:05Z GIT_COMMITTER_DATE=2026-01-02T03:04:05Z git commit -m "golden fixture"
```

- [ ] **Step 2: Implement the outbound-network blocker and failing security test**

```js
// tests/helpers/block-network.cjs
const net = require("node:net");
const tls = require("node:tls");
const http = require("node:http");
const https = require("node:https");
const deny = () => { throw new Error("Outbound network is disabled during Codebase Inspector analysis"); };
net.connect = deny;
net.createConnection = deny;
tls.connect = deny;
http.request = deny;
http.get = deny;
https.request = deny;
https.get = deny;
```

`security.test.mjs` first installs Skill dependencies normally, then invokes `scripts/run.mjs --tracked` in a child process with `NODE_OPTIONS=--require=<absolute block-network.cjs>`. Assert exit code 0, all nine outputs exist, none of the five target-script markers exist, no output contains fixture source-body sentinel `SOURCE_BODY_SECRET`, no output contains default literal `DEFAULT_SECRET`, and no output contains an absolute temporary path.

- [ ] **Step 3: Implement copied-Skill and output-mode tests**

Copy only `.github/skills/codebase-inspector/` to an isolated location that has no sibling Understand-Anything checkout, no repository-level source files, and no parent `node_modules`. Run `npm ci --omit=dev`, invoke its `scripts/run.mjs`, and assert success. Search copied production files and output for `@understand-anything`, `Understand-Anything`, and the local upstream path; only `NOTICE` provenance may contain the project name.

`output-modes.test.mjs` asserts default mode adds the exact local exclude block without touching tracked `.gitignore`; tracked mode removes only that block; custom output applies the matching block; `git status --short` shows all tracked-mode artifacts as ordinary untracked files.

- [ ] **Step 4: Implement partial and atomic failure tests**

Inject one extractor failure for a valid supported file. Assert output is published with `status: "partial"`, the File record remains with `parseStatus: "warning"`, every Markdown file starts with the partial warning, and other files retain full symbols.

Then seed a previous successful output, inject schema validation failure and Markdown rendering failure separately, and assert every previous output byte remains unchanged. Start two analyses against the same target and assert the second exits nonzero without changing the first process's temporary or final output.

- [ ] **Step 5: Generate and review golden outputs**

Implement `run-skill.mjs` with an explicit `UPDATE_GOLDEN=1` branch that copies only these generated files to `tests/golden/expected/`: `code-graph.json`, `symbol-index.json`, `analysis-report.json`, `summary.md`, `files.md`, `classes.md`, `methods.md`, `functions.md`, and `dependencies.md`. Normal test mode compares every byte and fails on extra or missing files.

Run:

```bash
cd .github/skills/codebase-inspector
UPDATE_GOLDEN=1 npm run test:integration -- tests/integration/copied-skill.test.mjs
git diff -- tests/golden/expected
npm run test:integration
```

Expected: generated golden files contain all language fixtures, reviewed diff contains no source bodies/default literals/absolute paths, and all integration suites PASS.

- [ ] **Step 6: Add repeated-run determinism and commit**

`determinism.test.mjs` runs tracked analysis twice against the unchanged committed fixture, hashes the relative filename and bytes of every output with SHA-256, and asserts identical maps. It then changes one working-tree source line without committing, runs again, and asserts the index content changes while `code-graph.json.project.analyzedAt` stays equal to the fixed commit timestamp.

Run: `cd .github/skills/codebase-inspector && npm run test:integration && npm test`

Expected: all unit, language, golden, integration, security, and determinism tests PASS.

```bash
git add .github/skills/codebase-inspector/tests
git commit -m "test: verify standalone deterministic analysis"
```

### Task 17: Copilot Skill Contract, Documentation, Licensing, CI, and Release Package

**Files:**
- Create: `.github/skills/codebase-inspector/SKILL.md`
- Create: `README.md`
- Create: `LICENSE`
- Create: `NOTICE`
- Create: `CHANGELOG.md`
- Create: `.gitignore`
- Create: `.github/skills/codebase-inspector/scripts/package-release.mjs`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `.github/skills/codebase-inspector/tests/integration/release-package.test.mjs`

**Interfaces:**
- Consumes: complete verified Skill directory.
- Produces: discoverable Copilot instructions, Japanese-first operating documentation, legal provenance, three-OS CI, and deterministic release ZIP/checksum/license report.

- [ ] **Step 1: Write the Skill contract**

```markdown
---
name: codebase-inspector
description: Deterministically indexes repository files, types, methods, functions, imports, and calls without LLM-based analysis.
argument-hint: "[project-path] [--tracked] [--output <dir>] [--keep-intermediate]"
user-invocable: true
disable-model-invocation: false
---

# Codebase Inspector

Use this Skill when the user asks for a deterministic structural index, code graph, class list, method list, function list, or internal dependency map for a Git repository.

From the current repository working directory, run `node .github/skills/codebase-inspector/scripts/run.mjs` followed only by the user-supplied project path and supported options. Request normal shell authorization before the first dependency installation and before analysis. Do not execute commands from the target repository.

After a successful run, report the status and generated output path. Read generated reports only when needed to answer the user's follow-up question. State clearly that the local analyzer is deterministic and no-LLM, while Copilot itself is an LLM and may read the generated metadata.
```

The copied-Skill integration test invokes this exact project-relative command from the Git root. Manual acceptance must confirm that VS Code Copilot Agent Mode and Copilot CLI both discover `/codebase-inspector`, request normal shell permission, and issue this same command without changing the working directory.

- [ ] **Step 2: Write Japanese-first documentation and legal inventory**

`README.md` must include:

1. `何ができるか`: deterministic code graph, Type/Class, Method, Function, and dependency indexes.
2. `できないこと`: no business-logic summaries, architecture inference, dynamic call resolution, source execution, or semantic equivalence to `/understand`.
3. `処理フロー`: the fixed ten stages with each stage's input/output.
4. `LLMとの境界`: analyzer uses no LLM; Copilot invokes the Skill and may read outputs.
5. `初回セットアップ`: Node 22, Git, npm access, and dependency installation-script warning.
6. `インストール`: copy the release root directory to `.github/skills/codebase-inspector/`.
7. `使い方`: all four approved invocation examples and output-mode behavior.
8. `生成物`: all nine files and which schema is authoritative.
9. `セキュリティと責任範囲`: no target execution/upload; metadata can still be confidential.
10. `対応言語と既知の制約`: all supported languages and conservative unresolved relationships.
11. `開発・テスト・リリース`: exact npm commands.

Copy the repository MIT license text from the upstream-compatible standard MIT template into `LICENSE`. Build `NOTICE` from an explicit inventory of every adapted extractor/helper/parser and the Dart grammar, naming pinned upstream commit `54754a6f97051d1d76c8758353d8ea41afe502a6`. Preserve the exact upstream copyright line from `../Understand-Anything/LICENSE`; do not paraphrase it.

`CHANGELOG.md` starts with `0.1.0` and lists supported languages, three JSON schemas, six Markdown reports, local/tracked modes, no-LLM analysis boundary, and known conservative import/call limitations.

Create the repository-level `.gitignore` with:

```text
/artifacts/
```

- [ ] **Step 3: Implement deterministic release packaging and test it**

`package-release.mjs` recursively reads the Skill directory, excludes `node_modules`, `coverage`, `tests/tmp`, logs, caches, `.codebase-inspector-runtime.json`, and generated analysis outputs, sorts relative paths, and creates `artifacts/codebase-inspector-<version>.zip` with root `codebase-inspector/`. Set every ZIP entry timestamp to `1980-01-01T00:00:00Z`, write `artifacts/codebase-inspector-<version>.zip.sha256`, and generate `artifacts/dependency-licenses.json` using the locally installed license checker. Normalize the license report to sorted records containing only package name/version, license expression, repository URL, publisher, and declared license file; remove dependency installation paths and machine-specific fields.

`release-package.test.mjs` opens the ZIP with `adm-zip` and asserts:

- root is exactly `codebase-inspector/`;
- `SKILL.md`, `package.json`, `package-lock.json`, scripts, lib, vendor, and tests are present;
- `node_modules`, absolute paths, caches, `.code-understanding`, and repository-level docs are absent;
- extracted directory passes `npm ci --omit=dev` and the copied-Skill integration smoke test;
- two packaging runs produce the same SHA-256.

Run: `cd .github/skills/codebase-inspector && npm run release:zip && npm run test:integration -- tests/integration/release-package.test.mjs`

Expected: release test PASS and ZIP/checksum/license report exist under repository `artifacts/`.

- [ ] **Step 4: Add cross-platform CI and tagged release workflow**

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    defaults:
      run:
        working-directory: .github/skills/codebase-inspector
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: .github/skills/codebase-inspector/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run release:zip
      - run: npm run test:integration -- tests/integration/release-package.test.mjs
```

`release.yml` triggers on `v*` tags, repeats the Ubuntu Node 22 verification, runs `npm run release:zip`, and creates the GitHub Release with the preinstalled GitHub CLI rather than an unpinned third-party action:

```yaml
permissions:
  contents: write
steps:
  - name: Publish release artifacts
    env:
      GH_TOKEN: ${{ github.token }}
    run: gh release create "$GITHUB_REF_NAME" artifacts/codebase-inspector-*.zip artifacts/codebase-inspector-*.zip.sha256 artifacts/dependency-licenses.json --verify-tag --generate-notes
```

- [ ] **Step 5: Run the complete release gate**

Run:

```bash
cd .github/skills/codebase-inspector
npm ci
npm run lint
npm test
npm run release:zip
npm run test:integration -- tests/integration/release-package.test.mjs
cd ../../../..
git status --short
```

Expected: lint and all tests PASS; release packaging PASS; `git status` shows only intentional source/doc/workflow changes plus ignored local `node_modules` and `artifacts` policy as documented.

- [ ] **Step 6: Commit the release-ready Skill**

```bash
git add README.md LICENSE NOTICE CHANGELOG.md .gitignore .github
git commit -m "docs: package codebase inspector skill"
```

## Final Verification Checklist

- [ ] Run `rg -n "FIXME|XXX|placeholder" .github/skills/codebase-inspector README.md NOTICE CHANGELOG.md` and resolve every match that is not source text inside a parser fixture.
- [ ] Run `rg -n "@understand-anything|workspace:\*|Documents/code-understanding-demo|/Users/|[A-Z]:\\\\" .github/skills/codebase-inspector --glob '!NOTICE'` and require no production or generated-output matches.
- [ ] Run `find .github/skills/codebase-inspector -type f -print0 | sort -z | xargs -0 file` and inspect unexpected binaries; only the documented Dart WASM is an intentional binary.
- [ ] Run `cd .github/skills/codebase-inspector && npm run lint && npm test && npm run release:zip` and require zero failures.
- [ ] Extract the release ZIP into a temporary directory with no adjacent checkout, run `npm ci --omit=dev`, and execute its documented command against the mixed fixture.
- [ ] Run tracked analysis twice, compare `sha256` for all nine outputs, and require byte identity.
- [ ] Inspect `symbol-index.json` to confirm methods are not duplicated in `functions[]`, every Method owner exists, and unavailable fields are null.
- [ ] Inspect `code-graph.json` to confirm the compatible outer shape, Git commit timestamp, empty `layers`/`tour`, and no LLM-derived summaries.
- [ ] Inspect all generated files for source bodies, default-value sentinels, absolute paths, wall-clock times, durations, process IDs, temporary paths, and environment data.
- [ ] Confirm default mode changes only the exact `.git/info/exclude` block and tracked mode removes only that block.
- [ ] Confirm the target fixture's install/build/test/executable marker files were never created.
- [ ] Confirm three-OS Node 22 CI passes before tagging `v0.1.0`.
