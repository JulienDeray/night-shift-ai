---
phase: 07-config-schema-migration-and-startup-validation
plan: 01
subsystem: config
tags: [zod, yaml, config-schema, croner, agents, schedule, types]

requires:
  - phase: 06-plugin-interfaces-and-manifest-schema
    provides: manifest loader, agent template system established in phase 6

provides:
  - AgentDeclarationSchema and ScheduleEntrySchema in src/core/config.ts
  - NightShiftConfig with agents, schedule, agentsDir fields in src/core/types.ts
  - ConfigSchema with .strict() (rejects old keys) and .superRefine() cross-validations
  - mapConfig() updated for new model
  - getDefaultConfigYaml() updated to show agents+schedule format
  - All daemon and CLI modules free of recurring/codeAgent references
  - 21 unit tests covering the new schema

affects:
  - 07-02 startup-validation (uses new NightShiftConfig shape)
  - 08-agent-engine (imports AgentDeclaration, ScheduleEntry types)
  - 10-scheduling-wiring (will fill in scheduler.evaluateSchedules() stub)

tech-stack:
  added: []
  patterns:
    - "Zod .strict() on ConfigSchema for clean-break migration — old YAML keys rejected immediately"
    - ".superRefine() used for cross-entity validation (duplicates, agent refs, cron validity)"
    - "Agent-specific types (CodeAgentConfig, CategoryScheduleConfig) moved to src/agent/types.ts"

key-files:
  created: []
  modified:
    - src/core/types.ts
    - src/core/config.ts
    - src/daemon/orchestrator.ts
    - src/daemon/agent-pool.ts
    - src/daemon/scheduler.ts
    - src/cli/commands/schedule.ts
    - src/cli/commands/run.ts
    - src/agent/types.ts
    - src/agent/code-agent-runner.ts
    - src/agent/code-agent.ts
    - tests/unit/config.test.ts

key-decisions:
  - "CodeAgentConfig and CategoryScheduleConfig moved to src/agent/types.ts (not deleted) — code-agent pipeline still compiles"
  - "resolveCategory() moved inline to code-agent-runner.ts — removed from scheduler since scheduler no longer iterates recurring tasks"
  - "scheduler.evaluateSchedules() returns [] stub — Phase 10 will wire the new schedule format"
  - "Tasks 1 and 2 committed together since Task 1 alone does not compile (daemon/CLI files reference removed types)"

patterns-established:
  - "Config migration pattern: .strict() rejects legacy keys; .superRefine() validates cross-entity invariants"
  - "Legacy agent code (code-agent pipeline) isolated in src/agent/ with its own type definitions"

requirements-completed:
  - MIGR-02

duration: 4min
completed: 2026-02-26
---

# Phase 7 Plan 01: Config Schema Migration Summary

**Zod ConfigSchema rewritten to agents+schedule model with .strict() rejection of old keys and .superRefine() cross-validation (duplicate names, unknown agent refs, invalid cron expressions)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-26T16:25:53Z
- **Completed:** 2026-02-26T16:30:06Z
- **Tasks:** 3 (Tasks 1+2 batched, Task 3)
- **Files modified:** 11

## Accomplishments
- NightShiftConfig now has `agents: AgentDeclaration[]`, `schedule: ScheduleEntry[]`, `agentsDir: string` — old `recurring` and `codeAgent` fields gone from core types
- ConfigSchema enforces `.strict()` so any nightshift.yaml with `code_agent:` or `recurring:` keys is immediately rejected with a Zod "Unrecognized key" error
- Three cross-entity validations via `.superRefine()`: duplicate agent names, schedule referencing unknown agent, invalid cron expressions in enabled entries
- All daemon and CLI modules (orchestrator, agent-pool, scheduler, schedule command, run command) updated — zero references to removed fields
- 21 tests pass covering all schema validation rules including strict rejection, cross-validation, and kebab-case enforcement

## Task Commits

Each task was committed atomically:

1. **Tasks 1+2: Rewrite schema/types and update daemon/CLI** - `4c04e02` (feat)
2. **Task 3: Rewrite config.test.ts** - `39bfc08` (test)

