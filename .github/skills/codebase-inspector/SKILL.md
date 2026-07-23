---
name: codebase-inspector
description: Deterministically indexes repository files, types, properties, callables, imports, calls, and type relations, then renders Japanese structure documents without LLM-based analysis.
argument-hint: "[analyze [project-path] | render] [options]"
user-invocable: true
disable-model-invocation: false
---

# Codebase Inspector

After normal shell authorization, run the command from the target repository root. Pass the Copilot argument text through the explicit internal transport so the script can tokenize it without shell execution:

```bash
node .github/skills/codebase-inspector/scripts/run.mjs --skill-arguments "$ARGUMENTS"
```

`analyze` is optional and preserves the original invocation. `render` reads an
existing `.code-understanding/symbol-index.json` snapshot and deterministically
writes `クラス定義書.md`, `クラス図.md`, and
`structure-render-report.json` without reparsing source files.

Argument quoting is non-executing. A terminal `\"` in a double-quoted token preserves the backslash and closes the token; for example, `"C:\Program Files\repo\"`. For a literal embedded double quote, use `\"` before more token content; use `\""` at the token end, where the final quote separately closes the token (for example, `"C:\work\name\""`). A literal double quote immediately before whitespace in the same token requires single quotes around the payload token; for example, `'C:\Program Files\name" next'`.

The script performs no LLM, AI API, MCP, language-server, build, test, package-script, or target-executable invocation. Its generated artifacts contain deterministic syntax-level facts and conservative static relationships; they are not business understanding, architecture narratives, or semantic analysis.
