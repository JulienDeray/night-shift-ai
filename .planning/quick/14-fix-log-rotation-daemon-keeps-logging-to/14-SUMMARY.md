---
phase: quick-14
plan: 01
subsystem: logger
tags: [logging, daemon, rotation, tdd]
dependency_graph:
  requires: []
  provides: [dynamic-log-rotation]
  affects: [src/core/logger.ts]
tech_stack:
  added: []
  patterns: [fake-timers-date-only]
key_files:
  created:
    - tests/unit/logger.test.ts
  modified:
    - src/core/logger.ts
decisions:
  - "Use logsDir field on Logger to enable dynamic per-write date recomputation, keeping logFile as fallback for non-rotating loggers"
  - "Fake only Date (not all timers) in tests to avoid setTimeout blocking"
metrics:
  duration: 10m
  completed: 2026-03-12
---

# Quick Task 14: Fix Log Rotation — Daemon Keeps Logging to Same File Summary

**One-liner:** Added `logsDir` field to Logger so daemon writes recompute the dated file path on every call using `new Date()`, enabling midnight rotation without restart.

## What Was Done

The daemon logger was computing its log file path once at creation time via `createDaemonLogger`. Any write after midnight still went to the previous day's file. The fix adds a `logsDir` field to the Logger class: when set, each `write()` call recomputes `daemon-YYYY-MM-DD.log` from the current date before calling `fs.appendFile`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Add failing tests for log rotation | 4be0a8d | tests/unit/logger.test.ts |
| 1 (GREEN) | Implement dynamic file path resolution | b1d255a | src/core/logger.ts |
| 2 | Verify full test suite passes | (no code) | — |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test timeout with `vi.useFakeTimers()` blocking `setTimeout`**
- **Found during:** Task 1 RED phase
- **Issue:** Using `vi.useFakeTimers()` intercepts `setTimeout`, causing `await new Promise(resolve => setTimeout(resolve, 0))` to hang indefinitely
- **Fix:** Changed to `vi.useFakeTimers({ toFake: ["Date"] })` so only `Date` is faked, leaving real timers intact; replaced `setTimeout`-based flushes with `await Promise.resolve()` microtask flushes
- **Files modified:** tests/unit/logger.test.ts
- **Commit:** 4be0a8d

## Test Results

- Unit tests: 4/4 pass (new logger tests)
- All 26 unit test files pass
- Integration test failures (8): pre-existing, unrelated to this change (temp dir race conditions, spawn npx ENOENT in CI environment)
- TypeScript: compiles cleanly

## Self-Check: PASSED

- [x] tests/unit/logger.test.ts exists
- [x] src/core/logger.ts modified with logsDir field
- [x] Commits 4be0a8d and b1d255a exist
- [x] `npx vitest run tests/unit/logger.test.ts` passes (4/4)
- [x] `npx tsc --noEmit` exits 0
