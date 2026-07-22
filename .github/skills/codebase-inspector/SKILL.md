---
name: codebase-inspector
description: Deterministically indexes repository files, classes, methods, functions, imports, and calls without LLM-based analysis.
argument-hint: "[project-path] [--tracked] [--output <dir>] [--keep-intermediate]"
user-invocable: true
disable-model-invocation: false
---

# Codebase Inspector

After normal shell authorization, run the analyzer from the target repository root. Pass the Copilot argument text through the explicit internal transport so the script can tokenize it without shell execution:

```bash
node .github/skills/codebase-inspector/scripts/run.mjs --skill-arguments "$ARGUMENTS"
```

Argument quoting is non-executing. A terminal `\"` in a double-quoted token preserves the backslash and closes the token; for example, `"C:\Program Files\repo\"`. For a literal embedded double quote, use `\"` before more token content; use `\""` at the token end, where the final quote separately closes the token (for example, `"C:\work\name\""`).

The script performs no LLM, AI API, MCP, language-server, build, test, package-script, or target-executable invocation. Its generated artifacts contain deterministic syntax-level facts and conservative static relationships; they are not business understanding, architecture narratives, or semantic analysis.
