---
phase: 17-e2e-testing-framework
plan: 04
subsystem: testing
tags: [vitest, e2e, error-scenarios, invalid-manifest, zod-validation, fixture-agent]

# Dependency graph
requires:
  - phase: 17-03
    provides: error-scenarios.test.ts with 3 passing tests and fixture agent infrastructure
provides:
  - Fourth error scenario test: invalid manifest corrupted after daemon startup
  - invalid-manifest-agent fixture agent (valid at startup, corrupted by test at runtime)
  - All 4 ROADMAP error scenario requirements satisfied (failure, timeout, retry, invalid manifest)
  - Full 16-test E2E suite passing
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Post-startup manifest corruption: daemon validates agent at startup with valid manifest, test overwrites manifest file after daemon starts, submit triggers engine loadManifest which throws Zod error"
    - "outputSchema required in step fixture manifests: Zod schema for steps requires outputSchema field even for fixture agents"

key-files:
  created:
    - tests/e2e/fixtures/agents/invalid-manifest-agent/manifest.yaml
    - tests/e2e/fixtures/agents/invalid-manifest-agent/prompts/run.md
  modified:
    - tests/e2e/error-scenarios.test.ts

key-decisions:
  - "Fixture manifest must include outputSchema — Zod StepSchema requires it; omitting it causes daemon startup validation to fail (daemon crashes before test runs)"
  - "Manifest corruption happens after daemon start but before submit — daemon startup validates all agents, so the fixture must be valid at that point"
  - "Corrupted manifest removes steps key entirely — simplest Zod validation failure that produces a clear required-field error message"

patterns-established:
  - "Fixture validation gap: always test daemon startup manually when adding new fixture agents to catch Zod schema requirements early"

requirements-completed: [TEST-04]

# Metrics
duration: 15min
completed: 2026-03-13
---

# Phase 17 Plan 04: Invalid Manifest E2E Test Summary

**Fourth error scenario test: post-startup manifest corruption triggers Zod validation failure, engine returns FATAL with step_count:0 — full 16-test E2E suite now green**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-13T21:25:00Z
- **Completed:** 2026-03-13T21:40:10Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- Created `invalid-manifest-agent` fixture with a valid manifest (passes daemon startup validation) and a `prompts/run.md` stub prompt
- Added the fixture agent to `beforeEach` agent list so the daemon copies and validates it at startup
- Added the fourth error scenario test: test corrupts the agent's manifest after daemon starts (removes `steps` key), submits the agent, waits for inbox report, asserts `status: failed`, `step_count: 0`, and manifest-related error text
- TEST-04 requirement fully satisfied: agent failure, timeout, retry exhaustion, AND invalid manifest all have dedicated E2E tests
- Full 16-test E2E suite passes (4 lifecycle + 2 happy-path + 6 CLI + 4 error scenarios)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create invalid-manifest-agent fixture and add test** - `0e5a00a` (feat)

## Files Created/Modified

- `tests/e2e/fixtures/agents/invalid-manifest-agent/manifest.yaml` - Valid manifest at startup: single step "run" with outputSchema, MOCK_CLAUDE_RESPONSE_FILE env var
- `tests/e2e/fixtures/agents/invalid-manifest-agent/prompts/run.md` - Minimal stub prompt ("Run the task.")
- `tests/e2e/error-scenarios.test.ts` - Added `invalid-manifest-agent` to agentNames list; added fourth test that corrupts manifest post-startup and verifies failed report

## Decisions Made

- Fixture manifest must include `outputSchema` — Zod `StepSchema` requires it. The happy-path-agent manifest has it; omitting it from the new fixture caused the daemon to fail startup validation (with a `steps.0.outputSchema: Invalid input: expected record, received undefined` error), which blocked the daemon from starting and caused all 4 tests to timeout at `waitForInboxReport`.
- Manifest corruption strategy: overwrite the copied manifest file with a YAML document that has `name` and `description` but no `steps` key. This produces a clear Zod error about the required `steps` field.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing outputSchema in fixture manifest broke daemon startup**
- **Found during:** Task 1 (fixture creation and test run)
- **Issue:** The `invalid-manifest-agent` manifest lacked `outputSchema` in its step definition. Zod `StepSchema` requires `outputSchema` (type: record). The daemon crashed during `validateAgentsAtStartup` before entering its poll loop, causing all 4 error-scenario tests to time out at `waitForInboxReport` (daemon never processed submitted tasks).
- **Fix:** Added `outputSchema` block matching the happy-path-agent pattern to the fixture manifest
- **Files modified:** `tests/e2e/fixtures/agents/invalid-manifest-agent/manifest.yaml`
- **Verification:** All 4 error-scenario tests pass; full 16-test suite green
- **Committed in:** `0e5a00a` (part of task commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Required fix for correctness — the daemon's Zod validation is stricter than the plan accounted for. No scope creep.

## Issues Encountered

The daemon startup validation caught a schema violation in the new fixture manifest before any test could run. This presented as all 4 tests timing out (not just the new test), because the daemon crashed silently (output was suppressed via `stdio: "ignore"` in the spawn options). Diagnosed by running the daemon manually in a temporary directory and capturing stderr.

## Next Phase Readiness

Phase 17 E2E Testing Framework is now complete:
- All 5 ROADMAP success criteria satisfied (lifecycle, happy-path, CLI commands, error scenarios including invalid manifest, external service mocking)
- TEST-04 requirement fully satisfied with 4 dedicated error scenario tests
- Full 16-test E2E suite passes in ~58 seconds

## Self-Check: PASSED

All files verified present:
- tests/e2e/fixtures/agents/invalid-manifest-agent/manifest.yaml: FOUND
- tests/e2e/fixtures/agents/invalid-manifest-agent/prompts/run.md: FOUND
- tests/e2e/error-scenarios.test.ts: FOUND
- .planning/phases/17-e2e-testing-framework/17-04-SUMMARY.md: FOUND

All commits verified:
- 0e5a00a: feat(17-04): add invalid manifest E2E test — all 4 error scenarios pass

Full E2E suite: 16 tests passing

---
*Phase: 17-e2e-testing-framework*
*Completed: 2026-03-13*
