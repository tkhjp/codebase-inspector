# Codebase Inspector Repository Archives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a repository-ready Skill ZIP and a production-dependency-bundled ZIP that install under `.github/skills/codebase-inspector/` when extracted at a repository root.

**Architecture:** Extend the deterministic release builder with a fixed repository-relative archive prefix and an optional clean production dependency tree. A bundled-runtime marker binds the packaged dependencies to the exact `package-lock.json` hash so setup can skip installation without weakening the normal archive's dependency validation. A platform-matrix verifier extracts and runs the committed bundled archive without allowing npm installation.

**Tech Stack:** Node.js 22 ESM, AdmZip, npm lockfiles, Vitest, GitHub Actions.

## Global Constraints

- Both archives start at `.github/skills/codebase-inspector/`.
- `codebase-inspector-0.1.0.zip` excludes `node_modules` and may install production dependencies on first run.
- `codebase-inspector-0.1.0-with-dependencies.zip` includes only `npm ci --omit=dev` dependencies and runs without npm installation or network access.
- `LICENSE` and `NOTICE` remain inside the Skill directory.
- Archive ordering, timestamps, permissions, and bytes remain deterministic across timezones.
- The bundled archive must remain below 100,000,000 bytes.

---

### Task 1: Repository-Ready Archive Paths

**Files:**
- Modify: `.github/skills/codebase-inspector/scripts/package-release.mjs`
- Modify: `.github/skills/codebase-inspector/tests/integration/release-package.test.mjs`

**Interfaces:**
- Produces: `buildRelease({ sourceRoot, repositoryRoot, outputPath, dependencyRoot? }) -> Promise<string>`
- Archive prefix: `.github/skills/codebase-inspector/`

- [ ] **Step 1: Change release expectations to repository-relative paths**

Update the test entry assertions to require paths such as:

```js
const prefix = ".github/skills/codebase-inspector/";
expect(entries).toContain(`${prefix}SKILL.md`);
expect(entries).toContain(`${prefix}scripts/run.mjs`);
expect(entries).toContain(`${prefix}LICENSE`);
expect(entries.every((entry) => entry.startsWith(prefix))).toBe(true);
expect(entries).not.toContain("LICENSE");
```

- [ ] **Step 2: Run the release test and verify RED**

Run: `npm test -- --run tests/integration/release-package.test.mjs`

Expected: FAIL because current entries start at `SKILL.md`, `lib/`, and root `LICENSE`.

- [ ] **Step 3: Prefix every archive entry**

Add one mapping helper and apply it to runtime and license entries:

```js
const skillArchivePrefix = ".github/skills/codebase-inspector";

function skillArchivePath(relativePath) {
  return `${skillArchivePrefix}/${relativePath}`;
}
```

Keep sorting by final archive name and retain fixed timestamp and mode handling.

- [ ] **Step 4: Run the release test and verify GREEN**

Run: `npm test -- --run tests/integration/release-package.test.mjs`

Expected: PASS with all entries below `.github/skills/codebase-inspector/`.

- [ ] **Step 5: Commit**

```bash
git add .github/skills/codebase-inspector/scripts/package-release.mjs .github/skills/codebase-inspector/tests/integration/release-package.test.mjs
git commit -m "fix: package repository-ready skill archive"
```

### Task 2: Clean Bundled Production Dependencies

**Files:**
- Modify: `.github/skills/codebase-inspector/scripts/package-release.mjs`
- Modify: `.github/skills/codebase-inspector/scripts/setup.mjs`
- Modify: `.github/skills/codebase-inspector/tests/integration/release-package.test.mjs`
- Modify: `.github/skills/codebase-inspector/tests/unit/setup.test.mjs`

**Interfaces:**
- Consumes: `package-lock.json` bytes and a clean `dependencyRoot/node_modules`
- Produces: `.codebase-inspector-runtime.json` with `{ formatVersion: 1, packageLockSha256: string }`
- Produces: `codebase-inspector-0.1.0-with-dependencies.zip`

- [ ] **Step 1: Add failing bundled archive and setup-marker tests**

Use a fixture dependency tree and assert:

```js
expect(entries).toContain(`${prefix}node_modules/example/package.json`);
expect(entries).toContain(`${prefix}.codebase-inspector-runtime.json`);
expect(entries.some((entry) => entry.startsWith(`${prefix}tests/`))).toBe(false);
```

Add a setup test proving a matching marker returns before `runProcess`:

```js
expect(calls).toEqual([]);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --run tests/integration/release-package.test.mjs tests/unit/setup.test.mjs`

Expected: FAIL because dependency entries and marker validation do not exist.

- [ ] **Step 3: Build a clean production dependency staging directory**

The CLI path of `package-release.mjs` must:

