---
phase: quick-18
plan: 18
subsystem: orchestrator, config
tags: [dispatch-cap, orchestrator, config, performance]
dependency_graph:
  requires: []
  provides: [per-tick-dispatch-cap]
  affects: [orchestrator-tick, config-schema, NightShiftConfig]
tech_stack:
  added: []
  patterns: [per-tick-counter, break-early, shared-counter-across-loops]
key_files:
  created: []
  modified:
    - src/core/types.ts
    - src/core/config.ts
    - src/daemon/orchestrator.ts
    - tests/unit/config.test.ts
    - tests/unit/orchestrator-tick.test.ts
decisions:
  - Shared tickDispatches counter spans both cron and file queue loops so the cap is total per tick, not per loop
  - Cap check added before pool.canAccept() check (order: tick cap, then pool capacity)
  - Debug log emitted exactly once when cap is first reached in each loop, not on every skipped task
metrics:
  duration: 9 minutes
  completed_date: "2026-03-30"
  tasks_completed: 2
  files_modified: 5
---

# Phase quick-18 Plan 18: Per-Tick Dispatch Cap Summary

**One-liner:** Added `max_dispatches_per_tick` config field (default 2) with a shared tickDispatches counter across orchestrator cron and file queue dispatch loops, preventing burst-spawning of heavy Claude processes after daemon restart.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add max_dispatches_per_tick config field | 15129f0 | src/core/types.ts, src/core/config.ts, tests/unit/config.test.ts |
| 2 | Enforce per-tick dispatch cap in orchestrator | eacd100 + 6882681 | src/daemon/orchestrator.ts, tests/unit/orchestrator-tick.test.ts |

## What Was Built

### Config Changes

- `NightShiftConfig.maxDispatchesPerTick: number` added to the interface in `src/core/types.ts`
- `max_dispatches_per_tick: z.number().int().positive().default(2)` added to `ConfigSchema` in `src/core/config.ts`
- `mapConfig()` maps `raw.max_dispatches_per_tick` to `maxDispatchesPerTick`

### Orchestrator Changes

In `tick()`:
- `let tickDispatches = 0` initialized before phase 2 (cron loop)
- Cron loop: breaks when `tickDispatches >= this.config.maxDispatchesPerTick`
- File queue loop: skipped entirely if cap already reached from cron loop; breaks mid-loop if cap reached
- Debug log emitted when cap is reached in either loop

### Tests

- 3 new config tests: default 2, custom value 5, rejection of 0
- `makeConfig()` in orchestrator-tick.test.ts updated with `maxDispatchesPerTick: 2`
- `simulateTick()` updated to accept and enforce config cap
- 3 new orchestrator-tick tests in "per-tick dispatch cap" describe block:
  - Pool with 5 slots + cap of 2 → only 2 dispatched
  - Tasks not dispatched due to cap are retried next tick (not lost)
  - Cap of 1 restricts to exactly 1 dispatch per tick

## Verification

- All 22 unit test files pass (345 tests)
- TypeScript compiles without errors (`npx tsc --noEmit`)
- Integration test flakiness is pre-existing (3 baseline failures from parallel race conditions, not caused by this change)

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check

### Files exist
- [x] src/core/types.ts — modified
- [x] src/core/config.ts — modified
- [x] src/daemon/orchestrator.ts — modified
- [x] tests/unit/config.test.ts — modified
- [x] tests/unit/orchestrator-tick.test.ts — modified

### Commits exist
- [x] 15129f0 — feat(quick-18): add max_dispatches_per_tick config field with default 2
- [x] eacd100 — test(quick-18): add failing tests for per-tick dispatch cap in orchestrator
- [x] 6882681 — feat(quick-18): enforce per-tick dispatch cap in orchestrator tick()

## Self-Check: PASSED
