# Codebase Inspector Design

Date: 2026-07-22  
Status: Approved for implementation planning

## 1. Purpose

Codebase Inspector is a project-scoped GitHub Copilot Skill that generates a deterministic structural index of a repository without using an LLM for analysis.

The Skill is intended for teams that want Copilot-readable code structure while keeping the analysis engine local, reproducible, and auditable. It derives its static-analysis approach from the MIT-licensed Egonex-AI/Understand-Anything project, but it is distributed and executed as an independent Skill.

Copilot remains responsible for selecting and invoking the Skill. After invocation, file scanning, AST parsing, symbol normalization, graph construction, and report generation are performed by local Node.js code only.

## 2. Goals

- Install as one project Skill under `.github/skills/codebase-inspector/`.
- Work in VS Code Copilot Agent Mode and GitHub Copilot CLI.
- Require only Git, Node.js 22 or newer, and an initial dependency installation.
- Avoid runtime references to Understand-Anything, other Skills, agents, MCP servers, or LLM APIs.
- Support all code languages covered by the selected Understand-Anything extractors.
- Generate a KnowledgeGraph-compatible code graph.
- Generate a richer symbol index with first-class Type, Method, Function, and Property data.
- Generate stable Markdown indexes that Copilot and developers can read directly.
- Never execute code, build scripts, tests, or package scripts from the target repository.
- Support local-only output by default and deterministic, commit-ready output on request.
- Preserve useful partial results while making coverage limitations explicit.

## 3. Non-goals

- Natural-language summaries of business logic.
- Architecture-layer inference.
- Guided tours, domain graphs, business flows, chat, or review agents.
- Runtime tracing, dynamic dispatch resolution, or reflection analysis.
- Complete semantic equivalence with the LLM-backed `/understand` command.
- An HTML dashboard or web server in the first release.
- GitHub Cloud Coding Agent or Copilot Code Review compatibility guarantees in the first release.
- Executing language servers or target-repository build tools.
- Indexing external package internals.

## 4. Product Identity

| Item | Value |
|---|---|
| Repository | `codebase-inspector` |
| Skill name | `codebase-inspector` |
| Invocation | `/codebase-inspector [project-path]` |
| Default output | `.code-understanding/` |
| Initial schema version | `1.0.0` |
| Initial package version | `0.1.0` |

## 5. Repository Architecture

```text
codebase-inspector/
├── README.md
├── LICENSE
├── NOTICE
├── .github/
│   ├── workflows/
│   │   └── ci.yml
│   └── skills/
│       └── codebase-inspector/
│           ├── SKILL.md
│           ├── package.json
│           ├── package-lock.json
│           ├── .gitignore
│           ├── scripts/
│           │   ├── run.mjs
│           │   └── setup.mjs
│           ├── lib/
│           │   ├── scanner/
│           │   ├── imports/
│           │   ├── extractors/
│           │   ├── languages/
│           │   ├── graph/
│           │   ├── reports/
│           │   └── schema/
│           ├── vendor/
│           │   └── tree-sitter-dart/
│           ├── templates/
│           └── tests/
└── docs/
    └── superpowers/
        └── specs/
```

`.github/skills/codebase-inspector/` is the complete distributable unit. Copying this directory into another repository must be sufficient to install the Skill.

The source repository stores tests inside the Skill directory so the released directory remains independently auditable and testable. Repository-level files provide documentation, licensing, and CI only.

Production modules are executable JavaScript ES modules. Installing or running the Skill does not require a TypeScript compilation step, a repository-level build, or generated `dist/` files.

## 6. Component Boundaries

### 6.1 `SKILL.md`

Defines when Copilot should use the Skill and how to invoke `scripts/run.mjs`. It does not contain analysis logic.

Required frontmatter:

```yaml
name: codebase-inspector
description: Deterministically indexes repository files, types, methods, functions, imports, and calls without LLM-based analysis.
argument-hint: "[project-path] [--tracked] [--output <dir>] [--keep-intermediate]"
user-invocable: true
disable-model-invocation: false
```

The Skill will not pre-approve `shell` through `allowed-tools`. Copilot must request normal user authorization before installing dependencies or running the analyzer.

### 6.2 `scripts/setup.mjs`

Owns runtime preflight and dependency setup:

