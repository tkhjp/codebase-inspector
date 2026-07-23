import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { ensureRuntime, processInvocation } from "../../scripts/setup.mjs";

async function expectNpmInstallFallback({
  markerContents,
  createNodeModules = true,
  platform = "linux",
  expectedNpm = "npm"
}) {
  const skillDir = await mkdtemp(join(tmpdir(), "codebase-inspector-setup-fallback-"));
  const calls = [];

  try {
    if (createNodeModules) await mkdir(join(skillDir, "node_modules"));
    await writeFile(join(skillDir, "package-lock.json"), "{\"lockfileVersion\":3}\n");
    if (markerContents !== undefined) {
      await writeFile(join(skillDir, ".codebase-inspector-runtime.json"), markerContents);
    }

    await ensureRuntime({
      skillDir,
      nodeVersion: "22.0.0",
      platform,
      runProcess: async (...args) => {
        calls.push(args);
        return calls.length === 1 ? 1 : 0;
      }
    });

    expect(calls).toEqual([
      [expectedNpm, ["ls", "--omit=dev", "--silent"], { cwd: skillDir, stdio: "ignore" }],
      [expectedNpm, ["ci", "--omit=dev"], { cwd: skillDir, stdio: "inherit" }],
      [expectedNpm, ["ls", "--omit=dev", "--silent"], { cwd: skillDir, stdio: "ignore" }]
    ]);
  } finally {
    await rm(skillDir, { recursive: true, force: true });
  }
}

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

test("skips npm when the bundled runtime marker matches the package lock", async () => {
  const skillDir = await mkdtemp(join(tmpdir(), "codebase-inspector-setup-marker-"));
  const packageLock = "{\"lockfileVersion\":3}\n";
  const calls = [];

  try {
    await mkdir(join(skillDir, "node_modules"));
    await writeFile(join(skillDir, "package-lock.json"), packageLock);
    await writeFile(join(skillDir, ".codebase-inspector-runtime.json"), JSON.stringify({
      formatVersion: 1,
      packageLockSha256: createHash("sha256").update(packageLock).digest("hex")
    }));

    await ensureRuntime({
      skillDir,
      nodeVersion: "22.0.0",
      runProcess: async (...args) => calls.push(args)
    });

    expect(calls).toEqual([]);
  } finally {
    await rm(skillDir, { recursive: true, force: true });
  }
});

test("falls back to npm validation when the bundled runtime marker is stale", async () => {
  const skillDir = await mkdtemp(join(tmpdir(), "codebase-inspector-setup-stale-marker-"));
  const calls = [];

  try {
    await mkdir(join(skillDir, "node_modules"));
    await writeFile(join(skillDir, "package-lock.json"), "{\"lockfileVersion\":3}\n");
    await writeFile(join(skillDir, ".codebase-inspector-runtime.json"), JSON.stringify({
      formatVersion: 1,
      packageLockSha256: "stale"
    }));

    await ensureRuntime({
      skillDir,
      nodeVersion: "22.0.0",
      runProcess: async (...args) => {
        calls.push(args);
        return 0;
      }
    });

    expect(calls).toEqual([["npm", ["ls", "--omit=dev", "--silent"], {
      cwd: skillDir,
      stdio: "ignore"
    }]]);
  } finally {
    await rm(skillDir, { recursive: true, force: true });
  }
});

test("falls back to npm install when the bundled runtime marker is absent", async () => {
  await expectNpmInstallFallback({});
});

test("uses npm.cmd for fallback installation on Windows", async () => {
  await expectNpmInstallFallback({ platform: "win32", expectedNpm: "npm.cmd" });
});

test("falls back to npm install when the bundled runtime marker is invalid JSON", async () => {
  await expectNpmInstallFallback({ markerContents: "not-json" });
});

test("falls back to npm install when the bundled runtime marker format is unsupported", async () => {
  const packageLock = "{\"lockfileVersion\":3}\n";
  await expectNpmInstallFallback({
    markerContents: JSON.stringify({
      formatVersion: 2,
      packageLockSha256: createHash("sha256").update(packageLock).digest("hex")
    })
  });
});

test("falls back to npm install when a matching marker has no node_modules", async () => {
  const packageLock = "{\"lockfileVersion\":3}\n";
  await expectNpmInstallFallback({
    createNodeModules: false,
    markerContents: JSON.stringify({
      formatVersion: 1,
      packageLockSha256: createHash("sha256").update(packageLock).digest("hex")
    })
  });
});
