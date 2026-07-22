import { resolve } from "node:path";

const USAGE = "Usage: /codebase-inspector [project-path] [--tracked] [--output <dir>] [--keep-intermediate]";
const SKILL_ARGUMENTS = "--skill-arguments";

function malformed(message) {
  throw new Error(`Malformed Skill arguments: ${message}`);
}

function tokenizeSkillArguments(payload) {
  const tokens = [];
  let token = "";
  let tokenStarted = false;
  let quote = null;

  for (let index = 0; index < payload.length; index += 1) {
    const character = payload[index];
    if (quote === "'") {
      if (character === quote) quote = null;
      else token += character;
      tokenStarted = true;
    } else if (character === "\\") {
      const next = payload[index + 1];
      const escapesDelimiter = next !== undefined && /\s/.test(next);
      const escapesQuote = next === '"' || (!quote && next === "'");
      if (next === "\\" || escapesDelimiter || escapesQuote) {
        token += next;
        index += 1;
      } else {
        token += character;
      }
      tokenStarted = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else token += character;
      tokenStarted = true;
    } else if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
    } else {
      token += character;
      tokenStarted = true;
    }
  }

  if (quote) malformed("unterminated quote");
  if (tokenStarted) tokens.push(token);
  return tokens;
}

export function normalizeArgv(argv) {
  if (argv[0] !== SKILL_ARGUMENTS) return argv;
  if (argv.length !== 2 || typeof argv[1] !== "string") malformed(`${SKILL_ARGUMENTS} requires one payload`);
  return tokenizeSkillArguments(argv[1]);
}

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
