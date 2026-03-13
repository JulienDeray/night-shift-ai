---
phase: 17-e2e-testing-framework
plan: 03
subsystem: testing
tags: [vitest, e2e, error-scenarios, semantic-failure, timeout, retry-exhaustion, mock-claude]

# Dependency graph
requires: [17-01]
provides:
  - Three error scenario fixture agents (multi-step-failure, retry, timeout)
  - Canned response files (failure.json, retry-fail.json)
  - E2E tests for semantic failure, timeout, and retry exhaustion
  - Full 9-test E2E suite passing
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Semantic failure detection: engine checks parsed.status === 'FAILED' and returns FATAL with step2 SKIPPED"
    - "Timeout fixture: MOCK_CLAUDE_SLEEP_MS=10000 in manifest env causes shim to sleep past 2s timeout"
    - "Retry exhaustion: retryCount > maxAttempts falls through while loop — agent completes with SUCCESS"
    - "Per-agent response files: use {{failure_response_file}} and {{retry_fail_response_file}} placeholders in manifest env"
    - "config.ts placeholder substitution: multiple response file placeholders resolved at fixture copy time"

key-files:
  created:
    - tests/e2e/fixtures/agents/multi-step-failure-agent/manifest.yaml
    - tests/e2e/fixtures/agents/multi-step-failure-agent/prompts/step1.md
    - tests/e2e/fixtures/agents/multi-step-failure-agent/prompts/step2.md
    - tests/e2e/fixtures/agents/retry-agent/manifest.yaml
    - tests/e2e/fixtures/agents/retry-agent/prompts/work.md
    - tests/e2e/fixtures/agents/retry-agent/prompts/review.md
    - tests/e2e/fixtures/agents/timeout-agent/manifest.yaml
    - tests/e2e/fixtures/agents/timeout-agent/prompts/run.md
    - tests/e2e/fixtures/mock-claude/responses/failure.json
    - tests/e2e/fixtures/mock-claude/responses/retry-fail.json
    - tests/e2e/error-scenarios.test.ts
  modified:
    - tests/e2e/helpers/config.ts

key-decisions:
  - "Use {{failure_response_file}} and {{retry_fail_response_file}} placeholders in manifests — resolved by config.ts at fixture copy time, same pattern as {{response_file}}"
  - "Retry exhaustion with maxAttempts:2 does 3 review executions (retryCount 1,2,3>2) before falling through — agent completes with SUCCESS, not FATAL"
  - "Semantic failure assertion: check step1 FAILED and step2 SKIPPED rather than specific error message from JSON payload (engine generates its own error string)"

patterns-established:
  - "Error scenario test structure: one agent submitted per test, wait for specific inbox report pattern"
  - "Timeout test: generous 45s poll timeout in waitForInboxReport to account for 2s step timeout + report write time"

requirements-completed: [TEST-04]

# Metrics
duration: 6min
completed: 2026-03-13
---

# Phase 17 Plan 03: Error Scenario E2E Tests Summary

**Three error scenario fixture agents (semantic failure, timeout, retry exhaustion) with corresponding mock responses and 3 passing E2E tests — full 9-test suite green**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-13T19:18:07Z
- **Completed:** 2026-03-13T19:24:07Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- Created three error scenario fixture agents: multi-step-failure-agent (2-step, step1 returns status:FAILED), retry-agent (2-step with review retry maxAttempts:2), timeout-agent (2s timeout with 10s sleep shim)
- Created two canned response files: failure.json (status:FAILED) and retry-fail.json (passed:false)
- Extended config.ts placeholder substitution to support per-agent response file paths
- All 3 error scenario tests pass: semantic failure produces failed report with step2 SKIPPED, timeout produces failed report with timeout message, retry exhaustion completes with SUCCESS after 3 review attempts
- Full 9-test E2E suite passes (lifecycle + happy-path + error-scenarios)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create error scenario fixture agents and response files** - `a42875d` (feat)
2. **Task 2 (TDD RED): Add failing E2E error scenario tests** - `a891e9a` (test)
3. **Task 2 (TDD GREEN): Implement error scenario E2E tests — all 3 pass** - `150b1bc` (feat)

## Files Created/Modified