- Resolve the real Skill directory from `import.meta.url`.
- Require Node.js 22 or newer.
- Detect the platform-specific npm executable.
- Check whether the installed dependency tree matches the lockfile state.
- Run `npm ci` in the Skill directory when dependencies are missing or invalid.
- Never read or install the target repository's package manifest.

### 6.3 `scripts/run.mjs`

The single analysis entry point. It parses arguments, acquires the analysis lock, orchestrates each component, validates outputs, and atomically publishes results.

### 6.4 Scanner

The scanner:

- Resolves the target Git working-tree root.
- Enumerates Git-tracked files.
- Applies built-in exclusions and `.codeinspectorignore`.
- Does not follow symlinks outside the target root.
- Detects language, file category, byte size, and normalized line count.
- Reads working-tree file contents rather than historical Git blob contents.

The target must be a Git working tree. A non-Git directory is a fatal preflight error in the first release.

### 6.5 Import Resolver

Resolves project-internal imports for supported languages. It handles language-specific module rules such as TypeScript path aliases, Python packages, Go modules, Rust modules, Java/Kotlin packages, C/C++ includes, PHP Composer mappings, Ruby requires, and Dart imports.

External packages may be reported as unresolved external dependencies but do not receive File nodes.

### 6.6 Extractor Registry

Selects a Tree-sitter-backed extractor by language and emits language-neutral structural records. The first release supports:

- JavaScript and TypeScript
- Python
- Rust
- Go
- Java and Kotlin
- C#
- C and C++
- PHP
- Ruby
- Dart
- Shell

The copied and adapted extractor code retains applicable upstream copyright and license notices.

Understand-Anything's Dart grammar is a workspace package and therefore cannot remain a `workspace:*` dependency. Codebase Inspector vendors the required Dart WASM grammar and loader under `vendor/tree-sitter-dart/`, with its license information in `NOTICE`. No runtime import may resolve back to an Understand-Anything workspace package.

### 6.7 Symbol Normalizer

Converts extractor output into the canonical Symbol Index schema. It creates stable IDs, resolves ownership, separates methods from free functions, normalizes optional modifiers, and sorts all collections deterministically.

### 6.8 Graph Builder

Projects the richer Symbol Index into a KnowledgeGraph-compatible representation containing File, Class, and Function nodes plus Contains, Imports, and Calls edges.

### 6.9 Report Writer

Generates all Markdown reports from `symbol-index.json` data in memory. It never reparses source files, ensuring the JSON and Markdown views use the same facts.

## 7. Canonical Symbol Model

The canonical `symbol-index.json` has this top-level shape:

```text
schemaVersion
project
files[]
types[]
methods[]
functions[]
imports[]
calls[]
unresolvedCalls[]
coverage
```

### 7.1 Project Record

```text
name
root: null in tracked output; absolute path allowed only in local diagnostic output
gitCommitHash
workingTreeDirty
languages[]
skillVersion
```

No timestamp is stored in commit-ready output.

### 7.2 File Record

```text
id
path
language
category
lineCount
parseStatus: parsed | unsupported | warning
typeIds[]
methodIds[]
functionIds[]
```

### 7.3 Type Record

```text
id
kind: class | interface | struct | enum | trait | module
name
filePath
lineRange
propertyIds[]
methodIds[]
extends[]
implements[]
exported: boolean | null
```

`classes.md` contains every Type record and uses a `Kind` column to distinguish the declarations.

### 7.4 Method Record

```text
id
name
ownerTypeId
filePath
lineRange
parameters[]
returnType: string | null
visibility: public | protected | private | internal | package | null
static: boolean | null
async: boolean | null
exported: boolean | null
```

Each parameter contains only its name and statically available type. Default-value literals are not preserved.

### 7.5 Function Record

Uses the Method fields except `ownerTypeId`, `static`, and class-oriented visibility. A Function is a free or module-level callable. Methods are not duplicated in `functions[]`.

### 7.6 Property Record

Properties are embedded in their owning Type in the first schema version:

```text
name
type: string | null
visibility: public | protected | private | internal | package | null
static: boolean | null
lineRange: [start, end] | null
```

There is no separate `properties.md` in the first release. Property counts and names appear in `classes.md`.

### 7.7 Import and Call Records

Internal imports contain source and target File IDs. Calls contain caller and callee symbol IDs only when both sides resolve unambiguously.

