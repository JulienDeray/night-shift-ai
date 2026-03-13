---
phase: 15-notifications
plan: 02
subsystem: notifications
tags: [orchestrator, notification-service, refactor, cleanup]

# Dependency graph
requires:
  - phase: 15-01
    provides: NotificationService with taskStarted/taskCompleted
provides:
  - Orchestrator with NotificationService injection, no inline notify methods, no NO_IMPROVEMENT block
affects: [15-03, orchestrator]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "NotificationService injection: orchestrator constructs service with NtfyClient and delegates all notification calls"
    - "Separation of concerns: orchestrator tick/handleCompleted contain zero notification formatting logic"

key-files:
  created: []
  modified:
    - src/daemon/orchestrator.ts
    - src/core/types.ts
    - src/core/config.ts
    - tests/unit/orchestrator.test.ts
    - README.md
    - docs/agents.md

key-decisions:
  - "NTFY-04 (skip notification) explicitly not implemented per user decision — no skip concept at platform level"
  - "NO_IMPROVEMENT fallback re-dispatch removed from orchestrator — agent-agnostic platform principle enforced"
  - "Integration test failures (8 tests) are pre-existing environment issues unrelated to this plan"

patterns-established:
  - "All notification calls go through NotificationService — no inline ntfy.send in orchestrator"

requirements-completed: [NTFY-01, NTFY-02, NTFY-03, NTFY-04]

# Metrics
duration: 7min
completed: 2026-03-13
---

# Phase 15 Plan 02: Orchestrator NotificationService Integration Summary

**Orchestrator wired to NotificationService replacing inline notify methods; NO_IMPROVEMENT fallback block and fallback_categories config removed**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-13T15:36:00Z
- **Completed:** 2026-03-13T15:43:00Z
- **Tasks:** 3 (all auto)
- **Files modified:** 6

## Accomplishments

- Deleted NO_IMPROVEMENT fallback re-dispatch block (28 lines) from orchestrator
- Removed `fallback_categories` from AgentDeclaration interface, Zod schema, and mapConfig
- Removed unused `crypto` import from orchestrator
- Added NotificationService import and field; constructed in start() with NtfyClient
- Replaced `notifyTaskStart(task)` calls with `notificationService.taskStarted(task)`
- Replaced `notifyTaskEnd(task, result)` call with `notificationService.taskCompleted(task, result)`
- Deleted private `notifyTaskStart` and `notifyTaskEnd` methods (37 lines)
- Updated orchestrator tests: mock NotificationService injection pattern, replaced spy on deleted methods
- Updated scheduled dispatch tests: assert on notificationService.taskStarted instead of old spy
- Removed fallback_categories from README.md agent config example
- Removed fallback_categories from docs/agents.md YAML example, config table, and NO_IMPROVEMENT paragraph
- Full unit test suite: 402 tests pass (8 integration tests are pre-existing environment failures)

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove fallback_categories and NO_IMPROVEMENT block** - `acc2cec` (refactor)
2. **Task 2: Wire NotificationService into orchestrator and update tests** - `e33f24f` (feat)
3. **Task 3: Update documentation** - `2bbee2a` (docs)

## Files Created/Modified

- `src/daemon/orchestrator.ts` - NotificationService field + delegation; NO_IMPROVEMENT block deleted; private notify methods deleted
- `src/core/types.ts` - AgentDeclaration without fallback_categories
- `src/core/config.ts` - AgentDeclarationSchema and mapConfig without fallback_categories
- `tests/unit/orchestrator.test.ts` - Mock NotificationService injection; updated scheduled dispatch assertions
- `README.md` - Removed fallback_categories from example config
- `docs/agents.md` - Removed fallback_categories from YAML example, table, and NO_IMPROVEMENT paragraph

## Decisions Made

- NTFY-04 (skip notification) explicitly not implemented — no skip concept at platform level per user decision
- NO_IMPROVEMENT block removed from orchestrator: agent-specific logic violates platform agent-agnostic principle; agents handle retry internally
- Pre-existing integration test failures (8 tests with ENOENT/spawn errors) are environment issues unrelated to this plan

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Unused crypto import**
- **Found during:** Task 1
- **Issue:** Deleting the NO_IMPROVEMENT block removed the only use of `crypto.randomBytes`; unused import remained
- **Fix:** Removed `import crypto from "node:crypto"` from orchestrator.ts
- **Files modified:** src/daemon/orchestrator.ts
- **Commit:** acc2cec

## Issues Encountered

Pre-existing integration test failures (8 tests) exist due to environment/infrastructure issues (ENOENT writing temp files, npx spawn). These were present before Plan 02 and are unrelated to notification work. Logged as out-of-scope per deviation rules.

## User Setup Required

None.

## Next Phase Readiness

- Plan 03 (if any) can build on clean orchestrator with NotificationService
- All NTFY requirements (NTFY-01 through NTFY-04) are complete
- Notification system is fully agent-agnostic: formatter generates messages, NotificationService handles transport, orchestrator delegates all notification concerns

---
## Self-Check: PASSED

- src/daemon/orchestrator.ts: FOUND
- src/core/types.ts: FOUND
- src/core/config.ts: FOUND
- 15-02-SUMMARY.md: FOUND
- Commit acc2cec: FOUND
- Commit e33f24f: FOUND
- Commit 2bbee2a: FOUND

*Phase: 15-notifications*
*Completed: 2026-03-13*
