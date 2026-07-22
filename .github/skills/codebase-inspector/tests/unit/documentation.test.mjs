import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const unitDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(unitDir, "../..");
const repositoryDir = resolve(skillDir, "../../..");

test("Skill instructions use repository-root transport without executing argument text", async () => {
  const skill = await readFile(resolve(skillDir, "SKILL.md"), "utf8");

  expect(skill).toContain("from the target repository root");
  expect(skill).toContain('node .github/skills/codebase-inspector/scripts/run.mjs --skill-arguments "$ARGUMENTS"');
  expect(skill).not.toContain('node scripts/run.mjs "$ARGUMENTS"');
});

test("Skill and root documentation describe tracked scanning and output modes accurately", async () => {
  const [skillJapanese, rootEnglish, rootJapanese] = await Promise.all([
    readFile(resolve(skillDir, "README.ja.md"), "utf8"),
    readFile(resolve(repositoryDir, "README.md"), "utf8"),
    readFile(resolve(repositoryDir, "README.ja.md"), "utf8")
  ]);

  expect(skillJapanese).toContain("両方のモードで Git が追跡しているファイルだけを解析します");
  expect(skillJapanese).toContain("`.git/info/exclude`");
  expect(skillJapanese).toContain("`--tracked` はこの所有ブロックを削除");
  expect(skillJapanese).toContain("version control");
  expect(skillJapanese).toContain("`--keep-intermediate` は受け付けてレポートに記録しますが、追加ファイルは生成しません");
  expect(skillJapanese).not.toContain("Git 管理下でない読み取り可能なソースファイル");
  expect(skillJapanese).not.toContain("中間情報を保持します");

  expect(rootEnglish).toContain("Both modes scan only Git-tracked files.");
  expect(rootEnglish).toContain("Default mode adds only a Codebase Inspector-owned output block to `.git/info/exclude`.");
  expect(rootEnglish).toContain("`--tracked` removes that owned block so the output can be version controlled.");
  expect(rootEnglish).toContain("`--keep-intermediate` is accepted and reported but emits no extra file.");

  expect(rootJapanese).toContain("両方のモードで Git が追跡しているファイルだけを解析します");
  expect(rootJapanese).toContain("`.git/info/exclude`");
  expect(rootJapanese).toContain("`--tracked` は所有ブロックを削除");
  expect(rootJapanese).toContain("`--keep-intermediate` は受け付けてレポートに記録しますが、追加ファイルは生成しません");
});
