---
phase: quick-5
plan: "01"
subsystem: cli
tags: [cli, agent-execution, submit, sync, refactor]
dependency_graph:
  requires: []
  provides: [sync-submit-flag, shared-run-agent-helper]
  affects: [src/cli/commands/submit.ts, src/cli/commands/run.ts]
tech_stack:
  added: []
  patterns: [shared-helper-extraction, tdd]
key_files:
  created:
    - src/cli/commands/_run-agent.ts
  modified:
    - src/cli/commands/submit.ts
    - src/cli/commands/run.ts
    - tests/integration/submit.test.ts
decisions:
  - "Shared helper _run-agent.ts takes explicit NtfyConfig rather than re-loading config internally, so callers control config loading"
  - "generateTaskId() extracted into helper to keep crypto import out of run.ts while avoiding duplication"
  - "submit --sync reuses task.id (which may be a bead ID if beads.enabled) rather than generating a new ID for the engine run"
metrics:
  duration: "~8 minutes"
  completed_date: "2026-03-10"
  tasks_completed: 1
  files_changed: 4
---

# Quick Task 5: Add Synchronous Agent Execution Support

**One-liner:** `--sync` flag on `nightshift submit` queues the task and immediately executes the agent in the foreground using a new shared `runAgentForeground()` helper extracted from `run.ts`.

## Objective

Add a `-s/--sync` flag to `nightshift submit` so users can watch agent execution in real-time rather than queueing and checking status later. Eliminate code duplication between `run.ts` and `submit.ts` by extracting the engine setup and result display into a shared helper.

## Tasks Completed

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| 1 | Add --sync flag to submit command (TDD) | 341b70c, 19d9576 | Done |

## Implementation Details

### Shared Helper: `src/cli/commands/_run-agent.ts`

Extracted ~100 lines of agent execution logic from `run.ts` into a reusable `runAgentForeground()` function. The helper handles:
- Loading config and creating CLI logger
- Setting up ntfy client if notify is requested
- Building agent paths from config
- Creating BeadRegistry with standard and git-clone plugins
- Calling `AgentEngine.run()`
- Displaying per-bead results with status and duration
- Printing final summary (agent name, duration, result preview)
- Setting `process.exitCode = 1` if agent status is not SUCCESS

Also exports `generateTaskId()` for consistent task ID generation.

### Updated `submit.ts`

Added `-s, --sync` option. When set:
1. Queues the task as before (file or bead)
2. After queuing, calls `runAgentForeground()` with the task's ID

Without `--sync`, behavior is unchanged.

### Refactored `run.ts`

Reduced from ~140 lines to ~55 lines by delegating entirely to `runAgentForeground()`.

## Test Results

```
Test Files  32 passed (32)
Tests       412 passed (412)
```

New tests added (4):
- `--sync flag is accepted (appears in help output)`
- `without --sync, submit still queues normally and does not run agent`
- `with --sync and non-existent agent, exits non-zero with an error message`
- `with --sync, prints 'Running agent' to indicate synchronous execution started`

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check

- [x] `src/cli/commands/_run-agent.ts` created
- [x] `src/cli/commands/submit.ts` modified with --sync flag
- [x] `src/cli/commands/run.ts` refactored to use helper
- [x] `tests/integration/submit.test.ts` has 4 new --sync tests
- [x] All 412 tests pass
- [x] `npm run typecheck` passes clean
