---
phase: quick
plan: 1
subsystem: daemon
tags: [code-agent, dispatch, agent-pool, orchestrator, routing]
dependency_graph:
  requires: [src/agent/code-agent.ts, src/agent/types.ts]
  provides: [code-agent dispatch path in daemon]
  affects: [src/daemon/agent-pool.ts, src/daemon/orchestrator.ts, src/core/types.ts, src/daemon/scheduler.ts]
tech_stack:
  added: []
  patterns: [conditional dispatch, result adaptation, hot-reload propagation]
key_files:
  created: []
  modified:
    - src/core/types.ts
    - src/daemon/scheduler.ts
    - src/daemon/agent-pool.ts
    - src/daemon/orchestrator.ts
    - tests/unit/agent-pool.test.ts
decisions:
  - "Use runner: null for code-agent RunningTask entries; guard killAll() with null check"
  - "configDir defaults to process.cwd() in AgentPool to keep constructor optional"
  - "Hot-reload in tick() propagates codeAgent config updates to pool via updateCodeAgentConfig()"
metrics:
  duration: 160s
  completed: "2026-02-25"
  tasks_completed: 3
  files_modified: 5
---

# Quick Task 1: Wire runCodeAgent into Daemon Summary

**One-liner:** Conditional dispatch in AgentPool routes tasks named "code-agent" through the full 4-bead runCodeAgent pipeline instead of the generic AgentRunner.

## What Was Done

Wired the existing `runCodeAgent` entry point into the daemon's task dispatch path. Previously, all tasks — including code-agent recurring tasks — went through `AgentRunner` (a single `claude -p` invocation). Now, tasks with `isCodeAgent: true` go through `runCodeAgent`, which runs the full clone-analyze-implement-verify-MR-log pipeline.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add isCodeAgent flag to NightShiftTask and set in Scheduler | 03cbb9c | src/core/types.ts, src/daemon/scheduler.ts |
| 2 | Route code-agent tasks through runCodeAgent in AgentPool | ad007b1 | src/daemon/agent-pool.ts, src/daemon/orchestrator.ts, tests/unit/agent-pool.test.ts |
| 3 | Verify full test suite and TypeScript compilation | (verified) | — |

## Changes Made

### src/core/types.ts
Added `isCodeAgent?: boolean` field to `NightShiftTask` interface, placed after `category`.

### src/daemon/scheduler.ts
Set `isCodeAgent: recurring.name === "code-agent" && !!this.config.codeAgent` in `createTask()`. Only the recurring task named "code-agent" gets flagged, and only when `codeAgent` config exists.

### src/daemon/agent-pool.ts
- Imported `runCodeAgent` from `"../agent/code-agent.js"` and `parseTimeout` from `"../utils/process.js"`
- Added `codeAgentConfig?: CodeAgentConfig` and `configDir: string` to constructor options
- Added dispatch branch: if `task.isCodeAgent && this.codeAgentConfig`, routes through `runCodeAgentTask()`
- Added private `runCodeAgentTask()` method that calls `runCodeAgent`, adapts `CodeAgentRunResult` to `AgentExecutionResult`, and handles errors
- Added private `formatCodeAgentResult()` for human-readable result strings
- Added public `updateCodeAgentConfig()` for hot-reload support
- Guarded `killAll()` to skip null runners (code-agent tasks don't have an `AgentRunner`)

### src/daemon/orchestrator.ts
- Imported `getConfigPath` from paths module
- Passed `codeAgentConfig` and `configDir` to `AgentPool` constructor in `start()`
- Called `pool.updateCodeAgentConfig(freshConfig.codeAgent)` in `tick()` hot-reload block

### tests/unit/agent-pool.test.ts
Added `vi.mock` for `"../../src/agent/code-agent.js"` and 6 new tests in `"code-agent dispatch"` describe block covering:
1. Code-agent routing when `isCodeAgent=true` and `codeAgentConfig` provided
2. Fallback to AgentRunner for tasks without `isCodeAgent`
3. Fallback to AgentRunner when `codeAgentConfig` is undefined
4. Error propagation: `isError=true` when `runCodeAgent` throws
5. `MR_CREATED` result formatting with MR URL
6. `NO_IMPROVEMENT` result formatting with reason

## Verification

- `npx tsc --noEmit`: zero errors
- `npx vitest run`: 244 tests passed (21 test files), including 6 new code-agent dispatch tests

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/core/types.ts` modified with `isCodeAgent` field: FOUND
- `src/daemon/scheduler.ts` modified with `isCodeAgent` assignment: FOUND
- `src/daemon/agent-pool.ts` with runCodeAgent dispatch: FOUND
- `src/daemon/orchestrator.ts` with codeAgentConfig wiring: FOUND
- `tests/unit/agent-pool.test.ts` with 6 new tests: FOUND
- Commit 03cbb9c (Task 1): FOUND
- Commit ad007b1 (Task 2): FOUND
- All 244 tests pass: CONFIRMED
