import { expect, test } from "vitest";
import { stableId } from "../../lib/normalize/stable-id.mjs";

test("builds readable stable IDs from normalized path parts", () => {
  expect(stableId("method", "src/a.ts", "Greeter", "run", 12))
    .toBe("method:src%2Fa.ts:Greeter:run:12");
  expect(stableId("file", "src\\nested\\a.ts"))
    .toBe("file:src%2Fnested%2Fa.ts");
});
