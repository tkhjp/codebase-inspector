import * as fs from "node:fs/promises";
import { join } from "node:path";

export async function withAnalysisLock(gitDir, action, { fsOps = fs } = {}) {
  const lockPath = join(gitDir, "codebase-inspector.lock");
  let handle;
  try {
    handle = await fsOps.open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("analysis already running");
    throw error;
  }

  let result;
  let primaryError;
  try {
    await handle.writeFile("Codebase Inspector analysis lock\n");
    result = await action();
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = [];
  try {
    await handle.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await fsOps.unlink(lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") cleanupErrors.push(error);
  }

  if (primaryError && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], "Analysis failed and lock cleanup also failed");
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "Lock cleanup failed");
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  return result;
}
