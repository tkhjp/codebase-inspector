import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const unitDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(unitDir, "../..");
const repositoryDir = resolve(skillDir, "../../..");

test("Skill instructions use repository-root transport without executing argument text", async () => {
  const [skill, skillJapanese] = await Promise.all([
    readFile(resolve(skillDir, "SKILL.md"), "utf8"),
    readFile(resolve(skillDir, "README.ja.md"), "utf8")
  ]);
  const embeddedQuote = String.raw`\"`;
  const terminalEmbeddedQuote = String.raw`\""`;

  expect(skill).toContain("from the target repository root");
  expect(skill).toContain('node .github/skills/codebase-inspector/scripts/run.mjs --skill-arguments "$ARGUMENTS"');
  expect(skill).not.toContain('node scripts/run.mjs "$ARGUMENTS"');
  expect(skill).toContain(`A terminal \`${embeddedQuote}\` in a double-quoted token preserves the backslash and closes the token`);
  expect(skill).toContain(String.raw`"C:\Program Files\repo\"`);
  expect(skill).toContain(`use \`${embeddedQuote}\` before more token content`);
  expect(skill).toContain(`use \`${terminalEmbeddedQuote}\` at the token end`);
  expect(skill).toContain("A literal double quote immediately before whitespace in the same token requires single quotes around the payload token");
  expect(skill).toContain(String.raw`'C:\Program Files\name" next'`);
  expect(skillJapanese).toContain(`二重引用符 token 末尾の \`${embeddedQuote}\` は、バックスラッシュを保持して token を閉じます`);
  expect(skillJapanese).toContain(String.raw`"C:\Program Files\repo\"`);
  expect(skillJapanese).toContain(`token の途中では \`${embeddedQuote}\``);
  expect(skillJapanese).toContain(`token 末尾では \`${terminalEmbeddedQuote}\``);
  expect(skillJapanese).toContain("同じ token 内でリテラルの二重引用符の直後に空白を置く場合は、token 全体を一重引用符で囲む必要があります");
  expect(skillJapanese).toContain(String.raw`'C:\Program Files\name" next'`);
});

test("Skill and root documentation describe tracked scanning and output modes accurately", async () => {
  const [skillJapanese, rootEnglish, rootJapanese] = await Promise.all([
    readFile(resolve(skillDir, "README.ja.md"), "utf8"),
    readFile(resolve(repositoryDir, "README.md"), "utf8"),
    readFile(resolve(repositoryDir, "README.ja.md"), "utf8")
  ]);

  expect(skillJapanese).toContain("`analyze` は Git が追跡しているファイルだけを解析します");
  expect(skillJapanese).toContain("`render` は指定した snapshot だけを読み");
  expect(skillJapanese).toContain("ソースファイルの走査や `.git/info/exclude` の変更を行いません");
  expect(skillJapanese).toContain("`.git/info/exclude`");
  expect(skillJapanese).toContain("`--tracked` はこの所有ブロックを削除");
  expect(skillJapanese).toContain("version control");
  expect(skillJapanese).toContain("`--keep-intermediate` は受け付けてレポートに記録しますが、追加ファイルは生成しません");
  expect(skillJapanese).not.toContain("Git 管理下でない読み取り可能なソースファイル");
  expect(skillJapanese).not.toContain("中間情報を保持します");

  expect(rootEnglish).toContain("`analyze` scans only Git-tracked files.");
  expect(rootEnglish).toContain("Codebase Inspector-owned analysis-output block to `.git/info/exclude`");
  expect(rootEnglish).toContain("`--tracked` leaves no owned block");
  expect(rootEnglish).toContain("`--keep-intermediate` is recorded but emits no extra file.");
  expect(rootEnglish).toContain("`render` reads only the saved snapshot");

  expect(rootJapanese).toContain("`analyze` は Git が追跡しているファイルだけを解析します");
  expect(rootJapanese).toContain("`render` は保存済み snapshot だけを読み");
  expect(rootJapanese).toContain("`.git/info/exclude`");
  expect(rootJapanese).toContain("`--tracked` はそのブロックを残しません");
  expect(rootJapanese).toContain("`--keep-intermediate` はレポートに記録しますが、追加ファイルは生成しません");
});
