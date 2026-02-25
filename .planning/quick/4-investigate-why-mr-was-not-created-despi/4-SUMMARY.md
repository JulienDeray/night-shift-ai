---
phase: quick-4
plan: "01"
subsystem: agent-pipeline
tags: [bug-fix, mr-creation, outcome-validation, tdd]
dependency_graph:
  requires: []
  provides: [MR_FAILED outcome, MR bead exit validation]
  affects: [src/agent/types.ts, src/agent/code-agent-runner.ts, src/agent/code-agent.ts, src/daemon/agent-pool.ts]
tech_stack:
  added: []
  patterns: [exhaustive switch on outcome type, exit-code + URL dual validation]
key_files:
  created: []
  modified:
    - src/agent/types.ts
    - src/agent/code-agent-runner.ts
    - src/agent/code-agent.ts
    - src/daemon/agent-pool.ts
    - tests/unit/code-agent-runner.test.ts
decisions:
  - Validate both exit code AND URL presence before returning MR_CREATED — either failure alone triggers MR_FAILED
  - MR_FAILED includes reason string when no URL is found, but mrUrl field may still carry a URL if exitCode was non-zero but a URL was extracted (edge case preserved)
metrics:
  duration_minutes: 12
  completed_date: "2026-02-25"
  tasks_completed: 2
  files_modified: 5
---

# Phase quick-4 Plan 01: Investigate MR Not Created Summary

**One-liner:** Pipeline now distinguishes MR success from failure by checking both exit code and URL extraction before returning MR_CREATED, emitting MR_FAILED with reason when either check fails.

## Objective

Fix false-positive `MR_CREATED` outcome when the MR bead fails to create a merge request. The pipeline was unconditionally returning `outcome: "MR_CREATED"` after the MR bead ran, regardless of whether `glab mr create` actually succeeded.

## Tasks Completed

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Add MR_FAILED outcome and validate MR bead result | 8f650f0 | types.ts, code-agent-runner.ts, code-agent.ts; fix existing test URLs |
| 2 | Add tests for MR bead failure scenarios | be36b7c | 4 new test cases in code-agent-runner.test.ts |

## What Was Built

### Task 1: MR_FAILED outcome type and pipeline validation

**`src/agent/types.ts`:**
- Added `"MR_FAILED"` to `CodeAgentOutcome` union:
  `"MR_CREATED" | "MR_FAILED" | "NO_IMPROVEMENT" | "ABANDONED"`

**`src/agent/code-agent-runner.ts`:**
- Added `exitCode: number` field to `MrBeadResult` interface
- `runMrBead` now returns `exitCode: beadResult.exitCode` alongside existing fields
- `runCodeAgentPipeline` validates before returning `MR_CREATED`:
  - If `exitCode !== 0` OR `!mrUrl` → returns `MR_FAILED` with reason and warning log
  - Otherwise → returns `MR_CREATED` as before (only when both conditions are satisfied)

**`src/agent/code-agent.ts`:**
- Added `case "MR_FAILED": return result.reason ?? "MR creation failed"` to `deriveSummary`

### Task 2: MR bead failure tests

Added `describe("MR bead failure handling")` block with 4 test cases:
1. Returns `MR_FAILED` when MR bead exits non-zero (exit code 1, no URL)
2. Returns `MR_FAILED` when MR bead exits 0 but stdout has no MR URL
3. Returns `MR_CREATED` only when exit code 0 AND valid URL present (explicit confirmation)
4. `MR_FAILED` result includes reason "MR bead exited with code N and no MR URL was found"

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Non-exhaustive switch in agent-pool.ts**
- **Found during:** TypeScript compile check after Task 1
- **Issue:** Adding `MR_FAILED` to `CodeAgentOutcome` made `formatCodeAgentResult` switch non-exhaustive, causing `TS2366: Function lacks ending return statement`
- **Fix:** Added `case "MR_FAILED": return \`MR creation failed (category: ...). ${result.reason ?? ""}\`.trim()`
- **Files modified:** `src/daemon/agent-pool.ts`
- **Commit:** 6286003

**2. [Rule 1 - Bug] Existing tests used non-matching MR URL format**
- **Found during:** Task 1 verification (tests that previously passed now failed because the URL validation exposed the pre-existing mismatch)
- **Issue:** Many `makeMrBeadResult()` calls used `"https://gitlab.com/-/mr/N"` which does NOT match the URL regex `/https?:\/\/[^\s]+\/merge_requests\/\d+/`, so they silently returned `mrUrl: undefined` before this fix
- **Fix:** Updated all affected calls to use `"https://gitlab.com/team/repo/-/merge_requests/N"` format
- **Files modified:** `tests/unit/code-agent-runner.test.ts`
- **Commit:** 8f650f0 (included in Task 1 commit)

## Notes on Confluence Issue

The `log_mcp_config not set — skipping Confluence update` warning is NOT a code bug. The code at `src/agent/code-agent.ts:74` correctly guards against a missing config. The fix is to uncomment `log_mcp_config` in `workbench/nightshift.yaml` and point it to the MCP config JSON file with Atlassian credentials. This is a user configuration step.

## Verification

- `npx vitest run` — 263 tests pass, 0 failures
- `npx tsc --noEmit` — exits 0, no type errors
- `grep -rn "MR_FAILED" src/ tests/` — appears in types.ts, code-agent-runner.ts, code-agent.ts, agent-pool.ts, and test file

## Self-Check: PASSED

Files verified to exist:
- src/agent/types.ts — FOUND
- src/agent/code-agent-runner.ts — FOUND
- src/agent/code-agent.ts — FOUND
- src/daemon/agent-pool.ts — FOUND
- tests/unit/code-agent-runner.test.ts — FOUND

Commits verified:
- 8f650f0 — feat(quick-4): add MR_FAILED outcome and validate MR bead result before returning MR_CREATED
- be36b7c — test(quick-4): add MR bead failure scenario tests
- 6286003 — fix(quick-4): handle MR_FAILED case in agent-pool formatCodeAgentResult
