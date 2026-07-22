import { fileURLToPath, URL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createParserRegistry } from "../../lib/parsers/registry.mjs";
import { parseRawFileAnalysis } from "../../lib/schema/raw-analysis.mjs";

const skillDir = fileURLToPath(new URL("../..", import.meta.url));
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
  ["dart", "a.dart", "class A { void run() {} }"]
];

let registry;

beforeAll(async () => {
  registry = await createParserRegistry(skillDir);
});

afterAll(async () => {
  await registry.close();
});

describe("upstream extractor snapshot", () => {
  test("registers exactly the supported language set", () => {
    expect([...registry.languages].sort()).toEqual(cases.map(([language]) => language).sort());
  });

  test.each(cases)("analyzes representative %s source", async (language, path, content) => {
    const result = await registry.analyzeFile({ path, language, content });

    expect(() => parseRawFileAnalysis(result)).not.toThrow();
    expect(result.types.length + result.functions.length).toBeGreaterThan(0);
    expect(result.warnings).not.toContain(`No extractor is registered for ${language}`);
  });
});
