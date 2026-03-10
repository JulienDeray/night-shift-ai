---
phase: quick-7
plan: 01
subsystem: cli
tags: [status, queue, table, tdd]
dependency_graph:
  requires: []
  provides: [task-listing-in-status]
  affects: [src/cli/commands/status.ts]
tech_stack:
  added: []
  patterns: [table-formatter, date-fns-formatDistanceToNow]
key_files:
  created: []
  modified:
    - src/cli/commands/status.ts
    - tests/integration/status.test.ts
decisions:
  - Used status "pending" OR "ready" for pending count (consistent with existing queue semantics)
  - Sort running tasks before pending, within each group sort by createdAt ascending
  - Truncate task names > 30 chars with "..."
metrics:
  duration: 5m
  completed: "2026-03-10"
  tasks_completed: 2
  files_changed: 2
---

# Phase quick-7 Plan 01: Enhance Status Command — Task Listing Summary

**One-liner:** Added individual task table to `nightshift status` showing ID, name, agent, colored status, and relative creation time for all pending/running tasks.

## What Was Built

The `nightshift status` command now displays a formatted table of all active (pending, ready, running) tasks after the aggregate counts in the Queue section. When the queue is empty, only the counts appear — no table is shown.

Table columns: `ID | Name | Agent | Status | Created`

Tasks are sorted: running first, then pending/ready, each group ordered by creation time ascending.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add failing tests for task listing in status output | 06fe73f | tests/integration/status.test.ts |
| 2 | Enhance status command to list individual tasks in a table | 7c7cb29 | src/cli/commands/status.ts |

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- src/cli/commands/status.ts: FOUND
- tests/integration/status.test.ts: FOUND
- Commit 06fe73f: FOUND
- Commit 7c7cb29: FOUND
- All 6 integration tests pass
