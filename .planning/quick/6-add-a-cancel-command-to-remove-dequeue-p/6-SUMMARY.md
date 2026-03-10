---
phase: quick-6
plan: "01"
subsystem: cli
tags: [cancel, cli, queue, tdd]
dependency_graph:
  requires: []
  provides: [cancel-command]
  affects: [cli-index, file-queue, beads-queue]
tech_stack:
  added: []
  patterns: [commander-js, tdd-red-green]
key_files:
  created:
    - src/cli/commands/cancel.ts
    - tests/integration/cancel.test.ts
  modified:
    - src/cli/index.ts
decisions:
  - Cancel only removes pending/ready tasks; running tasks get a clear error
  - Beads mode uses beads.close() with get() pre-check to detect already-closed state
metrics:
  duration: "~3 minutes"
  completed: "2026-03-10"
---

# Phase quick-6 Plan 01: Cancel Command Summary

**One-liner:** `nightshift cancel <task-id>` removes pending file-based tasks by ID and closes beads in beads mode.

## What Was Built

Added a `cancel` command to the Night Shift CLI that allows users to retract submitted tasks before the daemon picks them up.

### Command behavior

- **File-based queue:** Reads `{taskId}.json` from `.nightshift/queue/`, checks status, deletes the file if pending/ready, prints success with task name and ID.
- **Beads mode:** Calls `beads.get()` to validate the bead exists and is open, then calls `beads.close()`.
- **Error cases:** Non-existent task ID (exits non-zero, "not found" message), already-running task (exits non-zero, "running" in message), already-closed bead.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| RED | Add failing integration tests | b0909cc | tests/integration/cancel.test.ts |
| GREEN | Implement cancel command | ab7f961 | src/cli/commands/cancel.ts, src/cli/index.ts |

## Verification

- `npx vitest run tests/integration/cancel.test.ts` — 5/5 tests pass
- `npx tsx bin/nightshift.ts cancel --help` — shows `<task-id>` argument
- `npx tsc --noEmit` — no type errors

## Deviations from Plan

None — plan executed exactly as written.
