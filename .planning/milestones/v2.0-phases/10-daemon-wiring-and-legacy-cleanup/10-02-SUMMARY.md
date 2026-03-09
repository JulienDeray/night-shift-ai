---
phase: 10-daemon-wiring-and-legacy-cleanup
plan: "02"
subsystem: daemon
tags: [scheduler, croner, cli, agentengine, legacy-cleanup]

requires:
  - phase: 10-daemon-wiring-and-legacy-cleanup
    provides: AgentPool.dispatch() routing to AgentEngine, task.agentName required

provides:
  - Scheduler.evaluateSchedules() reads config.schedule entries and creates NightShiftTask with agentName
  - nightshift run uses AgentEngine directly via --agent flag (no AgentRunner)
  - nightshift submit requires --agent flag and sets agentName on queued tasks
  - All legacy code-agent files and test files deleted

affects:
  - future phases using nightshift run and nightshift submit commands
  - anything importing from src/daemon/agent-runner.ts (now deleted)
  - anything importing from src/agent/code-agent.ts, code-agent-runner.ts, types.ts (deleted)

tech-stack:
  added: []
  patterns:
    - "Cron previousRuns(1, now) pattern for schedule evaluation with deduplication"
    - "State key as agent:cron — avoids collisions with v1.0 task-name keys"
    - "Schedule-level variables override agent-level via spread order: {...agent.vars, ...schedule.vars}"

key-files:
  created:
    - tests/unit/scheduler.test.ts
  modified:
    - src/daemon/scheduler.ts
    - src/cli/commands/run.ts
    - src/cli/commands/submit.ts
    - src/agent/bead-runner.ts
    - tests/integration/run.test.ts
    - tests/integration/submit.test.ts
  deleted:
    - src/daemon/agent-runner.ts
    - src/agent/code-agent.ts
    - src/agent/code-agent-runner.ts
    - src/agent/types.ts
    - tests/unit/agent-runner.test.ts
    - tests/unit/code-agent.test.ts
    - tests/unit/code-agent-runner.test.ts

key-decisions:
  - "BeadResult and ClaudeJsonOutput inlined into bead-runner.ts after types.ts was deleted — avoids any new shared file"
  - "Integration tests for run and submit completely rewritten to match new --agent-based interface"
  - "Schedule state key uses agent:cron format, which naturally avoids collision with v1.0 task-name keys"
  - "nightshift run command drops --timeout, --budget, --model, --tools options — engine reads from manifest"
  - "nightshift submit drops --budget, --model, --tools; --agent now required"

patterns-established:
  - "AgentEngine pattern: new BeadRegistry() + register plugins + new AgentEngine(registry, logger).run()"
  - "CLI --var flag: key=value pairs split on first = and merged into configOverrides"
  - "Scheduler deduplication: lastRun >= prevRun check prevents double-firing"

requirements-completed:
  - WIRE-02

duration: 25min
completed: 2026-03-03
---

# Phase 10 Plan 02: Scheduler Wiring, CLI Modernization, Legacy Cleanup Summary

**Schedule evaluation using croner against config.schedule entries, CLI commands rewritten to use AgentEngine directly, and all 4 legacy code-agent source files plus 3 test files deleted**

## Performance

- **Duration:** 25 min
- **Started:** 2026-03-03T16:15:54Z
- **Completed:** 2026-03-03T16:30:00Z
- **Tasks:** 2
- **Files modified:** 14 (6 modified, 6 deleted, 2 integration tests rewritten)

## Accomplishments

- Scheduler now evaluates `config.schedule` entries using croner's `previousRuns(1, now)` and creates `NightShiftTask` objects with `agentName` set
- `nightshift run` rewritten to use `AgentEngine` directly via `--agent <name>` flag with `--var key=value` overrides
- `nightshift submit` now requires `--agent <name>` and sets `agentName` on all queued tasks
- All legacy files deleted: `agent-runner.ts`, `code-agent.ts`, `code-agent-runner.ts`, `types.ts`, plus 3 test files
- 17 scheduler unit tests written and passing for the new config.schedule model

