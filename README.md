# Codebase Inspector

Codebase Inspector is a standalone GitHub Copilot Skill that deterministically indexes repository files, types, methods, functions, imports, and conservative static calls. Its analyzer uses no LLM or remote AI service.

The distributable runtime is [`.github/skills/codebase-inspector`](.github/skills/codebase-inspector). Copy that directory into another Git repository, then invoke `/codebase-inspector [project-path] [--tracked] [--output <dir>] [--keep-intermediate]` after normal shell authorization.

The Skill requires Node.js 22 or newer and Git. It emits `code-graph.json`, `symbol-index.json`, `classes.md`, `methods.md`, `functions.md`, and `analysis-report.json`. See the Skill's [Japanese documentation](.github/skills/codebase-inspector/README.ja.md) for installation, operating boundaries, supported languages, and known upstream limitations.

This project is MIT licensed. Vendored Understand-Anything extractor provenance and third-party notices are recorded in [NOTICE](NOTICE).
