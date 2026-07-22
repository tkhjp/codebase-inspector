import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { describe, expect, test } from "vitest";

const expected = ["cpp", "csharp", "dart", "go", "java", "kotlin", "php", "python", "ruby", "rust", "typescript"];

describe("vendored Understand-Anything snapshot", () => {
  test("is pinned and fully inventoried", async () => {
    const url = new URL("../../vendor/understand-anything/manifest.json", import.meta.url);
    const manifest = JSON.parse(await readFile(url, "utf8"));

    expect(manifest.upstream.commit).toBe("54754a6f97051d1d76c8758353d8ea41afe502a6");
    expect(manifest.extractors.map((entry) => entry.name).sort()).toEqual(expected);
    expect(manifest.extractors.every((entry) => /^[a-f0-9]{64}$/.test(entry.sourceSha256))).toBe(true);
    expect(manifest.extractors.every((entry) => /^[a-f0-9]{64}$/.test(entry.generatedSha256))).toBe(true);
    expect(manifest.localPatches).toEqual([]);
  });

  test("records each manifest source path in its generated module", async () => {
    const manifestUrl = new URL("../../vendor/understand-anything/manifest.json", import.meta.url);
    const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
    const skillRoot = new URL("../../", import.meta.url);
    const skillPrefix = ".github/skills/codebase-inspector/";

    for (const entry of [manifest.base, ...manifest.extractors]) {
      const generatedUrl = new URL(entry.generatedPath.slice(skillPrefix.length), skillRoot);
      expect(await readFile(generatedUrl, "utf8")).toContain(entry.sourcePath);
    }
  });
});
