import { expect, test } from "vitest";
import { buildImportMap } from "../../lib/imports/build-import-map.mjs";

function file(path, language, content = "") {
  return { path, language, category: "source", content };
}

function analysis(filePath, language, imports) {
  return {
    filePath,
    language,
    importCandidates: imports.map(({ source, specifiers = [] }) => ({
      source,
      specifiers,
      kind: "module",
      lineNumber: 1
    }))
  };
}

test("resolves Python package imports with the Understand-Anything rules", async () => {
  const files = [
    file("app/main.py", "python", "from app.services import worker\n"),
    file("app/__init__.py", "python"),
    file("app/services/__init__.py", "python"),
    file("app/services/worker.py", "python")
  ];
  const analyses = [analysis("app/main.py", "python", [
    { source: "app.services", specifiers: ["worker"] }
  ])];

  expect(await buildImportMap({ projectRoot: "/unused", files, analyses })).toEqual({
    "app/__init__.py": [],
    "app/main.py": ["app/services/__init__.py", "app/services/worker.py"],
    "app/services/__init__.py": [],
    "app/services/worker.py": []
  });
});

test("resolves Rust crate imports and mod declarations with the Understand-Anything rules", async () => {
  const files = [
    file("crate/src/main.rs", "rust", "mod config;\nuse crate::service::run;\n"),
    file("crate/src/config.rs", "rust"),
    file("crate/src/service.rs", "rust")
  ];
  const analyses = [analysis("crate/src/main.rs", "rust", [
    { source: "crate::service::run" }
  ])];

  expect(await buildImportMap({ projectRoot: "/unused", files, analyses })).toEqual({
    "crate/src/config.rs": [],
    "crate/src/main.rs": ["crate/src/config.rs", "crate/src/service.rs"],
    "crate/src/service.rs": []
  });
});

test("does not emit a self-import edge", async () => {
  const files = [file("src/task.py", "python", "import task\n")];
  const analyses = [analysis("src/task.py", "python", [{ source: "task", specifiers: ["task"] }])];

  expect(await buildImportMap({ projectRoot: "/unused", files, analyses })).toEqual({
    "src/task.py": []
  });
});