Unresolved calls record the caller when known, the textual callee name, file path, line number, and a reason code. They are counted in reports but are not emitted as graph edges.

## 8. Stable Identity and Ordering

Stable IDs include source location to distinguish overloads and repeated names:

```text
file:<normalized-path>
type:<normalized-path>:<kind>:<name>:<start-line>
method:<normalized-path>:<owner-name>:<name>:<start-line>
function:<normalized-path>:<name>:<start-line>
```

Paths always use `/`, regardless of operating system. Text decoding and line endings are normalized before parsing. Arrays are sorted by normalized path, start line, kind, and name as applicable.

For identical tracked file contents, ignore configuration, Skill version, dependency lockfile, and CLI options, `--tracked` output must be byte-for-byte identical across repeated runs and supported operating systems.

## 9. KnowledgeGraph Compatibility

`code-graph.json` retains the Understand-Anything KnowledgeGraph outer shape:

```text
version
kind: codebase
project
nodes[]
edges[]
layers: []
tour: []
```

The compatible `project` object includes the required name, languages, frameworks, description, `gitCommitHash`, and `analyzedAt` fields. To keep tracked output deterministic, `analyzedAt` is the timestamp of the analyzed Git commit rather than the wall-clock analysis time. `frameworks` is an empty array because framework inference is outside the first-release scope.

Projection rules:

- File Record becomes a `file` node.
- Type Record becomes a `class` node, with its actual kind retained in tags.
- Method Record becomes a `function` node tagged with `method` and `owner:<type-id>`.
- Function Record becomes a `function` node tagged with `function`.
- File-to-Type, File-to-Function, and Type-to-Method relationships become `contains` edges.
- Resolved internal imports become `imports` edges.
- Resolved call records become `calls` edges.
- `layers` and `tour` remain empty.

Rich method fields are authoritative in `symbol-index.json`; tags in `code-graph.json` are a compatibility projection, not a second source of truth.

## 10. Generated Outputs

```text
.code-understanding/
├── code-graph.json
├── symbol-index.json
├── analysis-report.json
├── summary.md
├── files.md
├── classes.md
├── methods.md
├── functions.md
└── dependencies.md
```

### 10.1 `summary.md`

Contains project identity, commit, dirty-state indicator, language counts, parse coverage, symbol counts, relationship counts, and links to the remaining reports.

### 10.2 `files.md`

Columns: Path, Language, Category, Lines, Types, Methods, Functions, Parse Status.

### 10.3 `classes.md`

Columns: Kind, Name, File, Lines, Properties, Methods, Extends, Implements.

### 10.4 `methods.md`

Columns: Owner, Method, Signature, Return Type, Visibility, Static, Async, File, Lines.

### 10.5 `functions.md`

Columns: Function, Signature, Return Type, Visibility, Async, Exported, File, Lines.

### 10.6 `dependencies.md`

Contains resolved repository-internal file import relationships grouped by source file. External packages and unresolved imports appear in a separate clearly labeled section when detected.

### 10.7 `analysis-report.json`

Contains status, coverage, warnings, parser failures, unsupported files, resolved/unresolved relationship counts, schema versions, Skill version, and the exact non-sensitive options used for the run.

## 11. Invocation and Options

```text
/codebase-inspector
/codebase-inspector ../target-repository
/codebase-inspector --tracked
/codebase-inspector --output .analysis
```

Supported first-release options:

| Option | Meaning |
|---|---|
| `[project-path]` | Git working tree to analyze; defaults to the current Git root |
| `--tracked` | Produce commit-ready deterministic output |
| `--output <dir>` | Override the output directory |
| `--keep-intermediate` | Preserve scan and extraction intermediates for diagnosis |

No language-selection flag is required. The analyzer detects every supported language automatically.

## 12. Runtime Setup

The Skill requires Node.js 22 or newer. It does not bundle Node.js or `node_modules`.

On invocation:

1. `setup.mjs` checks the Node version.
2. It validates the installed dependency state against the Skill package and lockfile.
3. If dependencies are missing or invalid, Copilot requests normal shell permission.
4. The setup executes `npm ci` with the Skill directory as its prefix.
5. The analyzer starts only after setup succeeds.

Dependencies are installed under the Skill directory and ignored by the nested `.gitignore`. Setup does not run npm against the target repository.

