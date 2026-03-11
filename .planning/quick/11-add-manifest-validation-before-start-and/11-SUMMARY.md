---
phase: quick-11
plan: 01
subsystem: cli
tags: [manifest-validation, daemon, startup, reliability]

requires: []
provides:
  - Pre-spawn manifest validation in nightshift start CLI command
  - Post-spawn liveness check to detect immediate daemon crashes
affects: [start-command, daemon-startup]

tech-stack:
  added: []
  patterns:
    - "Reuse daemon-internal validateAgentsAtStartup in CLI for early validation before spawn"
    - "Signal 0 liveness check (process.kill(pid, 0)) to confirm process still alive after spawn"

key-files:
  created: []
  modified:
    - src/cli/commands/start.ts

key-decisions:
  - "Reuse existing validateAgentsAtStartup from orchestrator.ts rather than duplicating validation logic"
  - "Log validation progress only when agents are configured (no noise for empty-agent configs)"
  - "Use process.kill(pid, 0) signal-0 check for liveness — does not kill the process, just tests existence"

patterns-established:
  - "Pre-spawn validation pattern: validate before spawning detached child processes to surface errors in CLI"
  - "Post-spawn liveness pattern: wait ~1s then signal-0 check to catch immediate crashes"

requirements-completed: [QUICK-11]

duration: 5min
completed: 2026-03-11
---

# Quick Task 11: Add Manifest Validation Before Start and Post-Spawn Liveness Check

**Pre-spawn manifest validation and ~1s post-spawn liveness check added to nightshift start to surface errors before and immediately after daemon spawn**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-11T00:00:00Z
- **Completed:** 2026-03-11T00:05:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Invalid agent manifests are now caught in the CLI process before daemon spawn, with clear error output
- After spawning, start waits ~1 second then checks the daemon process is still alive via `process.kill(pid, 0)`
- If daemon crashes immediately after spawn, the user sees an error and exit code 1 instead of a false success message
- Validation output is suppressed for configs with no agents (no noise)

## Task Commits

1. **Task 1: Pre-spawn manifest validation and post-spawn liveness check** - `795b5d1` (feat)

## Files Created/Modified
- `src/cli/commands/start.ts` - Added `validateAgentsAtStartup` call before spawn and signal-0 liveness check after spawn

## Decisions Made
- Reuse `validateAgentsAtStartup` from `orchestrator.ts` — same logic the daemon runs internally, now executed in the CLI process where errors are immediately visible
- Use `process.kill(pid, 0)` (signal 0) for liveness — this is a POSIX convention that checks process existence without sending a real signal
- Only log "Validating agent manifests..." when `config.agents.length > 0` to avoid noisy output for minimal configs

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Reliability improvement ships immediately with the existing daemon architecture
- No follow-up work required

---
*Phase: quick-11*
*Completed: 2026-03-11*
