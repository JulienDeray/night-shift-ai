---
phase: 15-notifications
plan: 01
subsystem: notifications
tags: [ntfy, formatter, pure-functions, tdd, vitest]

# Dependency graph
requires:
  - phase: 14-bead-removal
    provides: AgentRunResult with perStep/failedStepIndex/totalDurationMs from engine-types.ts
provides:
  - Pure formatter module (notification-formatter.ts) exporting formatStartNotification, formatSuccessNotification, formatFailureNotification
  - NotificationService class (notification-service.ts) wrapping formatter + NtfyClient
  - 26 unit tests covering all formatter edge cases
affects: [15-02, orchestrator-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure function formatter module: no class, no side effects, easily testable"
    - "Fire-and-forget notification: void ntfy.send() never blocks orchestrator"
    - "Thin service wrapper: NotificationService combines formatter + transport, handles null-safety"

key-files:
  created:
    - src/notifications/notification-formatter.ts
    - src/notifications/notification-service.ts
    - tests/unit/notification-formatter.test.ts
  modified: []

key-decisions:
  - "Formatter as pure function module (not class) for easy testing and composition"
  - "agentName fallback chain: task.agentName ?? result.agentName ?? 'unknown-agent'"
  - "Duration format: Xs / Xm Ys / Xh Ym (no seconds for hour-scale runs)"
  - "Stack trace stripping: skip lines matching /^\\s*at\\s+/ pattern"
  - "Object finalOutput: prefer summary field, then result field, then JSON.stringify truncated to 200 chars"

patterns-established:
  - "Notification formatter: pure functions returning NtfyMessage, no side effects"
  - "NotificationService: guard ntfy===null and !task.notify at method entry before any formatting"

requirements-completed: [NTFY-01, NTFY-02, NTFY-03]

# Metrics
duration: 2min
completed: 2026-03-13
---

# Phase 15 Plan 01: Notification Formatter and Service Summary

**Pure formatter functions and NotificationService wrapper for agent-agnostic start/success/failure notifications with TDD coverage (26 tests)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-13T15:31:14Z
- **Completed:** 2026-03-13T15:33:26Z
- **Tasks:** 2 (TDD: RED + GREEN commits + auto task)
- **Files modified:** 3 created

## Accomplishments
- Pure formatter module with formatStartNotification, formatSuccessNotification, formatFailureNotification
- Internal helpers: formatDuration (s/m+s/h+m), extractSummaryLine (string/object/JSON fallback), cleanError (strip stack traces)
- NotificationService class with taskStarted/taskCompleted, fire-and-forget pattern, null-safe
- 26 unit tests covering all edge cases: undefined agentName, object finalOutput, out-of-bounds failedStepIndex, stack trace stripping, duration formatting
- Full suite: 407 tests pass (381 prior + 26 new)

## Task Commits

Each task was committed atomically:

1. **TDD RED: Formatter tests (failing)** - `fcd7a31` (test)
2. **TDD GREEN: notification-formatter.ts** - `c145869` (feat)
3. **Task 2: notification-service.ts** - `b4d1ba4` (feat)

_Note: TDD tasks may have multiple commits (test → feat → refactor)_

## Files Created/Modified
- `src/notifications/notification-formatter.ts` - Pure function formatter module exporting three NtfyMessage builders
- `src/notifications/notification-service.ts` - Thin service wrapper combining formatter + NtfyClient
- `tests/unit/notification-formatter.test.ts` - 26 unit tests covering all formatter behaviors and edge cases

## Decisions Made
- Formatter as pure function module (not class): easier to test, no state, ideal for composition
- agentName fallback chain: `task.agentName ?? result.agentName ?? "unknown-agent"` — task overrides result
- Duration: seconds-only for <1 min, min+sec for <1 hr, hr+min for >=1 hr (no seconds at hour scale)
- Stack trace cleaning: skip lines matching `/^\s*at\s+/` pattern to keep error message only
- Object finalOutput: check `summary` field first, then `result` field, then JSON.stringify (truncated to 200)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- notification-formatter.ts and notification-service.ts ready for integration
- Plan 02 (orchestrator integration) can import NotificationService and replace inline notifyTaskStart/notifyTaskEnd
- Plan 03 (cleanup) can remove NO_IMPROVEMENT fallback and fallback_categories

---
*Phase: 15-notifications*
*Completed: 2026-03-13*
