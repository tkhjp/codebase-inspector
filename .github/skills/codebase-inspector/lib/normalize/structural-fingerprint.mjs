import { createHash } from "node:crypto";
import { stableStringify } from "../output/stable-json.mjs";

export function structuralFingerprint(value) {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}
