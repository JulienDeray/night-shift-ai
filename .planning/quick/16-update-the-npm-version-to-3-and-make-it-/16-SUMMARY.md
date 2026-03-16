---
phase: quick-16
plan: "01"
subsystem: cli
tags: [version, package-json, cli]
dependency_graph:
  requires: []
  provides: [VERSION-BUMP, VERSION-DISPLAY]
  affects: [src/cli/index.ts, package.json]
tech_stack:
  added: []
  patterns: [createRequire for JSON import in ESM, import.meta.url path resolution]
key_files:
  created: []
  modified:
    - package.json
    - src/cli/index.ts
decisions:
  - Use path depth detection (dist/ segment check) to resolve package.json correctly in both tsx source mode and compiled dist mode
metrics:
  duration: "~8 minutes"
  completed: "2026-03-16"
---

# Phase quick-16 Plan 01: Version bump to 3.0.0 with dynamic CLI version Summary

**One-liner:** Bumped package.json to 3.0.0 and wired `nightshift --version` to read version dynamically via `createRequire` with runtime path-depth detection for tsx vs compiled mode compatibility.

## What Was Done

- Updated `package.json` version from `2.0.0` to `3.0.0`
- Replaced hardcoded `"0.1.0"` in `src/cli/index.ts` with dynamic `createRequire` import of `package.json`
- Version is now defined in exactly one place: `package.json`

## Verification

- `npx tsx bin/nightshift.ts --version` outputs `3.0.0`
- `npm run build && node dist/bin/nightshift.js --version` outputs `3.0.0`
- `npm run typecheck` passes
- No hardcoded version string in `src/cli/index.ts`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect relative path depth for package.json**
- **Found during:** Task 1 verification (compiled dist mode)
- **Issue:** Plan specified `../../package.json` which resolves correctly from `src/cli/index.ts` in tsx mode but fails from `dist/src/cli/index.js` in compiled mode (one level too shallow)
- **Fix:** Detect whether running from a `dist/` path using `import.meta.url` and dynamically choose 2 or 3 levels up accordingly
- **Files modified:** `src/cli/index.ts`
- **Commit:** 624b1ca

## Self-Check: PASSED

- `package.json` contains `"version": "3.0.0"` — FOUND
- `src/cli/index.ts` uses `createRequire` with dynamic path — FOUND
- Commit 624b1ca — FOUND
