import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseArgs } from "../../lib/cli/args.mjs";
import { main } from "../../scripts/run.mjs";

async function invoke(argv, cwd = resolve("fixture repository")) {
  let options;
  const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const code = await main({
      argv,
      cwd,
      ensureRuntimeImpl: async () => {},
      preflightImpl: async (value) => {
        options = value;
        return { options: value };
      },
      runAnalysisImpl: async () => ({ status: "complete", outputPath: "unused" })
    });
    return { code, options, errors: stderr.mock.calls.flat().join("\n") };
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

describe("parseArgs", () => {
  it("defaults to cwd, local mode, and .code-understanding", () => {
    expect(parseArgs([], "/repo")).toEqual({
      targetPath: "/repo",
      tracked: false,
      output: ".code-understanding",
      keepIntermediate: false
    });
  });

  it("normalizes the internal Skill transport with every public option", async () => {
    const cwd = resolve("fixture repository");
    const result = await invoke([
      "--skill-arguments",
      '"project path" --tracked --output "reports path" --keep-intermediate'
    ], cwd);

    expect(result).toEqual({
      code: 0,
      options: {
        targetPath: resolve(cwd, "project path"),
        tracked: true,
        output: "reports path",
        keepIntermediate: true
      },
      errors: ""
    });
  });

  it.each([
    ["unquoted", "project", "project"],
    ["single quoted", "'project path'", "project path"],
    ["double quoted", '"project path"', "project path"],
    ["escaped space", "project\\ path", "project path"],
    ["escaped quote", '"project \\"quoted\\""', 'project "quoted"'],
    ["unquoted Windows", String.raw`C:\work\repo`, String.raw`C:\work\repo`],
    ["double quoted Windows", String.raw`"C:\Program Files\repo"`, String.raw`C:\Program Files\repo`],
    ["single quoted Windows", String.raw`'C:\Program Files\repo'`, String.raw`C:\Program Files\repo`],
    ["Windows drive root", "C:\\", "C:\\"]
  ])("tokenizes a %s Skill project path without execution", async (_label, payload, expectedPath) => {
    const cwd = resolve("fixture repository");
    const result = await invoke(["--skill-arguments", payload], cwd);

    expect(result.code).toBe(0);
    expect(result.options.targetPath).toBe(resolve(cwd, expectedPath));
  });

  it("treats an empty Skill payload as default arguments", async () => {
    const cwd = resolve("fixture repository");
    const result = await invoke(["--skill-arguments", ""], cwd);

    expect(result.code).toBe(0);
    expect(result.options.targetPath).toBe(cwd);
  });

  it("preserves Windows output paths and supported escapes", async () => {
    const cwd = resolve("fixture repository");
    const result = await invoke([
      "--skill-arguments",
      String.raw`C:\work\repo --output "C:\Program Files\reports"`
    ], cwd);

    expect(result.code).toBe(0);
    expect(result.options).toEqual({
      targetPath: resolve(cwd, String.raw`C:\work\repo`),
      tracked: false,
      output: String.raw`C:\Program Files\reports`,
      keepIntermediate: false
    });
  });

  it.each([
    ["unquoted", "C:\\work\\repo\\", "C:\\work\\repo\\", false],
    ["single quoted with spaces", String.raw`'C:\Program Files\repo\' --tracked`, "C:\\Program Files\\repo\\", true],
    ["double quoted with spaces", String.raw`"C:\Program Files\repo\" --tracked`, "C:\\Program Files\\repo\\", true]
  ])("preserves a %s project path ending in backslash", async (_label, payload, expectedPath, tracked) => {
    const cwd = resolve("fixture repository");
    const result = await invoke(["--skill-arguments", payload], cwd);

    expect(result.code).toBe(0);
    expect(result.options.targetPath).toBe(resolve(cwd, expectedPath));
    expect(result.options.tracked).toBe(tracked);
  });

  it.each([
    ["unquoted", "--output C:\\reports\\", "C:\\reports\\"],
    ["single quoted with spaces", String.raw`--output 'C:\Program Files\reports\'`, "C:\\Program Files\\reports\\"],
    ["double quoted with spaces", String.raw`--output "C:\Program Files\reports\"`, "C:\\Program Files\\reports\\"]
  ])("preserves a %s output path ending in backslash", async (_label, payload, expectedOutput) => {
    const result = await invoke(["--skill-arguments", payload]);

    expect(result.code).toBe(0);
    expect(result.options.output).toBe(expectedOutput);
  });

  it.each([
    ["before more content", String.raw`"C:\work\quo\"ted\repo"`, String.raw`C:\work\quo"ted\repo`],
    ["at token end with a separate closing quote", String.raw`"C:\work\name\""`, String.raw`C:\work\name"`]
  ])("preserves an embedded literal double quote %s", async (_label, payload, expectedPath) => {
    const cwd = resolve("fixture repository");
    const result = await invoke(["--skill-arguments", payload], cwd);

    expect(result.code).toBe(0);
    expect(result.options.targetPath).toBe(resolve(cwd, expectedPath));
  });

  it.each(["'unterminated", '"unterminated'])("rejects malformed Skill payload %j", async (payload) => {
    const result = await invoke(["--skill-arguments", payload]);

    expect(result.code).toBe(1);
    expect(result.options).toBeUndefined();
    expect(result.errors).toMatch(/malformed|unterminated|escape/i);
  });

  it("keeps direct argv unchanged when a path contains spaces", async () => {
    const cwd = resolve("fixture repository");
    const result = await invoke(["project path", "--tracked", "--output", "reports path", "--keep-intermediate"], cwd);

    expect(result.code).toBe(0);
    expect(result.options).toEqual({
      targetPath: resolve(cwd, "project path"),
      tracked: true,
      output: "reports path",
      keepIntermediate: true
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

  it.each([[["--unknown"]], [["--output"]], [["a", "b"]]])("rejects invalid argv %j", (argv) => {
    expect(() => parseArgs(argv, "/repo")).toThrow(/Usage: \/codebase-inspector/);
  });
});
