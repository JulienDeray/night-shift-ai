---
phase: 16-codebase-cleanup
plan: 02
subsystem: core
tags: [typescript, error-handling, refactoring]

# Dependency graph
requires:
  - phase: 16-01
    provides: Dead code removed, prompt-loader.ts deleted, clean foundation for error hierarchy work
provides:
  - Single NightShiftError class with NightShiftErrorCode union type replacing 8-class hierarchy
  - All throw/catch sites updated to use code-based discrimination
  - All test assertions updated to check error.code
affects: [future error handling patterns, catch blocks across all source files]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Error discrimination via err.code string checks instead of instanceof subclass checks"
    - "throw new NightShiftError(message, 'CODE') at all throw sites"
    - "instanceof NightShiftError && err.code === 'X' at all catch sites"

key-files:
  created: []
  modified:
    - src/core/errors.ts
    - src/agent/manifest-loader.ts
    - src/agent/template.ts
    - src/agent/engine.ts
    - src/core/config.ts
    - src/daemon/orchestrator.ts
    - src/utils/process.ts
    - src/cli/commands/agent.ts
    - tests/unit/manifest-loader.test.ts
    - tests/unit/template-agent.test.ts
    - tests/unit/engine.test.ts
    - tests/unit/startup-validation.test.ts

key-decisions:
  - "Collapsed 8 NightShiftError subclasses into single class with NightShiftErrorCode union type — per locked user decision from CONTEXT.md"
  - "TimeoutError.taskId and TimeoutError.timeoutMs dropped — verified no consumer accesses them via grep"
  - "categorizeError in engine.ts updated to use err.code checks, preserving TRANSIENT/FATAL classification exactly"

patterns-established:
  - "Error code pattern: NightShiftErrorCode union type, throw with new NightShiftError(msg, 'CODE')"
  - "Test assertion pattern: toBeInstanceOf(NightShiftError) + toMatchObject({ code: 'X' })"

requirements-completed: [CLEAN-02, CLEAN-04]

# Metrics
duration: 20min
completed: 2026-03-13
---

# Phase 16 Plan 02: Error Hierarchy Collapse Summary

**Collapsed 8-class NightShiftError hierarchy into single class with NightShiftErrorCode union, updating all 8 source files and 4 test files atomically**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-03-13T16:30:00Z
- **Completed:** 2026-03-13T16:49:17Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Rewrote errors.ts from 70 lines (8 classes) to 17 lines (1 class + union type)
- Updated all throw sites in manifest-loader.ts, template.ts, config.ts, orchestrator.ts, process.ts
- Updated categorizeError in engine.ts to use err.code discrimination, preserving TRANSIENT/FATAL logic
- Updated all catch sites in CLI agent.ts command
- Updated 4 test files to use NightShiftError + .code assertions
- TypeScript compiles with zero errors; 116 targeted test cases pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite errors.ts and update all throw/catch sites** - `e076724` (feat)
2. **Task 2: Update all test files for new error pattern** - `c80d8ab` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/core/errors.ts` - Single NightShiftError class with NightShiftErrorCode union type
- `src/agent/manifest-loader.ts` - Updated throw sites (MANIFEST, MANIFEST_SECURITY, STEP_CONTRACT_VIOLATION, STEP_OUTPUT_MISSING)
- `src/agent/template.ts` - Updated throw sites (MANIFEST)
- `src/agent/engine.ts` - Updated imports + categorizeError using err.code
- `src/core/config.ts` - Updated throw sites (CONFIG)
- `src/daemon/orchestrator.ts` - Updated throw site (CONFIG)
- `src/utils/process.ts` - Updated throw site (TIMEOUT), dropped taskId/timeoutMs fields
- `src/cli/commands/agent.ts` - Updated catch sites using err.code checks
- `tests/unit/manifest-loader.test.ts` - Updated assertions for new error pattern
- `tests/unit/template-agent.test.ts` - Updated assertions for new error pattern
- `tests/unit/engine.test.ts` - Updated assertions for new error pattern
- `tests/unit/startup-validation.test.ts` - Updated assertions + removed dynamic imports of old classes

## Decisions Made
- Dropped `TimeoutError.taskId` and `TimeoutError.timeoutMs` fields — verified via grep that no consumer accesses these fields on caught errors, so they are safe to drop along with the subclass
- Kept test description strings unchanged (e.g., "StepOutputMissingError categorized as TRANSIENT") — these are just human-readable labels, not code references

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Integration tests show parallelization failures when the full suite runs — this is a pre-existing environment issue unrelated to the error hierarchy changes. The 4 modified test files all pass (116 tests). The integration tests pass individually.

## Next Phase Readiness
- Error hierarchy is fully collapsed, zero references to deleted subclasses
- Ready for Phase 16 Plan 03 (dead exports cleanup, tiny file merges, comment cleanup)

---
*Phase: 16-codebase-cleanup*
*Completed: 2026-03-13*
