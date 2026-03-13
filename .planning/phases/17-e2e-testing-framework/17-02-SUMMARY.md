---
phase: 17-e2e-testing-framework
plan: 02
subsystem: testing
tags: [vitest, e2e, happy-path, cli-commands, ntfy, daemon]

# Dependency graph
requires:
  - E2E test infrastructure (17-01)
provides:
  - happy-path.test.ts: full pipeline E2E test (submit -> execute -> inbox -> ntfy)
  - cli-commands.test.ts: CLI command E2E tests (status, submit, cancel, schedule, inbox, inbox --read)
affects: [17-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "waitForInboxReport: polls .nightshift/inbox/ every 300ms for regex-matching filename"
    - "CLI test isolation: separate tmpDir with pollIntervalMs=60000 for cancel test to avoid race"
    - "ntfy verification: base_url must use snake_case in YAML config (not baseUrl camelCase)"

key-files:
  created:
    - tests/e2e/happy-path.test.ts
    - tests/e2e/cli-commands.test.ts
  modified:
    - src/cli/commands/submit.ts
    - tests/e2e/helpers/config.ts

key-decisions:
  - "submit.ts propagates agentDecl.notify to task — without this, task.notify is undefined and NotificationService silently skips all notifications"
  - "cancel test uses pollIntervalMs=60000 in a separate tmpDir — ensures task stays pending long enough to cancel without race condition"
  - "inbox --read test uses just the filename (not full path) — matches how getInboxDir resolves the path via path.resolve(inboxDir, options.read)"

requirements-completed: [TEST-02, TEST-03]

# Metrics
duration: 7min
completed: 2026-03-13
---

# Phase 17 Plan 02: Happy-Path and CLI Command E2E Tests Summary

**Full pipeline E2E test and 6 CLI command tests, all passing against live daemon with mock claude shim and ntfy mock server**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-13T19:18:03Z
- **Completed:** 2026-03-13T19:31:25Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `happy-path.test.ts` with 2 tests: full pipeline (submit → execute → inbox → ntfy) and mock shim verification
- Created `cli-commands.test.ts` with 6 tests covering all user-facing CLI commands
- All 8 tests pass against a live daemon
- Fixed 2 bugs that prevented ntfy notifications from working in tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Write happy-path E2E test** - `fe3d798` (feat) + `a42875d` (fix)
2. **Task 2: Write CLI command E2E tests** - `b35f089` (feat)

## Files Created/Modified

- `tests/e2e/happy-path.test.ts` - 2 E2E tests: full pipeline with ntfy verification + mock-only verification
- `tests/e2e/cli-commands.test.ts` - 6 E2E tests: status, submit, cancel, schedule, inbox list, inbox read
- `src/cli/commands/submit.ts` - Propagate `agentDecl.notify` into queued task (Bug: notify was never set on one-off tasks)
- `tests/e2e/helpers/config.ts` - Fix `baseUrl` → `base_url` in ntfy YAML block (Bug: camelCase was silently ignored by Zod, defaulting to ntfy.sh)

## Decisions Made

- `submit.ts` propagates `agentDecl.notify` so one-off tasks inherit the agent's notification preference — without this, `task.notify` is always `undefined` and `NotificationService` silently no-ops
- cancel test uses a separate tmpDir with `pollIntervalMs: 60000` to ensure the task stays pending (avoids race condition with daemon's 500ms poll cycle)
- `inbox --read` uses just the filename (not full path) since `getInboxDir` resolves it relative to the configured inbox directory

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] submit.ts did not propagate agentDecl.notify to queued task**
- **Found during:** Task 1 (happy-path ntfy assertion failing)
- **Issue:** `NotificationService.taskStarted` and `taskCompleted` both check `task.notify` before sending. The submit command looked up `agentDecl` to get variables but never copied `agentDecl.notify` to the task. Result: `task.notify` was always `undefined`, and no notifications were ever sent for one-off tasks.
- **Fix:** Added `...(agentDecl?.notify !== undefined && { notify: agentDecl.notify })` to the task construction in `submit.ts`
- **Files modified:** `src/cli/commands/submit.ts`
- **Commit:** `fe3d798`

**2. [Rule 1 - Bug] writeE2EConfig used camelCase baseUrl in ntfy YAML block**
- **Found during:** Task 1 (ntfy assertions receiving 0 requests)
- **Issue:** The nightshift.yaml ntfy block was written as `baseUrl: http://...` but the config Zod schema uses `base_url`. Since `NtfyConfigSchema` is not `.strict()`, the unknown camelCase field was silently ignored by Zod, causing ntfy to use the default `https://ntfy.sh` URL instead of the mock server.
- **Fix:** Changed `baseUrl` to `base_url` in the config helper template
- **Files modified:** `tests/e2e/helpers/config.ts`
- **Commit:** `a42875d`

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs found during Task 1 TDD GREEN phase)
**Impact on plan:** Necessary for test correctness. No scope creep.

## Issues Encountered

- A previous executor session had already committed `happy-path.test.ts` and the `submit.ts` notify fix (`fe3d798`) and 17-03 error scenario fixtures (`a42875d`). The `config.ts` `base_url` fix was included in `a42875d` as well. This session picked up where the previous left off and completed Task 2 (cli-commands.test.ts).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- happy-path.test.ts and cli-commands.test.ts are complete and passing
- Error scenario fixture agents and responses are already in place (17-03 setup)
- Plan 17-03 can proceed immediately: write error-scenarios.test.ts

## Self-Check: PASSED

All files and commits verified present.
