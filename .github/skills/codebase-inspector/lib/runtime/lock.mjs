import { open, unlink } from "node:fs/promises";
import { join } from "node:path";

export async function withAnalysisLock(gitDir, action) {
  const lockPath = join(gitDir, "codebase-inspector.lock");
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("analysis already running");
    throw error;
  }

  try {
    await handle.writeFile("Codebase Inspector analysis lock\n");
    return await action();
  } finally {
    try {
      await handle.close();
    } finally {
      await unlink(lockPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}
