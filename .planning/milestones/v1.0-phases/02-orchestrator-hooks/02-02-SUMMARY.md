---
phase: 02-orchestrator-hooks
plan: 02
subsystem: daemon
tags: [typescript, notifications, ntfy, orchestrator, tdd]

# Dependency graph
requires:
  - phase: 01-notification-foundation
    provides: NtfyClient, NtfyConfig, NtfyMessage interface
  - phase: 02-orchestrator-hooks
    plan: 01
    provides: notify and category fields on NightShiftTask
provides:
  - NtfyClient instantiated once in Orchestrator.start() from config.ntfy
  - notifyTaskStart() private method: fires priority 3 notification on task dispatch
  - notifyTaskEnd() private method: priority 3 success (cost + summary) or priority 4 failure (error snippet)
  - Both helpers guard on ntfy != null AND task.notify === true
affects:
  - Phase 3 (prompt engineering) - notification content may influence task prompt design
  - Phase 4 (git harness) - tasks using git harness will benefit from notify:true in recurring config

# Tech tracking
tech-stack:
  added: []
  patterns:
    - void prefix on ntfy.send() calls for fire-and-forget (no poll loop blocking)
    - Guard-then-return pattern in notification helpers (check ntfy and task.notify first)
    - result.result.slice(0, 200) truncation for oversized notification bodies
    - NtfyClient instantiated once in start(), reused across all helpers

key-files:
  created: []
  modified:
    - src/daemon/orchestrator.ts
    - tests/unit/orchestrator.test.ts

key-decisions:
  - "void prefix on ntfy.send() calls — fire-and-forget consistent with writeHeartbeat pattern, must not block poll loop"
  - "Priority 3 for success, priority 4 for failure — per ntfy numeric scale, research recommendation"
  - "result.result.slice(0, 200) truncation — prevents oversized notification bodies without losing essential info"

patterns-established:
  - "notifyTaskStart/notifyTaskEnd: guard-and-delegate pattern — if (!this.ntfy || !task.notify) return"
  - "NtfyClient created once in start() from optional config field, null-safe throughout daemon lifecycle"

requirements-completed: [NTFY-03, NTFY-04, NTFY-05]

# Metrics
duration: 2min
completed: 2026-02-24
---

# Phase 2 Plan 02: Orchestrator Notification Hooks Summary

**NtfyClient wired into Orchestrator with notifyTaskStart/notifyTaskEnd fire-and-forget helpers using priority 3/4 for success/failure, 11 TDD tests covering all NTFY-03/04/05 guard and formatting behaviors**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-24T15:11:54Z
- **Completed:** 2026-02-24T15:14:17Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `NtfyClient` import and `private ntfy: NtfyClient | null = null` field to Orchestrator
- Wired NtfyClient instantiation in `start()`: `this.ntfy = this.config.ntfy ? new NtfyClient(this.config.ntfy) : null`
- Implemented `notifyTaskStart()`: sends priority 3 notification with task name and category (or "Running…" fallback) when `task.notify === true`
- Implemented `notifyTaskEnd()`: sends priority 3 success (cost + summary) or priority 4 failure (error snippet) notification
- Called `notifyTaskStart` after `pool.dispatch` in `tick()`, `notifyTaskEnd` at end of `handleCompleted()`
- 11 TDD tests covering all guard conditions (ntfy null, notify false, notify undefined) and message formatting (category, priority, truncation)

## Task Commits

Each task was committed atomically:

1. **Task 1: RED -- Add failing tests for orchestrator notification hooks** - `a56d327` (test)
2. **Task 2: GREEN -- Implement NtfyClient wiring and notification helpers** - `163b922` (feat)

## Files Created/Modified
- `src/daemon/orchestrator.ts` - Added NtfyClient import, ntfy field, notifyTaskStart/notifyTaskEnd methods, call sites in tick() and handleCompleted()
- `tests/unit/orchestrator.test.ts` - Added Orchestrator import, AgentExecutionResult type, 11 notification hook tests with makeNotifyTask/makeResult helpers

## Decisions Made
- Used `void` prefix on `this.ntfy.send()` calls — consistent with existing `void this.writeHeartbeat()` pattern, fire-and-forget, must not block poll loop
- Priority 3 (default) for success, priority 4 (high) for failure — per ntfy numeric priority scale
- `result.result.slice(0, 200)` truncation prevents oversized notification bodies without losing critical info
- `this.ntfy` instantiated once in `start()`, null when `config.ntfy` is not set — zero cost when ntfy is unconfigured

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Notifications activate automatically when `ntfy` block is present in `~/.config/nightshift/config.json`.

## Next Phase Readiness
- Orchestrator now fires notifications on task start and end when `notify: true` is set on a recurring task config
- Phase 3 (prompt engineering) can add `notify: true` to any recurring task config to enable notifications
- Phase 4 (git harness) similarly benefits from the notify field
- All 171 tests pass across 16 test files, no regressions

---
*Phase: 02-orchestrator-hooks*
*Completed: 2026-02-24*

## Self-Check: PASSED

- FOUND: src/daemon/orchestrator.ts
- FOUND: tests/unit/orchestrator.test.ts
- FOUND: 02-02-SUMMARY.md
- FOUND: commit a56d327 (test - RED phase)
- FOUND: commit 163b922 (feat - GREEN phase)
