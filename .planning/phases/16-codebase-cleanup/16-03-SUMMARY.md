---
phase: 16-codebase-cleanup
plan: 03
subsystem: agent
tags: [typescript, cleanup, dead-code, refactor]

# Dependency graph
requires:
  - phase: 16-02
    provides: collapsed NightShiftError hierarchy with NightShiftErrorCode union
provides:
  - agent-types.ts deleted; validateAgentName inlined into scaffold.ts as private function
  - NightShiftTask.category field removed (never set or read at runtime)
  - NightShiftTask.maxBudgetUsd field removed (never consumed at runtime)
  - OneOffDefaults.maxBudgetUsd removed; max_budget_usd removed from Zod ConfigSchema
  - Stale comments referencing code-agent-runner.ts and agent-runner.ts removed
affects: [future-agent-features, config-schema]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Private helper functions in module scope (not exported unless needed externally)"
    - "Zod .strict() enforces no unknown fields in config YAML"

key-files:
  created: []
  modified:
    - src/agent/scaffold.ts
    - src/agent/engine-types.ts
    - src/agent/step-runner.ts
    - src/core/types.ts
    - src/core/config.ts
  deleted:
    - src/agent/agent-types.ts

key-decisions:
  - "validateAgentName made private (non-exported) in scaffold.ts — only scaffold.ts consumed it"
  - "maxBudgetUsd removed from NightShiftTask, OneOffDefaults, and Zod ConfigSchema — no runtime code reads or passes this value; default config YAML template also cleaned"

patterns-established:
  - "Dead exports: delete entire file rather than leaving stub"

requirements-completed: [CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04]

# Metrics
duration: 15min
completed: 2026-03-13
---

# Phase 16 Plan 03: Codebase Cleanup (Final Pass) Summary

**agent-types.ts deleted; validateAgentName inlined as private function; NightShiftTask.category and maxBudgetUsd removed; Zod max_budget_usd field removed; stale v1.0/v2.0 comments scrubbed from engine-types.ts and step-runner.ts**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-13T16:50:00Z
- **Completed:** 2026-03-13T17:05:00Z
- **Tasks:** 2
- **Files modified:** 12 (1 deleted, 5 src modified, 7 test files updated)

## Accomplishments
- Deleted `src/agent/agent-types.ts` — 60-line file of dead exports; moved `validateAgentName` into scaffold.ts as a private function (only consumer)
- Removed stale comments in `engine-types.ts` (references to `code-agent-runner.ts` and `agent-types.ts`) and `step-runner.ts` (reference to `agent-runner.ts`)
- Removed three dead fields: `NightShiftTask.category`, `NightShiftTask.maxBudgetUsd`, `OneOffDefaults.maxBudgetUsd`
- Removed `max_budget_usd` from Zod ConfigSchema, mapConfig, and default config YAML template
- All 389 tests pass with no regressions

## Task Commits

1. **Task 1: Move validateAgentName into scaffold.ts, delete agent-types.ts** - `a9fbd80` (refactor)
2. **Task 2: Remove stale comments, dead type fields, and vestigial Zod fields** - `27b50ef` (refactor)

## Files Created/Modified
- `src/agent/scaffold.ts` - Added private `validateAgentName` function, removed import from agent-types
- `src/agent/engine-types.ts` - Removed stale comment referencing deleted code-agent-runner.ts and agent-types.ts
- `src/agent/step-runner.ts` - Removed stale comment referencing deleted agent-runner.ts
- `src/core/types.ts` - Removed `NightShiftTask.category`, `NightShiftTask.maxBudgetUsd`, `OneOffDefaults.maxBudgetUsd`; cleaned agentName comment
- `src/core/config.ts` - Removed `max_budget_usd` from Zod schema, mapConfig, and default YAML template
- `src/agent/agent-types.ts` - DELETED (AgentConfig, PipelineContext, AgentRunOutcome, AgentRunResult, HandoffPayload were all dead exports)
- `tests/unit/config.test.ts` - Removed `maxBudgetUsd` assertion
- `tests/unit/orchestrator.test.ts` - Removed `maxBudgetUsd` from makeConfig fixture
- `tests/integration/inbox.test.ts`, `schedule.test.ts`, `submit.test.ts`, `status.test.ts`, `run.test.ts`, `cancel.test.ts` - Removed `max_budget_usd: 5.00` from YAML config fixtures

## Decisions Made
- `validateAgentName` made private (non-exported) in scaffold.ts — only scaffold.ts was its consumer, no tests imported it directly
- `maxBudgetUsd` removed entirely: no runtime code ever reads `.maxBudgetUsd` from `NightShiftTask` or `oneOffDefaults`, the field was a v1.0 vestige that never got wired to the Claude CLI `--max-budget-usd` arg

## Deviations from Plan

None - plan executed exactly as written. The `maxBudgetUsd` audit confirmed it dead and it was removed as planned.

## Issues Encountered

None — TypeScript compiled cleanly at each step, all 389 tests passed after final changes.

## Next Phase Readiness
- Phase 16 (Codebase Cleanup) complete — all 3 plans finished
- Phase 17 can proceed: codebase is clean with no dead exports, stale comments, or vestigial fields

---
*Phase: 16-codebase-cleanup*
*Completed: 2026-03-13*
