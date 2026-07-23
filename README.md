# Codebase Inspector

Codebase Inspector is a standalone GitHub Copilot Skill that deterministically indexes repository files, types, properties, methods, functions, imports, calls, and type relationships. It also renders Japanese class definitions and Mermaid class diagrams from a saved snapshot without reparsing source. Its analyzer uses no LLM or remote AI service.

The distributable runtime is [`.github/skills/codebase-inspector`](.github/skills/codebase-inspector). Copy that directory into another Git repository, then invoke `/codebase-inspector analyze` or `/codebase-inspector render` after normal shell authorization.

The Skill requires Node.js 22 or newer and Git. Analysis emits `code-graph.json`, `symbol-index.json`, `classes.md`, `methods.md`, `functions.md`, and `analysis-report.json`. Rendering emits `クラス定義書.md`, `クラス図.md`, and `structure-render-report.json`. See the Skill's [Japanese documentation](.github/skills/codebase-inspector/README.ja.md) for filters, installation, operating boundaries, supported languages, and known upstream limitations.

`analyze` scans only Git-tracked files. By default it adds only a Codebase Inspector-owned analysis-output block to `.git/info/exclude`; `--tracked` leaves no owned block. `--keep-intermediate` is recorded but emits no extra file. `render` reads only the saved snapshot and does not scan source or modify Git configuration.

This project is MIT licensed. Vendored Understand-Anything extractor provenance and third-party notices are recorded in [NOTICE](NOTICE).
