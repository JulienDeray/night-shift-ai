---
phase: 17-e2e-testing-framework
verified: 2026-03-13T22:00:00Z
status: human_needed
score: 5/5 success criteria verified
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "Error scenarios (agent failure, timeout, invalid manifest) each have a dedicated test that confirms correct behavior"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run full E2E suite"
    expected: "npm run test:e2e completes with all 16 tests passing (4 lifecycle + 2 happy-path + 6 CLI + 4 error scenarios). Exit code 0. No orphaned daemon processes after the run."
    why_human: "Cannot execute the test runner in this static verification environment."
  - test: "npm test does not run E2E tests"
    expected: "Only unit and integration tests run. No e2e tests appear in output. Exit code 0."
    why_human: "Cannot execute the test runner in this environment."
---

# Phase 17: E2E Testing Framework Verification Report

**Phase Goal:** E2E testing framework covering daemon lifecycle, happy-path execution, CLI commands, and error scenarios
**Verified:** 2026-03-13T22:00:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plan 17-04)

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Tests can start and stop a real daemon process as part of a test suite run | VERIFIED | `lifecycle.test.ts` (148 lines, 4 tests): starts daemon with heartbeat check, graceful stop, crash recovery (SIGKILL + restart), status CLI. All substantive with real logic in `daemon.ts`. |
| 2 | A happy-path test submits an agent, waits for execution, and verifies the output end-to-end | VERIFIED | `happy-path.test.ts` (139 lines, 2 tests): submits `happy-path-agent` via CLI, polls `.nightshift/inbox/` for report, asserts `status: completed`, `agent_name`, `step_count: 1`, output content, ntfy >= 2 requests. |
| 3 | CLI commands (status, submit, cancel, schedule, inbox) have tests that assert on expected output | VERIFIED | `cli-commands.test.ts` (243 lines, 6 tests): status, submit, cancel, schedule, inbox list, inbox --read — all with output assertions. |
| 4 | Error scenarios (agent failure, timeout, invalid manifest) each have a dedicated test that confirms correct behavior | VERIFIED | `error-scenarios.test.ts` (244 lines, 4 tests): semantic failure (`step1 FAILED`, `step2 SKIPPED`), timeout (`status: failed`, `/timed out|timeout/i`), retry exhaustion (`step_count > 2`), invalid manifest (`status: failed`, `step_count: 0`, `/manifest|required|steps/i`). |
| 5 | Claude CLI, GitLab, and ntfy are intercepted by mocks — no real external calls fire during the test run | VERIFIED | Claude CLI: PATH shim (`tests/e2e/fixtures/mock-claude/claude`, mode 0o755) prepended in all test files. ntfy: `createNtfyMockServer()` on port-0. GitLab: not called in any test-exercised code path. |

**Score:** 5/5 success criteria verified

---

## Gap Closure Verification (Re-verification Focus)

### Gap: Invalid manifest test missing from error-scenarios.test.ts

**Previous status:** FAILED — only 3 tests, no invalid manifest scenario
**Current status:** VERIFIED — 4 tests, invalid manifest test present and substantive

#### Artifacts verified

| Artifact | Status | Details |
|----------|--------|---------|
| `tests/e2e/fixtures/agents/invalid-manifest-agent/manifest.yaml` | VERIFIED | 15 lines. Valid manifest: single step "run", `outputSchema` present (required by Zod `StepSchema`), `MOCK_CLAUDE_RESPONSE_FILE: "{{response_file}}"` in env. Passes daemon startup validation. |
| `tests/e2e/fixtures/agents/invalid-manifest-agent/prompts/run.md` | VERIFIED | 1 line. "Run the task." — structurally complete fixture. |
| `tests/e2e/error-scenarios.test.ts` | VERIFIED | 244 lines (was 194). Fourth test at line 196: corrupts manifest post-startup (overwrites with YAML missing `steps` key), submits agent, waits for inbox report, asserts `status: failed`, `step_count: 0`, `/manifest|required|steps/i`. |

#### Key link verified

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `error-scenarios.test.ts` (line 204) | `src/agent/engine.ts` FATAL path | `loadManifest` throws Zod error on missing `steps` key — engine returns FATAL with `status: "FATAL"`, `perStep: []` | WIRED | `engine.ts` manifest load failure returns `{ status: "FATAL", perStep: [], error: String(err) }`. `reporter.ts` maps FATAL to `status: failed`, `step_count: 0`. Test assertions match these code paths exactly. |

