# Codebase Inspector Repository Archives

## Goal

Publish archives that can be extracted at a target repository root and immediately place the Skill at `.github/skills/codebase-inspector/` for GitHub Copilot discovery.

## Archives

The release produces two deterministic ZIP files:

- `codebase-inspector-0.1.0.zip` contains the Skill runtime without `node_modules`. The first run may execute `npm ci --omit=dev` inside the Skill directory.
- `codebase-inspector-0.1.0-with-dependencies.zip` contains the same runtime plus a clean production-only `node_modules`. It must run without npm installation or network access.

Every entry, including `LICENSE` and `NOTICE`, lives under `.github/skills/codebase-inspector/`. Extracting an archive must not create or replace files at the target repository root outside `.github/`.

## Build

The packager maps runtime source files to the repository-relative Skill prefix. The dependency archive is built from a temporary clean production installation, never from the development working tree's `node_modules`. Both archives retain the existing stable entry ordering, fixed timestamps, normalized permissions, and timezone-independent bytes.

## Verification

Automated tests verify exact path prefixes, excluded development files, license placement, deterministic hashes, and extraction into an empty repository fixture. GitHub Actions on Windows, macOS, and Ubuntu extracts the dependency archive and runs the Skill with npm installation disabled. A successful run must create all six output artifacts.

## Security And Size

Only dependencies represented by `package-lock.json` and installed by `npm ci --omit=dev` are bundled. Target repository scripts and executables remain prohibited. The dependency archive must stay below GitHub's normal per-file limit; the release fails clearly if it exceeds that limit.