The lockfile pins versions and integrity hashes. Some Tree-sitter native packages may execute their own installation scripts; the Skill documents this before first use.

After setup, the analysis path does not require network access.

## 13. Processing Flow

```text
Preflight
  -> Runtime setup
  -> File scan
  -> AST extraction
  -> Import resolution
  -> Symbol normalization
  -> Call resolution
  -> Graph construction
  -> Schema validation
  -> Markdown rendering
  -> Atomic publication
```

Inputs and outputs by stage:

| Stage | Input | Output |
|---|---|---|
| Preflight | CLI args, Skill path, target path | Validated run configuration |
| Runtime setup | package and lockfile | Ready dependency tree |
| File scan | Git working tree, ignore rules | File records and content handles |
| AST extraction | Supported source files | Language-specific symbols and calls |
| Import resolution | Files, imports, language configs | Internal and unresolved imports |
| Symbol normalization | Extractor output | Canonical Symbol Index |
| Call resolution | Symbol Index, call candidates, imports | Resolved and unresolved calls |
| Graph construction | Symbol Index | KnowledgeGraph projection |
| Validation | JSON objects | Validated output or fatal errors |
| Markdown rendering | Symbol Index and report | Six Markdown reports |
| Atomic publication | Complete temporary output | Final output directory |

## 14. Local and Tracked Modes

### 14.1 Default local mode

- Writes to `.code-understanding/` by default.
- Adds a tool-owned marked block for the output directory to `.git/info/exclude`.
- Does not modify the repository's tracked `.gitignore`.
- May include local-only diagnostic fields such as duration and absolute target path in `analysis-report.json`.

### 14.2 `--tracked` mode

- Removes only the exact `.git/info/exclude` block previously created by Codebase Inspector for the selected output directory.
- Omits timestamps, durations, absolute machine paths, temporary paths, and environment-specific diagnostics.
- Uses the analyzed Git commit timestamp only where the compatibility schema requires `analyzedAt`; it never uses the current run time.
- Uses stable ordering and normalized line endings.
- Produces files suitable for ordinary `git add` without force.

The tool never removes unrelated ignore entries.

## 15. Atomicity and Concurrency

The lock resides under the target repository's `.git/codebase-inspector/` directory and includes process metadata. A live lock causes a clear, non-destructive exit. A stale lock is removed only after confirming its process is no longer active on the local machine.

Outputs are built in a temporary sibling directory. Publication occurs only after JSON schema validation and Markdown generation complete. Replacement uses a backup-and-rename sequence compatible with Windows, macOS, and Linux.

Fatal failure preserves the previous successful output. Temporary data is deleted unless `--keep-intermediate` is set.

## 16. Security and Privacy

### 16.1 Analyzer behavior

- No LLM or external AI API calls.
- No source-code upload.
- No network access during analysis.
- No target application, test, build, package, shell, or binary execution.
- No language-server startup.
- No traversal through symlinks outside the target root.
- No source bodies in generated outputs.
- No parameter default-value literals in generated outputs.

### 16.2 Copilot boundary

Copilot uses an LLM to select the Skill and may read generated reports when answering the user. This does not make the analysis engine LLM-based. The analyzer writes only status, counts, warning summaries, and output paths to standard output; it does not print source bodies.

### 16.3 Dependency boundary

The first dependency installation accesses npm and may run locked dependency installation scripts required by native Tree-sitter packages. This is the only designed network-dependent stage. The README and first-run output must state this clearly.

### 16.4 Generated-data responsibility

Generated files contain repository paths, identifier names, signatures, types, and relationships. Users must treat these outputs as potentially confidential project metadata even though source bodies are absent.

## 17. Error Handling

| Condition | Classification | Behavior |
|---|---|---|
| Node version is unsupported | Fatal | Stop before analysis |
| Dependency installation fails | Fatal | Stop and preserve old output |
| Target is not a Git working tree | Fatal | Stop with path guidance |
| Output is not writable | Fatal | Stop before temporary output creation |
| Unsupported file type | Coverage event | Record as unsupported and continue |
| One parser fails | Partial | Preserve File record, record warning, continue |
| Call target is ambiguous or missing | Expected unresolved relation | Count and continue |
| JSON schema validation fails | Fatal | Do not publish |
| Markdown generation fails | Fatal | Do not publish |
| Another process owns the lock | Fatal and non-destructive | Report lock owner and exit |

