---
phase: quick-13
plan: "01"
subsystem: agent-engine, orchestrator
tags: [bug-fix, semantic-failure, recurring-tasks, bead-pipeline]
dependency_graph:
  requires: []
  provides: [semantic-failure-detection, origin-aware-bead-close]
  affects: [src/agent/engine.ts, src/daemon/orchestrator.ts]
tech_stack:
  added: []
  patterns: [early-return-on-semantic-failure, origin-guard]
key_files:
  created: []
  modified:
    - src/agent/engine.ts
    - src/daemon/orchestrator.ts
decisions:
  - "Semantic failure (status: FAILED) is always FATAL — no retry, because FAILED means the bead's job failed, not a transient schema issue"
  - "Recurring tasks skip bead close entirely — their IDs are NightShift-generated, not bead IDs"
metrics:
  duration: "38s"
  completed_date: "2026-03-11"
---

# Quick Task 13: Fix Preflight/Submit Failure Not Halting Pipeline

**One-liner:** Added bead semantic failure detection (status FAILED → pipeline FATAL) and origin-aware bead close guard (recurring tasks skip bead operations).

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Detect semantic failure in bead output | def9959 | src/agent/engine.ts |
| 2 | Guard bead close against recurring tasks | 8a19d4b | src/daemon/orchestrator.ts |

## What Was Built

### Task 1: Semantic failure detection (engine.ts)

After schema validation succeeds in the bead execution loop, a new check inspects the parsed output for `status: "FAILED"`. When found:

1. The SUCCESS entry just pushed to `perBead` is overwritten with FAILED
2. All remaining beads are marked SKIPPED
3. Engine logs the failure with output preview
4. Bead output is written to disk before returning
5. Pipeline returns `FATAL` status with `failedBeadIndex` and error message

This check runs before the retry logic. A bead with `status: "FAILED"` causes a hard stop — no retry is attempted because FAILED means the bead's job failed semantically, not that it should be retried.

### Task 2: Origin-aware bead close guard (orchestrator.ts)

In `handleCompleted`, the bead close block now checks `task.origin !== "recurring"` in addition to `this.beads` being set. Recurring tasks dispatched by the scheduler have NightShift-generated IDs (`ns-...`), not bead IDs, so calling `beads.close` on them always fails. The fix prevents that call entirely for recurring tasks.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

### Files exist

- [x] `src/agent/engine.ts` — modified
- [x] `src/daemon/orchestrator.ts` — modified

### Commits exist

- [x] def9959 — feat(quick-13): detect semantic failure in bead output
- [x] 8a19d4b — fix(quick-13): guard bead close against recurring tasks

### TypeScript

- [x] `npx tsc --noEmit` passes with no errors

## Self-Check: PASSED
