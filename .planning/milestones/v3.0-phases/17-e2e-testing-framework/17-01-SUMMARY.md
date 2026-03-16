---
phase: 17-e2e-testing-framework
plan: 01
subsystem: testing
tags: [vitest, e2e, daemon, mock-claude, ntfy, process-lifecycle]

# Dependency graph
requires: []
provides:
  - E2E test infrastructure with vitest.e2e.config.ts and npm run test:e2e
  - Daemon lifecycle helpers (startDaemon, waitForDaemonReady, stopDaemon, killDaemon)
  - ntfy mock server (createNtfyMockServer) capturing HTTP requests
  - E2E config writer (writeE2EConfig) with fixture agent copy and manifest rewrite
  - CLI run helper for spawning nightshift commands in test workspaces
  - Mock claude shim intercepting all claude invocations via PATH
  - Happy-path-agent fixture with manifest + prompt
  - 4 passing daemon lifecycle E2E tests
affects: [17-02, 17-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "E2E daemon spawn: use npx tsx src/daemon/index.ts directly (not nightshift start) to avoid compiled-JS path issue"
    - "waitForDaemonReady: require heartbeat newer than poll start time to prevent stale heartbeat acceptance in crash recovery"
    - "Mock claude shim via PATH prepend: daemon inherits modified PATH, buildStepEnv propagates it to claude spawn"
    - "Manifest env rewrite: config helper substitutes {{response_file}} with absolute path at fixture copy time"
    - "vitest.e2e.config.ts: singleFork: true for serial execution to avoid daemon port/PID conflicts"

key-files:
  created:
    - vitest.e2e.config.ts
    - tests/e2e/helpers/daemon.ts
    - tests/e2e/helpers/ntfy-server.ts
    - tests/e2e/helpers/config.ts
    - tests/e2e/helpers/cli.ts
    - tests/e2e/fixtures/mock-claude/claude
    - tests/e2e/fixtures/mock-claude/responses/success.json
    - tests/e2e/fixtures/agents/happy-path-agent/manifest.yaml
    - tests/e2e/fixtures/agents/happy-path-agent/prompts/run.md
    - tests/e2e/lifecycle.test.ts
  modified:
    - vitest.config.ts
    - package.json

key-decisions:
  - "Spawn daemon directly via npx tsx src/daemon/index.ts rather than nightshift start — avoids compiled-JS path resolution issue in start.ts __dirname"
  - "waitForDaemonReady requires heartbeat timestamp after poll start time — prevents stale heartbeat acceptance in crash recovery scenario"
  - "MOCK_CLAUDE_RESPONSE_FILE substituted at manifest copy time in config helper — cleanest way to thread fixed response path through buildStepEnv whitelist"
  - "vitest.config.ts narrowed to unit/integration only — E2E tests require separate run due to long timeouts and process isolation needs"

patterns-established:
  - "E2E test setup: mkdtemp + writeE2EConfig + chmod mock-claude + build daemonEnv with PATH prepend"
  - "E2E test teardown: killDaemon (unconditional safety net) + ntfyServer.close() + fs.rm(tmpDir)"
  - "Crash recovery pattern: SIGKILL + 500ms wait + startDaemon again — daemon rewrites PID/heartbeat on next start"

requirements-completed: [TEST-01, TEST-05]

# Metrics
duration: 9min
completed: 2026-03-13
---

# Phase 17 Plan 01: E2E Test Infrastructure and Daemon Lifecycle Tests Summary

**Vitest E2E harness with daemon lifecycle helpers, mock claude PATH shim, ntfy mock server, and 4 passing lifecycle tests (start/heartbeat/stop/crash-recovery)**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-13T19:06:34Z
- **Completed:** 2026-03-13T19:15:32Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Created complete E2E test infrastructure: vitest config, 4 helper modules, mock claude shim, fixture agent, canned responses
- All 4 daemon lifecycle tests pass: start writes heartbeat, stop terminates gracefully, crash recovery with stale PID detection, status CLI shows running state
- npm run test:e2e works; npm test (unit+integration) does not include E2E tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Create E2E vitest config, helpers, fixtures, and mock claude shim** - `0d43f94` (feat)
2. **Task 2 (TDD RED): Add failing E2E lifecycle tests** - `0ebac74` (test)
3. **Task 2 (TDD GREEN): Implement daemon lifecycle E2E tests — all 4 pass** - `3a244b7` (feat)

## Files Created/Modified
- `vitest.e2e.config.ts` - E2E vitest config: 120s timeout, singleFork serial execution, verbose reporter
- `vitest.config.ts` - Narrowed include to unit/integration dirs only (exclude E2E)
- `package.json` - Added test:e2e script
- `tests/e2e/helpers/daemon.ts` - startDaemon, waitForDaemonReady, stopDaemon, killDaemon
- `tests/e2e/helpers/ntfy-server.ts` - createNtfyMockServer with port-0 HTTP recording
- `tests/e2e/helpers/config.ts` - writeE2EConfig: nightshift.yaml + dir structure + fixture copy with manifest rewrite
- `tests/e2e/helpers/cli.ts` - run() helper wrapping spawnWithTimeout
- `tests/e2e/fixtures/mock-claude/claude` - Shell script shim (chmod +x) reading MOCK_CLAUDE_RESPONSE_FILE
- `tests/e2e/fixtures/mock-claude/responses/success.json` - Canned ClaudeJsonOutput success response
- `tests/e2e/fixtures/agents/happy-path-agent/manifest.yaml` - Single-step agent with MOCK_CLAUDE_RESPONSE_FILE env
- `tests/e2e/fixtures/agents/happy-path-agent/prompts/run.md` - Minimal prompt
- `tests/e2e/lifecycle.test.ts` - 4 daemon lifecycle tests with beforeEach/afterEach cleanup

## Decisions Made
- Spawn daemon directly via `npx tsx src/daemon/index.ts` (not via `nightshift start`) because `start.ts` resolves the daemon path relative to its compiled `__dirname`, which points to `dist/src/cli/commands/` in the compiled JS but resolves differently when running via tsx from source
- `waitForDaemonReady` requires `heartbeatTime > startTime` to prevent accepting a stale heartbeat from a previously SIGKILLed daemon during crash recovery testing
- `MOCK_CLAUDE_RESPONSE_FILE` is set in the manifest env block as `{{response_file}}` and substituted at fixture copy time — this threads correctly through `buildStepEnv`'s whitelist (manifest-declared env vars pass through)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] waitForDaemonReady accepted stale heartbeats in crash recovery**
- **Found during:** Task 2 (daemon lifecycle tests)
- **Issue:** The crash recovery test failed because after SIGKILL, the old daemon.json still had a recent heartbeat. `waitForDaemonReady` accepted it immediately without waiting for the new daemon's heartbeat.
- **Fix:** Added `heartbeatTime > startTime` condition — only accepts heartbeats written after the poll started
- **Files modified:** tests/e2e/helpers/daemon.ts
- **Verification:** All 4 lifecycle tests pass including crash recovery
- **Committed in:** 3a244b7

**2. [Rule 1 - Bug] Crash recovery assertion was too strict about PID reuse**
- **Found during:** Task 2 (daemon lifecycle tests)
- **Issue:** Test asserted `handle2.pid !== firstPid` but macOS can reuse PIDs in quick succession
- **Fix:** Changed assertion to verify the new daemon is alive via `process.kill(pid, 0)` signal check
- **Files modified:** tests/e2e/lifecycle.test.ts
- **Verification:** Test passes consistently
- **Committed in:** 3a244b7

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs discovered during TDD GREEN phase)
**Impact on plan:** Necessary for test correctness. No scope creep.

## Issues Encountered
- Daemon spawned via `nightshift start` CLI would fail in test context because `start.ts` uses `__dirname` (from compiled `dist/src/cli/commands/`) to resolve `../../daemon/index.js` — path doesn't exist when running via tsx. Solution: spawn daemon directly via `npx tsx src/daemon/index.ts`.
- ENOENT log file errors appear in daemon stderr after SIGKILL + restart (logs dir cleanup) — non-fatal, daemon continues running. Not fixed as it's out of scope for this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- E2E infrastructure is complete and tested — plans 17-02 and 17-03 can build directly on these helpers
- Mock claude shim works correctly — no real claude binary called during tests
- ntfy mock server captures HTTP requests — ready for notification verification in plan 17-02
- Daemon lifecycle helpers are reliable and handle crash recovery

## Self-Check: PASSED

All files and commits verified present.

---
*Phase: 17-e2e-testing-framework*
*Completed: 2026-03-13*
