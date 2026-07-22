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
