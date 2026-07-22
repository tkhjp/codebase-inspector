import { expect, test } from "vitest";
import { withAnalysisLock } from "../../lib/runtime/lock.mjs";

test("preserves the action error and aggregates independent close and unlink failures", async () => {
  const actionError = new Error("action failed");
  const closeError = new Error("close failed");
  const unlinkError = new Error("unlink failed");
  const calls = [];
  const fsOps = {
    async open() {
      return {
        async writeFile() {
          calls.push("write");
        },
        async close() {
          calls.push("close");
          throw closeError;
        }
      };
    },
    async unlink() {
      calls.push("unlink");
      throw unlinkError;
    }
  };

  let caught;
  try {
    await withAnalysisLock("/fixture/.git", async () => {
      calls.push("action");
      throw actionError;
    }, { fsOps });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AggregateError);
  expect(caught.errors).toEqual([actionError, closeError, unlinkError]);
  expect(calls).toEqual(["write", "action", "close", "unlink"]);
});
