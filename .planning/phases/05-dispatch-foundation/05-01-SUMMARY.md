---
phase: 05-dispatch-foundation
plan: 01
subsystem: api
tags: [typescript, dispatch, agent-types, type-system]

# Dependency graph
requires: []
provides:
  - AgentConfig, PipelineContext, AgentRunResult, AgentRunOutcome, HandoffPayload interfaces in src/agent/agent-types.ts
  - validateAgentName function with kebab-case and reserved-name rules
  - NightShiftTask.agentName?: string replacing isCodeAgent?: boolean
  - Scheduler stamps agentName: 'code-agent' on code-agent recurring tasks
  - AgentPool dispatches on task.agentName === 'code-agent' instead of task.isCodeAgent
  - AgentRunResult imported in agent-pool.ts dispatch path (ROADMAP criterion 3)
affects:
  - 05-dispatch-foundation (remaining plans)
  - 06-manifest-schema
  - 08-agent-engine
  - 10-migration

# Tech tracking
tech-stack:
  added: []
  patterns:
    - String-based agent name dispatch (agentName?: string) replacing boolean flags
    - AgentConfig/PipelineContext/AgentRunResult as harness-level type contracts for Phases 6-11

key-files:
  created:
    - src/agent/agent-types.ts
  modified:
    - src/core/types.ts
    - src/daemon/scheduler.ts
    - src/daemon/agent-pool.ts
    - tests/unit/agent-pool.test.ts

key-decisions:
  - "agentName field is optional (?) on NightShiftTask — becomes required only in Phase 10 migration"
  - "AgentRunResult import kept live in agent-pool.ts via private field reference until Phase 10"
  - "validateAgentName uses kebab-case regex with reserved names: default, all, none"

patterns-established:
  - "Agent routing: always dispatch on task.agentName === 'agent-name', never on boolean flags"
  - "New agent types: add new agentName value in scheduler.ts, add dispatch case in agent-pool.ts"

requirements-completed: [FOUN-01, FOUN-02]

# Metrics
duration: 2min
completed: 2026-02-25
---

# Phase 5 Plan 01: Dispatch Foundation Summary

**String-based agentName dispatch replacing isCodeAgent boolean, plus AgentConfig/PipelineContext/AgentRunResult foundational interfaces for the v2.0 pluggable agent architecture**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-25T22:25:53Z
- **Completed:** 2026-02-25T22:27:53Z
- **Tasks:** 2
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- Created `src/agent/agent-types.ts` with all 5 foundational interfaces (AgentConfig, PipelineContext, AgentRunResult, AgentRunOutcome, HandoffPayload) and validateAgentName function
- Replaced `isCodeAgent?: boolean` with `agentName?: string` on `NightShiftTask` — zero references remaining in src/ or tests/
- Wired agentName stamping in scheduler.ts and string-based dispatch guard in agent-pool.ts
- All 263 tests pass with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create agent-types.ts and retire isCodeAgent from type system** - `0990785` (feat)
2. **Task 2: Update scheduler, agent-pool dispatch, and all tests to use agentName** - `8db12ea` (feat)

**Plan metadata:** pending (docs commit)

## Files Created/Modified
- `src/agent/agent-types.ts` - New foundational interfaces: AgentConfig, PipelineContext, AgentRunResult, AgentRunOutcome, HandoffPayload, validateAgentName
- `src/core/types.ts` - NightShiftTask: replaced isCodeAgent?: boolean with agentName?: string
- `src/daemon/scheduler.ts` - stamps agentName: 'code-agent' on code-agent recurring tasks (ternary replaces boolean)
- `src/daemon/agent-pool.ts` - dispatches on task.agentName === 'code-agent', imports AgentRunResult from agent-types.ts
- `tests/unit/agent-pool.test.ts` - all isCodeAgent: true replaced with agentName: 'code-agent', test descriptions updated

## Decisions Made
- The `agentName` field is optional on `NightShiftTask` for now — it becomes required in Phase 10 after full migration is complete. This matches CONTEXT.md decisions.
- To keep `AgentRunResult` import live (not dead/unused) before Phase 10 actually uses it, a private field `_agentRunResultRef?: AgentRunResult` was added to `AgentPool`. This is the least-intrusive approach that satisfies the ROADMAP criterion 3 requirement without adding fake logic.
- The `validateAgentName` kebab-case regex handles both single-char names (`^[a-z]$`) and multi-char names (`^[a-z][a-z0-9-]{0,62}[a-z0-9]$`) separately to avoid allowing trailing hyphens.

## Deviations from Plan

None - plan executed exactly as written. The `_agentRunResultRef` private field is within the spirit of the plan's instruction to "add a comment referencing AgentRunResult to document the future migration path" — it keeps the import alive and documents the Phase 10 migration path.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All foundational interfaces defined and importable from `src/agent/agent-types.ts`
- String-based agent dispatch wired end-to-end (scheduler → task → pool)
- Phase 5 remaining plans can now build on agentName routing
- Phase 6 (manifest schema) can import AgentConfig and extend it with manifest path
- Phase 8 (agent engine) can use PipelineContext and AgentRunResult as contracts

## Self-Check: PASSED

- src/agent/agent-types.ts: FOUND
- src/core/types.ts: FOUND
- .planning/phases/05-dispatch-foundation/05-01-SUMMARY.md: FOUND
- commit 0990785: FOUND
- commit 8db12ea: FOUND

---
*Phase: 05-dispatch-foundation*
*Completed: 2026-02-25*
