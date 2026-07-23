import { expect, test } from "vitest";
import {
  stableId,
  stableMethodId,
  stableTypeId
} from "../../lib/normalize/stable-id.mjs";

test("builds readable stable IDs from normalized path parts", () => {
  expect(stableId("method", "src/a.ts", "Greeter", "run", 12))
    .toBe("method:src%2Fa.ts:Greeter:run:12");
  expect(stableId("file", "src\\nested\\a.ts"))
    .toBe("file:src%2Fnested%2Fa.ts");
});

test("distinguishes scoped types, owners, overloads, and accessor kinds without line numbers", () => {
  const salesOrder = stableTypeId({
    language: "typescript",
    filePath: "src/sales.ts",
    kind: "class",
    qualifiedName: "sales.Order",
    hasExplicitScope: true
  });
  const billingOrder = stableTypeId({
    language: "typescript",
    filePath: "src/billing.ts",
    kind: "class",
    qualifiedName: "billing.Order",
    hasExplicitScope: true
  });
  const method = (ownerTypeId, kind, type) => stableMethodId({
    ownerTypeId,
    kind,
    name: "find",
    parameters: [{ type, optional: false, variadic: false }]
  });

  expect(salesOrder).not.toBe(billingOrder);
  expect(method(salesOrder, "method", "string")).not.toBe(method(billingOrder, "method", "string"));
  expect(method(salesOrder, "method", "string")).not.toBe(method(salesOrder, "method", "number"));
  expect(method(salesOrder, "getter", "string")).not.toBe(method(salesOrder, "setter", "string"));
  expect(method(salesOrder, "method", "string")).not.toMatch(/:\d+$/);
});