## Files Created/Modified
- `src/core/types.ts` - Removed CodeAgentConfig/RecurringTaskConfig/CategoryScheduleConfig; added AgentDeclaration, ScheduleEntry; updated NightShiftConfig
- `src/core/config.ts` - Rewrote ConfigSchema with AgentDeclarationSchema, ScheduleEntrySchema, .strict(), .superRefine(); updated mapConfig() and getDefaultConfigYaml()
- `src/daemon/orchestrator.ts` - Removed codeAgentConfig from pool constructor; updated logging; removed hot-reload of recurring/codeAgent
- `src/daemon/agent-pool.ts` - Removed CodeAgentConfig import, code-agent dispatch path, runCodeAgentTask/formatCodeAgentResult methods
- `src/daemon/scheduler.ts` - Removed RecurringTaskConfig/CategoryScheduleConfig imports, DAYS constant, resolveCategory, isDue/createTask methods; evaluateSchedules() returns [] stub
- `src/cli/commands/schedule.ts` - Updated to show config.schedule entries with agent/cron/enabled/notify/nextRun columns
- `src/cli/commands/run.ts` - Removed --code-agent flag and code-agent execution path
- `src/agent/types.ts` - Added CodeAgentConfig and CategoryScheduleConfig (moved from core types)
- `src/agent/code-agent-runner.ts` - Updated import, inlined resolveCategory() function
- `src/agent/code-agent.ts` - Updated CodeAgentConfig import to come from ./types.js
- `tests/unit/config.test.ts` - Full rewrite: 21 tests for new schema

## Decisions Made
- `CodeAgentConfig` and `CategoryScheduleConfig` moved to `src/agent/types.ts` rather than deleted — the code-agent pipeline (`src/agent/code-agent.ts`, `code-agent-runner.ts`) still exists and must compile. Phase 10 will remove or repurpose these.
- `resolveCategory()` moved inline to `code-agent-runner.ts` — it was exported from scheduler.ts purely for code-agent's benefit; removing it from scheduler is correct since scheduler no longer iterates recurring tasks.
- Tasks 1 and 2 were committed together in one commit because Task 1 (types.ts + config.ts) does not produce a clean compile on its own — daemon/CLI files immediately reference the removed types and fail tsc.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Moved CodeAgentConfig/CategoryScheduleConfig to src/agent/types.ts**
- **Found during:** Task 2 (TypeScript compile after Task 1 changes)
- **Issue:** `code-agent.ts` and `code-agent-runner.ts` import `CodeAgentConfig` from `../core/types.js` which was removed; `code-agent-runner.ts` imports `resolveCategory` from `../daemon/scheduler.js` which was also removed. Both files must still compile since the code-agent pipeline is not deleted in Phase 7.
- **Fix:** Added `CodeAgentConfig` and `CategoryScheduleConfig` to `src/agent/types.ts` (keeping them as agent-local types); updated imports in `code-agent.ts` and `code-agent-runner.ts`; inlined `resolveCategory()` into `code-agent-runner.ts`.
- **Files modified:** src/agent/types.ts, src/agent/code-agent-runner.ts, src/agent/code-agent.ts
- **Verification:** `npx tsc --noEmit` produces zero errors
- **Committed in:** 4c04e02 (Task 1+2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - Blocking)
**Impact on plan:** Necessary to maintain compile integrity for the existing code-agent pipeline which is not removed in Phase 7. No scope creep — the fix is minimal (type relocation, not new functionality).

## Issues Encountered
- None beyond the blocking import issue documented above.

## Next Phase Readiness
- NightShiftConfig shape is finalized — Phase 07-02 (startup validation) can now add config validation on daemon boot using `validateConfig()` and the new schema.
- The `agents` and `schedule` arrays are loaded and typed but not yet acted upon — Phase 10 will wire `scheduler.evaluateSchedules()` to dispatch agents from the schedule.
- The code-agent pipeline (`src/agent/`) still compiles and is usable, but is no longer plumbed through the config layer — it's isolated for Phase 10 migration.

---
*Phase: 07-config-schema-migration-and-startup-validation*
*Completed: 2026-02-26*
