import { randomUUID } from "node:crypto";
import { rename, rm, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function publishStructureDocuments(outputPath, files) {
  const token = randomUUID();
  const parent = dirname(outputPath);
  const temporary = join(parent, `${basename(outputPath)}.tmp-${token}`);
  const backup = join(parent, `${basename(outputPath)}.backup-${token}`);
  await mkdir(temporary, { recursive: true });
  try {
    for (const [name, content] of [...files].sort(([left], [right]) => compareText(left, right))) {
      if (name.includes("/") || name.includes("\\") || name === "." || name === "..") throw new Error(`Invalid rendered filename: ${name}`);
      await writeFile(join(temporary, name), content, "utf8");
    }
    await rm(backup, { recursive: true, force: true });
    try {
      await rename(outputPath, backup);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(temporary, outputPath);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    try {
      await rename(backup, outputPath);
    } catch (restoreError) {
      if (restoreError.code !== "ENOENT") throw new AggregateError([error, restoreError], "Document publication and rollback failed");
    }
    throw error;
  }
}
