import { expect, test } from "vitest";
import { processInvocation } from "../../scripts/setup.mjs";

test("runs npm.cmd through cmd.exe without enabling a general shell", () => {
  expect(processInvocation("npm.cmd", ["ci", "--omit=dev"], {
    platform: "win32",
    commandShell: "C:\\Windows\\System32\\cmd.exe"
  })).toEqual({
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", "npm.cmd", "ci", "--omit=dev"]
  });
});

test("keeps direct process invocation on non-Windows platforms", () => {
  expect(processInvocation("npm", ["ci"], { platform: "linux" })).toEqual({
    command: "npm",
    args: ["ci"]
  });
});