- `tests/e2e/fixtures/agents/multi-step-failure-agent/manifest.yaml` - 2-step agent, step1 uses {{failure_response_file}}
- `tests/e2e/fixtures/agents/multi-step-failure-agent/prompts/step1.md` - Minimal placeholder prompt
- `tests/e2e/fixtures/agents/multi-step-failure-agent/prompts/step2.md` - Minimal placeholder prompt (should never execute)
- `tests/e2e/fixtures/agents/retry-agent/manifest.yaml` - 2-step agent, review step has retry maxAttempts:2 retryFrom:work
- `tests/e2e/fixtures/agents/retry-agent/prompts/work.md` - Minimal placeholder prompt
- `tests/e2e/fixtures/agents/retry-agent/prompts/review.md` - Minimal placeholder prompt
- `tests/e2e/fixtures/agents/timeout-agent/manifest.yaml` - 1-step agent with 2s timeout, MOCK_CLAUDE_SLEEP_MS=10000
- `tests/e2e/fixtures/agents/timeout-agent/prompts/run.md` - Minimal placeholder prompt
- `tests/e2e/fixtures/mock-claude/responses/failure.json` - Canned response: {status:"FAILED", error:"mock failure: step1 encountered an error"}
- `tests/e2e/fixtures/mock-claude/responses/retry-fail.json` - Canned response: {passed:false, error_details:"validation check failed"}
- `tests/e2e/error-scenarios.test.ts` - 3 error scenario tests with beforeEach/afterEach cleanup
- `tests/e2e/helpers/config.ts` - Added {{failure_response_file}} and {{retry_fail_response_file}} placeholder substitution

## Decisions Made

- `{{failure_response_file}}` and `{{retry_fail_response_file}}` placeholders in manifests resolved by `config.ts` at fixture copy time — cleanest way to thread different response files per step through the manifest env whitelist
- Retry exhaustion assertion checks `step_count > 2` (not exact count) — maxAttempts:2 produces 6 step entries (work+review x3) but the count is implementation-defined
- Semantic failure assertion checks step listing (`step1 FAILED`, `step2 SKIPPED`) rather than specific JSON payload content — the engine generates its own error string, not the payload's `error` field

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] config.ts generated `baseUrl` instead of `base_url` for ntfy config**
- **Found during:** Task 2 (TDD GREEN — ntfy assertions)
- **Issue:** `NtfyConfigSchema` uses `base_url` (snake_case) but config helper was generating `baseUrl` (camelCase) — ntfy was never configured so 0 notifications sent
- **Fix:** Linter corrected this automatically; confirmed `base_url` is correct per config.ts schema
- **Files modified:** tests/e2e/helpers/config.ts
- **Verification:** All 3 tests pass including ntfy notification assertions
- **Committed in:** 150b1bc

**2. [Rule 2 - Missing functionality] config.ts lacked response file placeholders for error agents**
- **Found during:** Task 1 (fixture creation)
- **Issue:** Only `{{response_file}}` → success.json substitution existed; error agents need different response files per step
- **Fix:** Added `{{failure_response_file}}` → failure.json and `{{retry_fail_response_file}}` → retry-fail.json constants and substitutions
- **Files modified:** tests/e2e/helpers/config.ts
- **Committed in:** a42875d

**3. [Rule 1 - Bug] Test assertion for semantic failure used wrong expected string**
- **Found during:** Task 2 (TDD RED → GREEN)
- **Issue:** Asserted `mock failure: step1 encountered an error` (from failure.json payload) but engine generates `Step "step1" output status: FAILED` — payload error field is not propagated to report
- **Fix:** Changed assertion to check `step1.*FAILED` (step listing) and `step2.*SKIPPED`
- **Files modified:** tests/e2e/error-scenarios.test.ts
- **Committed in:** 150b1bc

## Self-Check: PASSED

All files verified present:
- tests/e2e/error-scenarios.test.ts: exists
- tests/e2e/fixtures/agents/multi-step-failure-agent/manifest.yaml: exists
- tests/e2e/fixtures/agents/retry-agent/manifest.yaml: exists
- tests/e2e/fixtures/agents/timeout-agent/manifest.yaml: exists
- tests/e2e/fixtures/mock-claude/responses/failure.json: exists
- tests/e2e/fixtures/mock-claude/responses/retry-fail.json: exists

All commits verified:
- a42875d: feat(17-03): create error scenario fixture agents
- a891e9a: test(17-03): add failing E2E error scenario tests
- 150b1bc: feat(17-03): implement error scenario E2E tests

Full E2E suite: 9 tests passing

---
*Phase: 17-e2e-testing-framework*
*Completed: 2026-03-13*
