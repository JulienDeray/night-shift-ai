---
phase: 10-daemon-wiring-and-legacy-cleanup
plan: "01"
subsystem: daemon
tags: [agent-engine, dispatch, orchestrator, reporter, run-logger, types]
dependency_graph:
  requires: []
  provides:
    - AgentPool dispatches via AgentEngine (not AgentRunner)
    - AgentRunResult native throughout daemon (orchestrator, reporter, run-logger)
    - Fallback category dispatch on NO_IMPROVEMENT
    - JSONL run log as agent-agnostic post-run hook
  affects:
    - src/daemon/agent-pool.ts
    - src/daemon/orchestrator.ts
    - src/inbox/reporter.ts
    - src/agent/run-logger.ts
    - src/core/types.ts
    - src/core/config.ts
tech_stack:
  added: []
  patterns:
    - AgentEngine + BeadRegistry + plugins created fresh per dispatch
    - JSONL logging as best-effort post-run hook (caught, logged)
    - Fallback category re-dispatch via pool.dispatch(fallbackTask) on NO_IMPROVEMENT
key_files:
  created: []
  modified:
    - src/core/types.ts
    - src/core/config.ts
    - src/daemon/agent-pool.ts
    - src/daemon/orchestrator.ts
    - src/inbox/reporter.ts
    - src/agent/run-logger.ts
    - tests/unit/agent-pool.test.ts
    - tests/unit/orchestrator.test.ts
    - tests/unit/reporter.test.ts
    - tests/unit/run-logger.test.ts
decisions:
  - AgentEngine + BeadRegistry created fresh per dispatch (not stored per-task — engine is stateless)
  - Tasks without agentName push FATAL AgentRunResult synchronously to completedQueue (no async rejection)
  - fallback_categories uses snake_case on AgentDeclaration to match YAML convention (not camelCase)
  - totalCostUsd field kept on DaemonState (zero, no accumulation) for backward compat with status command
  - Fallback dispatch only when pool.canAccept() — no queueing of fallback tasks if pool is full
metrics:
  duration_minutes: 5
  completed_date: "2026-03-03"
  tasks_completed: 2
  files_modified: 10
---

# Phase 10 Plan 01: Daemon Wiring and Type Migration Summary

**One-liner:** Wire AgentPool.dispatch() to AgentEngine with BeadRegistry plugins, adopt AgentRunResult natively across orchestrator/reporter/run-logger, and implement fallback category dispatch on NO_IMPROVEMENT.

## What Was Built

**Task 1 — Core wiring and type migration:**

- Deleted `AgentExecutionResult` and `ClaudeJsonOutput` from `src/core/types.ts` — old flat result format is gone
- Added `variables?: Record<string, string>` to `NightShiftTask` for per-task configOverrides passed to engine
- Added `fallback_categories?: string[]` to `AgentDeclaration` and `AgentDeclarationSchema`
- Updated `InboxEntry`: removed `costUsd`/`numTurns`, added `agentName`/`beadCount`
- Rewrote `agent-pool.ts`: AgentEngine + BeadRegistry (standard + git-clone plugins) created fresh per dispatch; tasks without `agentName` are rejected immediately with a FATAL `AgentRunResult`; `killAll()` logs a warning (engine runs cannot be interrupted)
- Updated `reporter.ts`: accepts `AgentRunResult`, generates per-bead markdown table, no cost fields, derives status from `result.status`
- Updated `run-logger.ts`: `agent_name`/`final_output` fields replace `category`/`mr_url`/`cost_usd`, writes to `agent-runs.jsonl`

**Task 2 — Orchestrator bridging and test rewrites:**

- Updated `orchestrator.ts`: reads `AgentRunResult` fields (`status`, `totalDurationMs`); JSONL logging as best-effort post-run hook via `appendRunLog`; fallback category dispatch when `beadOutputs.analyze.result === "NO_IMPROVEMENT"`; `notifyTaskStart` uses `agentName`; `notifyTaskEnd` uses status/error/finalOutput
- `AgentPool` constructor now accepts `agentsDir` from config (passed through from orchestrator)
- Rewrote all 4 test files to use `AgentRunResult`: agent-pool (mock AgentEngine, test agentName rejection), orchestrator (NightShiftConfig with agents/schedule/agentsDir), reporter (per-bead lines, no cost), run-logger (new field names, agent-runs.jsonl)

## Test Results

```
Test Files  4 passed (4)
     Tests  60 passed (60)
```

## Deviations from Plan

None — plan executed exactly as written. Legacy files (`agent-runner.ts`, `bead-runner.ts`, `code-agent.ts`, `code-agent-runner.ts`) still reference deleted types — this is expected and handled in Plan 02.

## Self-Check: PASSED

All files created/modified exist on disk. Both task commits verified (eab696e, 5c2a209).