## Task Commits

1. **Task 1: Wire scheduler, rewrite CLI commands, delete legacy files** - `2246c26` (feat)
2. **Task 2: Write scheduler tests and run full test suite** - `474c5c2` (test)

## Files Created/Modified

- `src/daemon/scheduler.ts` - Implemented evaluateSchedules() with croner, state deduplication, variable merging
- `src/cli/commands/run.ts` - Rewritten to use AgentEngine with --agent and --var flags
- `src/cli/commands/submit.ts` - Added --agent required flag, removed --budget/--model/--tools
- `src/agent/bead-runner.ts` - Inlined BeadResult and ClaudeJsonOutput (types.ts deleted)
- `tests/unit/scheduler.test.ts` - Completely rewritten: 17 tests for new config.schedule model
- `tests/integration/run.test.ts` - Rewritten for new --agent based interface
- `tests/integration/submit.test.ts` - Rewritten for new --agent required interface
- **Deleted:** `src/daemon/agent-runner.ts`, `src/agent/code-agent.ts`, `src/agent/code-agent-runner.ts`, `src/agent/types.ts`
- **Deleted tests:** `agent-runner.test.ts`, `code-agent.test.ts`, `code-agent-runner.test.ts`

## Decisions Made

- `BeadResult` and `ClaudeJsonOutput` were inlined into `bead-runner.ts` after `types.ts` was deleted — avoids creating a new shared file for two types with no other consumers
- Integration tests for `run` and `submit` completely rewritten because the interface changed fundamentally (no `--code-agent`, `--budget`, `--model`, `--tools`; `--agent` required)
- State key uses `agent:cron` format which naturally avoids collision with v1.0 task-name keys per plan guidance
- The `nightshift run` command drops `--timeout`, `--budget`, `--model`, `--tools` options — the engine reads these from the agent manifest, not the CLI

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed bead-runner.ts to not import from deleted types.ts**
- **Found during:** Task 1 (deleting legacy files)
- **Issue:** `bead-runner.ts` imported `BeadResult` from `./types.ts` which was being deleted. Also imported `ClaudeJsonOutput` from `../core/types.js` which was never defined there (pre-existing broken import)
- **Fix:** Inlined both `BeadResult` (exported) and `ClaudeJsonOutput` (private interface) directly into `bead-runner.ts`
- **Files modified:** `src/agent/bead-runner.ts`
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** `2246c26` (Task 1 commit)

**2. [Rule 1 - Bug] Rewrote integration tests for run and submit commands**
- **Found during:** Task 1 (running test suite after CLI changes)
- **Issue:** Integration tests for `run` and `submit` tested the old interface (`--code-agent`, `--budget`, `--model`, `--tools`, no `--agent`). They would all fail after the CLI rewrite.
- **Fix:** Completely rewrote both integration test files to test the new `--agent`-based interface
- **Files modified:** `tests/integration/run.test.ts`, `tests/integration/submit.test.ts`
- **Verification:** Both test files pass when run individually
- **Committed in:** `2246c26` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bugs)
**Impact on plan:** Both auto-fixes necessary for compilation and test correctness. No scope creep.

## Issues Encountered

- Pre-existing TypeScript errors: `ClaudeJsonOutput` and `AgentExecutionResult` were imported from `../core/types.js` in several legacy files but were never defined there. These were only in files being deleted, so the fix was handled by deletion + inline for bead-runner.ts.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 10 is now complete: AgentPool dispatches via AgentEngine, Scheduler creates tasks with agentName, CLI uses AgentEngine directly
- All legacy code-agent-specific code is deleted
- Zero references to `isCodeAgent`, `AgentExecutionResult`, or `AgentRunner` in src/
- Full test suite passes: 350 unit tests, integration tests pass individually

---
*Phase: 10-daemon-wiring-and-legacy-cleanup*
*Completed: 2026-03-03*