`analysis-report.json` uses `status: "complete"` when every supported file parsed successfully and `status: "partial"` when recoverable parser failures occurred. Unsupported file types alone do not make a run partial.

Partial output may be published when both JSON schemas remain valid. Every generated Markdown file displays a coverage warning when the status is partial.

## 18. Testing Strategy

### 18.1 Unit tests

Cover scanner behavior, ignore matching, language detection, import resolution, symbol ownership, method/function separation, stable IDs, call resolution, graph projection, schema validation, report rendering, locking, and atomic replacement.

### 18.2 Language fixtures

Each supported language has fixtures covering the declarations it can express:

- Type declarations such as class, interface, struct, enum, trait, or module.
- Methods and free functions.
- Parameters and return types.
- Properties or fields.
- Visibility, static, async, and export modifiers where applicable.
- Internal imports.
- Resolvable and unresolvable calls.

### 18.3 Golden tests

Golden fixtures compare full generated content for:

- `code-graph.json`
- `symbol-index.json`
- `classes.md`
- `methods.md`
- `functions.md`
- `dependencies.md`

Output-contract changes require explicit golden updates.

### 18.4 Integration tests

- Execute from only the copied Skill directory.
- Confirm no Understand-Anything path or adjacent Skill is available.
- Exercise first-run setup in an isolated fixture.
- Verify partial parser behavior.
- Verify fatal validation preserves previous output.
- Verify default and tracked ignore behavior.
- Verify symlink escape prevention.
- Verify target scripts and binaries are never executed.
- Block outbound sockets during the analysis phase and verify the run still succeeds.
- Run tracked analysis twice and compare all bytes.

### 18.5 Cross-platform CI

The GitHub Actions matrix contains:

```text
ubuntu-latest  / Node.js 22
windows-latest / Node.js 22
macos-latest   / Node.js 22
```

Every pull request runs dependency installation, lint, unit tests, language fixtures, golden tests, integration tests, and determinism tests.

## 19. Distribution and Release

Each release provides:

- A tagged source release.
- A ZIP whose root is `codebase-inspector/` and whose content is the complete Skill directory.
- A SHA-256 checksum.
- Installation instructions for copying the directory to `.github/skills/codebase-inspector/`.
- A changelog describing schema or parser changes.

The ZIP excludes `node_modules`, caches, temporary outputs, and repository-level development files.

The Skill can later be published through GitHub's Agent Skill tooling, but the first release does not depend on preview installation commands. Copying the directory remains the baseline installation method.

## 20. Licensing

The repository uses the MIT License. `NOTICE` identifies adapted Understand-Anything files and preserves upstream copyright notices.

Every substantially adapted upstream source file retains a concise origin header. The implementation inventory must distinguish:

- copied and modified upstream files;
- newly written Codebase Inspector files;
- third-party npm dependencies governed by their own licenses.

Release automation includes a dependency-license report.

## 21. Acceptance Criteria

The first release is complete when all of the following hold:

1. Copying one directory installs the Project Skill.
2. VS Code Copilot Agent Mode and Copilot CLI discover `/codebase-inspector`.
3. First-run setup installs only the Skill's locked dependencies.
4. Analysis performs no LLM call and no target-code execution.
5. Every listed language produces the canonical Symbol Model from its fixture.
6. Methods include owner, location, parameters, return type, and available modifiers.
7. `code-graph.json` validates against the compatible KnowledgeGraph schema.
8. `symbol-index.json` validates against the Codebase Inspector schema.
9. All specified Markdown reports are generated from the Symbol Index.
10. Default output is locally excluded without changing tracked `.gitignore`.
11. `--tracked` output is byte-stable for identical input and configuration.
12. Fatal errors preserve the previous successful output.
13. Partial coverage is explicit in JSON and Markdown.
14. Windows, macOS, and Linux CI pass on Node.js 22.
15. The release ZIP contains no dependency installation or machine-specific files.

## 22. References

- Understand-Anything: https://github.com/Egonex-AI/Understand-Anything
- GitHub Agent Skills overview: https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
- Adding Agent Skills: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills
- GitHub Copilot CLI Skill reference: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#skills-reference