#### Commit verified

| Commit | Message | Files |
|--------|---------|-------|
| `0e5a00a` | `feat(17-04): add invalid manifest E2E test — all 4 error scenarios pass` | `tests/e2e/error-scenarios.test.ts` (+50 lines), `tests/e2e/fixtures/agents/invalid-manifest-agent/manifest.yaml` (new), `tests/e2e/fixtures/agents/invalid-manifest-agent/prompts/run.md` (new) |

---

## Regression Check on Previously-Passing Items

| Artifact | Previous Line Count | Current Line Count | Status |
|----------|--------------------|--------------------|--------|
| `tests/e2e/lifecycle.test.ts` | 148 | 148 | NO REGRESSION |
| `tests/e2e/happy-path.test.ts` | 139 | 139 | NO REGRESSION |
| `tests/e2e/cli-commands.test.ts` | 243 | 243 | NO REGRESSION |
| `vitest.e2e.config.ts` | 16 | 16 | NO REGRESSION |
| All fixture agents (happy-path, multi-step-failure, retry, timeout) | present | present | NO REGRESSION |

No regressions detected. All files from the initial pass retain their content.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TEST-01 | 17-01 | E2E test harness that starts and stops a real daemon process | SATISFIED | `lifecycle.test.ts` 4 tests: start/stop/crash-recovery/status-cli. |
| TEST-02 | 17-02 | Happy path test: daemon start -> agent submit -> execution -> output verification -> daemon stop | SATISFIED | `happy-path.test.ts` full pipeline end-to-end. |
| TEST-03 | 17-02 | CLI command tests: status, submit, cancel, schedule, inbox with expected output | SATISFIED | `cli-commands.test.ts` covers all 6 CLI operations with assertions. |
| TEST-04 | 17-03 + 17-04 | Error scenario tests: agent failures, timeouts, invalid manifests | SATISFIED | `error-scenarios.test.ts` 4 tests: semantic failure + timeout + retry exhaustion + invalid manifest. All 3 ROADMAP-required scenarios now present. |
| TEST-05 | 17-01 | External service mocking: Claude CLI, GitLab, ntfy — no real calls during tests | SATISFIED | Claude: PATH shim. ntfy: localhost mock server. GitLab: not in code path under test. |

All 5 requirements satisfied. No orphaned requirements found.

---

## Anti-Patterns Found

No anti-patterns in any of the 3 files added or modified in plan 17-04. No TODO/FIXME/placeholder comments, no empty implementations, no console.log-only handlers.

---

## Human Verification Required

### 1. Full E2E Suite Passes (16 tests)

**Test:** Run `npm run test:e2e` from `/Users/julienderay/code/night-shift`
**Expected:** All 16 tests pass — 4 lifecycle + 2 happy-path + 6 CLI + 4 error scenarios. Exit code 0. No orphaned daemon processes after the run.
**Why human:** Test runner cannot be executed in this static verification environment.

### 2. npm test Does Not Run E2E Tests

**Test:** Run `npm test` from the project root
**Expected:** Only unit and integration tests run. No e2e tests appear in output. Exit code 0.
**Why human:** Cannot execute the test runner in this environment.

---

## Summary

The single gap identified in the initial verification has been closed. Plan 17-04 added:

- `tests/e2e/fixtures/agents/invalid-manifest-agent/manifest.yaml` — a valid fixture manifest (includes `outputSchema` to pass daemon startup Zod validation)
- `tests/e2e/fixtures/agents/invalid-manifest-agent/prompts/run.md` — stub prompt to complete the fixture
- A fourth test in `tests/e2e/error-scenarios.test.ts` that corrupts the manifest after daemon startup, submits the agent, and asserts `status: failed`, `step_count: 0`, and a manifest-related error message

All 5 ROADMAP success criteria are now verified. All 5 requirement IDs (TEST-01 through TEST-05) are satisfied. No regressions in previously-passing items. Two human verification items remain (test runner execution) because the E2E suite cannot be run in this environment.

---

_Verified: 2026-03-13T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