```js
await cp(packageJsonPath, stagedPackageJsonPath);
await cp(packageLockPath, stagedPackageLockPath);
await runNpmCi(stagingRoot, ["ci", "--omit=dev", "--ignore-scripts"]);
await buildRelease({ dependencyRoot: stagingRoot, outputPath: bundledArchivePath });
```

Never collect the development worktree's `node_modules`.

- [ ] **Step 4: Add deterministic dependency entries and marker**

When `dependencyRoot` is present, collect regular files below `node_modules`, prefix their paths, and add a generated marker whose lock hash is computed with SHA-256. Reject a bundled archive at or above `100_000_000` bytes.

- [ ] **Step 5: Make setup trust only an exact bundled marker**

Before spawning npm, read the marker and compare its `packageLockSha256` to the current lockfile. Return only when the marker matches and `node_modules` exists; malformed, absent, or stale markers fall back to the existing `npm ls` / `npm ci` flow.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npm test -- --run tests/integration/release-package.test.mjs tests/unit/setup.test.mjs`

Expected: PASS for slim archive exclusion, bundled inclusion, marker matching, and stale-marker fallback.

- [ ] **Step 7: Commit**

```bash
git add .github/skills/codebase-inspector/scripts/package-release.mjs .github/skills/codebase-inspector/scripts/setup.mjs .github/skills/codebase-inspector/tests/integration/release-package.test.mjs .github/skills/codebase-inspector/tests/unit/setup.test.mjs
git commit -m "feat: add bundled production dependency archive"
```

### Task 3: Cross-Platform Extract-And-Run Verification

**Files:**
- Create: `.github/skills/codebase-inspector/scripts/verify-release-archives.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/skills/codebase-inspector/package.json`
- Test: `.github/skills/codebase-inspector/tests/integration/release-package.test.mjs`

**Interfaces:**
- Consumes: both release ZIP paths
- Produces: exit code 0 only after extraction and bundled execution creates all six artifacts without npm installation

- [ ] **Step 1: Add verifier behavior to the release integration test**

Assert that extraction creates:

```js
join(repositoryRoot, ".github/skills/codebase-inspector/SKILL.md")
join(repositoryRoot, ".github/skills/codebase-inspector/node_modules")
```

Inject a `runProcess` that throws if called and verify `ensureRuntime` accepts the bundled marker.

- [ ] **Step 2: Implement `verify-release-archives.mjs`**

The verifier must create a temporary Git repository, extract each archive at its root, check exact placement, and run the bundled Skill with network guard variables. It must verify the six artifact names and always remove the temporary directory.

- [ ] **Step 3: Wire package scripts and matrix CI**

Add:

```json
"verify:release": "node scripts/verify-release-archives.mjs"
```

After `npm run release:zip`, run `npm run verify:release` in every existing OS matrix job.

- [ ] **Step 4: Run integration and full tests**

Run: `npm test && npm run verify:release`

Expected: all tests pass and both archives extract at repository root; bundled execution performs no install.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/skills/codebase-inspector/package.json .github/skills/codebase-inspector/scripts/verify-release-archives.mjs .github/skills/codebase-inspector/tests/integration/release-package.test.mjs
git commit -m "test: verify repository archives across platforms"
```

### Task 4: Documentation, Release, And Remote Verification

**Files:**
- Modify: `.github/skills/codebase-inspector/README.ja.md`
- Replace: `.github/skills/codebase-inspector/codebase-inspector-0.1.0.zip`
- Create: `.github/skills/codebase-inspector/codebase-inspector-0.1.0-with-dependencies.zip`

**Interfaces:**
- Produces: two GitHub-downloadable repository installation archives

- [ ] **Step 1: Document both installation modes in Japanese**

State that users extract either ZIP at the target repository root, that the slim archive installs dependencies on first run, and that the bundled archive is larger but runs without dependency download.

- [ ] **Step 2: Run all release gates**

Run:

```bash
npm test
npm run lint
npm audit
npm audit --omit=dev
npm run check:licenses
env TZ=UTC npm run release:zip
npm run verify:release
```

Expected: all commands exit 0; both ZIP files are below 100,000,000 bytes.

- [ ] **Step 3: Rebuild in JST and compare hashes**

Run `env TZ=Asia/Tokyo npm run release:zip` and compare both SHA-256 values with the UTC build.

Expected: each archive hash is unchanged across timezones.

- [ ] **Step 4: Commit and push**

```bash
git add .github/skills/codebase-inspector/README.ja.md .github/skills/codebase-inspector/codebase-inspector-0.1.0.zip .github/skills/codebase-inspector/codebase-inspector-0.1.0-with-dependencies.zip
git commit -m "release: publish repository installation archives"
git push
```

- [ ] **Step 5: Wait for GitHub Actions**

Use `gh run watch --exit-status` and require successful Windows, macOS, and Ubuntu jobs before reporting download URLs and hashes.
