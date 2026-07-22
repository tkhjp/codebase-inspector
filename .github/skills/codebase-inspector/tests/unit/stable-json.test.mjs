import { expect, it } from "vitest";
import { normalizeText, stableStringify } from "../../lib/output/stable-json.mjs";

it("sorts object keys recursively, preserves array order, and writes LF", () => {
  expect(stableStringify({ z: 1, a: { y: 2, x: 3 }, list: [{ b: 2, a: 1 }] }))
    .toBe('{\n  "a": {\n    "x": 3,\n    "y": 2\n  },\n  "list": [\n    {\n      "a": 1,\n      "b": 2\n    }\n  ],\n  "z": 1\n}\n');
  expect(normalizeText("a\r\nb\rc")).toBe("a\nb\nc");
});
