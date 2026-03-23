---
phase: quick-17
plan: 01
subsystem: daemon
tags: [scheduler, orchestrator, agent-pool, bug-fix]
dependency_graph:
  requires: []
  provides: [task-drop-protection, tick-order-fix]
  affects: [src/daemon/scheduler.ts, src/daemon/orchestrator.ts]
tech_stack:
  added: []
  patterns: [confirm-dispatch-pattern, fifo-pending-priority]
key_files:
  created:
    - tests/unit/orchestrator-tick.test.ts
  modified:
    - src/daemon/scheduler.ts
    - src/daemon/orchestrator.ts
    - tests/unit/scheduler.test.ts
    - tests/unit/orchestrator.test.ts
decisions:
  - Pending (unconfirmed) tasks use FIFO priority over newly due tasks
  - Re-emit pending tasks with same ID rather than creating new task objects
metrics:
  duration: 12m
  completed: 2026-03-23
---

# Quick Task 17: Fix Silent Task Dropping When Agent Pool Is Full

Scheduler confirmDispatched pattern with FIFO pending priority preventing task loss when pool capacity is exceeded.

## What Changed

### Root Cause

Two bugs in the daemon tick cycle caused scheduled tasks to be silently lost:

1. **`evaluateSchedules()` updated `lastRuns` immediately** for all due tasks, before the orchestrator checked pool capacity. Tasks that could not be dispatched (pool full) had their `lastRuns` already recorded, so they were permanently skipped on subsequent ticks.

2. **Completed tasks were collected AFTER dispatching new ones**, meaning freed pool slots were not available until the next tick.

### Fix Applied

**Scheduler (`src/daemon/scheduler.ts`):**
- `evaluateSchedules()` no longer updates `lastRuns` for due tasks. Instead, it tracks them in a `pendingKeys` map (taskId to state key + timestamp).
- New `confirmDispatched(taskIds)` method updates `lastRuns` and saves state only for confirmed task IDs.
- Unconfirmed tasks are re-emitted on subsequent `evaluateSchedules()` calls with their original task ID.
- Pending tasks are returned before newly due tasks (FIFO ordering) to ensure the oldest undispatched tasks get priority.

**Orchestrator (`src/daemon/orchestrator.ts`):**
- Reordered tick phases: collect completed tasks FIRST (frees pool slots), then evaluate schedules, then poll file queue.
- After the dispatch loop, calls `confirmDispatched()` with only the IDs of tasks that were actually dispatched.

## Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 (RED) | Failing tests for confirmDispatched | `2db2deb` | tests/unit/scheduler.test.ts |
| 1 (GREEN) | Fix scheduler + orchestrator | `f697fde` | src/daemon/scheduler.ts, src/daemon/orchestrator.ts, tests/unit/scheduler.test.ts |
| 2 | Orchestrator-tick integration test | `b71325e` | tests/unit/orchestrator-tick.test.ts, tests/unit/orchestrator.test.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FIFO priority for pending tasks**
- **Found during:** Task 2
- **Issue:** When pool capacity is 1 and multiple agents are scheduled, the same agent (first in config order) would always be dispatched because newly due tasks appeared before pending ones in the return array.
- **Fix:** Split return array into pending (re-emitted) and new tasks, sort pending by insertion time (FIFO), return pending before new.
- **Files modified:** src/daemon/scheduler.ts
- **Commit:** b71325e

**2. [Rule 3 - Blocking] Mock scheduler in orchestrator.test.ts missing confirmDispatched**
- **Found during:** Task 2
- **Issue:** Existing orchestrator unit tests used a mock scheduler without the new `confirmDispatched` method, causing 11 test failures.
- **Fix:** Added `confirmDispatched: vi.fn().mockResolvedValue(undefined)` to both mock scheduler objects.
- **Files modified:** tests/unit/orchestrator.test.ts
- **Commit:** b71325e

## Verification

- 339 unit tests pass (22 test files)
- TypeScript compiles with no errors
- Integration tests pass individually (flaky when run in parallel, pre-existing issue)
