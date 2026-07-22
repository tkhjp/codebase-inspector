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

  it.each([[["--unknown"]], [["--output"]], [["a", "b"]]])("rejects invalid argv %j", (argv) => {
    expect(() => parseArgs(argv, "/repo")).toThrow(/Usage: \/codebase-inspector/);
  });
});
