---
phase: 03-agent-prompt-and-security
plan: 02
subsystem: agent
tags: [vitest, security, token-isolation, pipeline, retry, fallback]

# Dependency graph
requires:
  - phase: 03-01
    provides: "BeadResult, AnalysisResult, CodeAgentRunResult types; loadBeadPrompt with injection preamble; 4 bead prompt templates"
provides:
  - "src/agent/bead-runner.ts: buildBeadEnv (GITLAB_TOKEN isolation), buildBeadArgs (tool restriction), runBead"
  - "src/agent/code-agent-runner.ts: runCodeAgentPipeline with 4-bead orchestration, retry, and category fallback"
  - "tests/unit/code-agent-runner.test.ts: 17 tests covering pipeline orchestration, fallback, retry, token isolation, NO_IMPROVEMENT"
affects: [04-git-harness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "buildBeadEnv constructs minimal safe env from explicit allowlist (HOME, PATH, USER, LANG, SHELL, TERM) — never spreads process.env"
    - "GITLAB_TOKEN forwarded only to MR bead via runBead options; absent from all other bead invocations"
    - "runBead returns BeadResult without throwing — pipeline orchestrator handles all error paths"
    - "PipelineContext interface bundles all pipeline-wide state for clean function signatures"
    - "buildBuiltInVars uses explicit allowlist + user-defined config.variables — no process.env spread into templates"

key-files:
  created:
    - src/agent/bead-runner.ts
    - src/agent/code-agent-runner.ts
    - tests/unit/code-agent-runner.test.ts

key-decisions:
  - "runBead never throws — returns BeadResult with error info so the orchestrator can implement fallback/retry without exception handling"
  - "buildBeadEnv starts from explicit safe allowlist, not process.env filtered — belt-and-suspenders token isolation"
  - "resetRepo called both between implement retries AND after all retries fail (before fallback) to ensure clean state"
  - "PipelineContext carries gitlabToken as optional string — the caller provides it; runMrBead is the sole consumer"

patterns-established:
  - "Bead functions (runAnalyzeBead, runImplementBead, runVerifyBead, runMrBead) are private to the module — PipelineContext flows through each"
  - "Stub JSON written before each bead that produces a handoff file — prevents ENOENT if bead skips writing"
  - "Category fallback: primary first, then FALLBACK_ORDER minus primary — preserves scheduled priority"

requirements-completed: [AGENT-05, AGENT-08]

# Metrics
duration: 4min
completed: 2026-02-25
---

# Phase 3 Plan 02: Code-Agent Execution Pipeline Summary

**bead-runner module with env isolation and tool restriction (AGENT-08/09), plus code-agent-runner orchestrating the 4-bead pipeline with category fallback and Implement retry logic; 17 tests verify all security invariants**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-25T10:03:28Z
- **Completed:** 2026-02-25T10:07:48Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `src/agent/bead-runner.ts` with `buildBeadEnv` (minimal safe env, GITLAB_TOKEN only for MR bead), `buildBeadArgs` (--allowedTools Bash Read Write), and `runBead` (wraps spawnWithTimeout, returns BeadResult without throwing)
- Created `src/agent/code-agent-runner.ts` with the full 4-bead pipeline: Analyze -> Implement -> Verify -> MR, with category fallback (FALLBACK_ORDER: tests/refactoring/docs/security/performance), Implement retry (MAX_IMPLEMENT_RETRIES=2, 3 total attempts), git reset --hard HEAD between retries, and cost/duration accumulation
- Created `tests/unit/code-agent-runner.test.ts` with 17 tests covering: happy path, NO_IMPROVEMENT fallback, all-categories-exhausted, verify retry, git reset verification, GITLAB_TOKEN isolation (4 dedicated tests), no-category-scheduled, fallback order verification, and notification notation
- All 201 tests pass (18 test files); TypeScript compiles cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Create bead-runner with env isolation and tool restriction** - `852636c` (feat)
2. **Task 2: Create code-agent-runner with 4-bead pipeline, retry, and fallback** - `286f411` (feat)

## Files Created/Modified

- `src/agent/bead-runner.ts` - New file: `buildBeadEnv` (safe env allowlist, GITLAB_TOKEN only for mr bead), `buildBeadArgs` (--allowedTools as separate elements), `runBead` (wraps spawnWithTimeout, parses ClaudeJsonOutput)
- `src/agent/code-agent-runner.ts` - New file: `PipelineContext` interface, `FALLBACK_ORDER`, `MAX_IMPLEMENT_RETRIES=2`, `CATEGORY_GUIDANCE` map, `runCodeAgentPipeline` orchestrator, private bead helpers
- `tests/unit/code-agent-runner.test.ts` - New file: 17 tests with vi.mock for runBead, loadBeadPrompt, resolveCategory, spawnWithTimeout, and fs

## Decisions Made

- `runBead` returns BeadResult without throwing — non-zero exit codes and JSON parse failures are represented in the result so the orchestrator handles all error paths declaratively
- `buildBeadEnv` starts from an explicit allowlist (HOME, PATH, USER, LANG, SHELL, TERM), not from `process.env` with keys deleted — belt-and-suspenders approach ensures GITLAB_TOKEN cannot leak even if the deletion logic has a bug
- `resetRepo` is called both between Implement retries (avoids Pitfall 6) and after all retries fail before fallback (ensures clean state for next category's Analyze bead)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. TypeScript compiled cleanly on first attempt; all 17 tests passed on first run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 4 (git-harness) can import `runCodeAgentPipeline` from `src/agent/code-agent-runner.ts`
- `PipelineContext` is the integration point: Phase 4 will populate `repoDir`, `handoffDir`, `configDir`, and `gitlabToken` after cloning the repo
- Token isolation invariant is structurally enforced: Phase 4 passes the token to `PipelineContext.gitlabToken` and the runner ensures only the MR bead receives it

---
*Phase: 03-agent-prompt-and-security*
*Completed: 2026-02-25*

## Self-Check: PASSED

- FOUND: src/agent/bead-runner.ts
- FOUND: src/agent/code-agent-runner.ts
- FOUND: tests/unit/code-agent-runner.test.ts
- FOUND: .planning/phases/03-agent-prompt-and-security/03-02-SUMMARY.md
- FOUND commit: 852636c (feat(03-02): bead-runner)
- FOUND commit: 286f411 (feat(03-02): code-agent-runner + tests)
