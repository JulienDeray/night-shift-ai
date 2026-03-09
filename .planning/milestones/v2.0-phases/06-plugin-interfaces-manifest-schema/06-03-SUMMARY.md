---
phase: 06-plugin-interfaces-manifest-schema
plan: 03
subsystem: agent
tags: [template, variable-resolution, dot-notation, array-indexing, manifest, vitest]

# Dependency graph
requires:
  - phase: 06-01
    provides: ManifestError class used for collision and undefined-variable errors

provides:
  - src/agent/template.ts with BUILT_IN_VARS, validateVariableNames, buildTemplateVars, renderAgentTemplate, validateTemplateVars, resolveNestedValue, buildBuiltIns
  - Dot-notation and array-index variable resolution for agent prompt rendering
  - Load-time undefined variable detection (non-beads.* paths)
  - Built-in variable precedence enforcement (built-ins > config overrides > manifest defaults)
  - Comprehensive test suite (38 tests) in tests/unit/template-agent.test.ts

affects: [06-04, 06-05, phase-08-agent-engine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parallel template modules: src/utils/template.ts (simple word substitution) and src/agent/template.ts (extended dot/array syntax) coexist without importing each other"
    - "Built-in variable precedence: immutable built-ins always win over user config or manifest defaults"
    - "beads.* namespace: prefix-gated runtime-only resolution — skipped at load-time validation"
    - "Collision detection at manifest load time, not at render time"

key-files:
  created:
    - src/agent/template.ts
    - tests/unit/template-agent.test.ts
  modified: []

key-decisions:
  - "src/utils/template.ts left entirely unchanged — no import relationship between old and new modules"
  - "resolveNestedValue normalises [N] array syntax to dot-separated path segments before walking"
  - "renderAgentTemplate leaves undefined placeholders as-is; validateTemplateVars does the hard error"
  - "validateTemplateVars skips beads.* at load time — those paths only become valid at runtime when bead outputs exist"

patterns-established:
  - "Load-time validation pattern: validate at manifest parse, not at execution — fail early, fail clearly"
  - "Extended regex /{{([a-zA-Z0-9_.\\[\\]]+)}}/g used for agent templates vs /{{(\\w+)}}/g for utils template"

requirements-completed: [MFST-03]

# Metrics
duration: 4min
completed: 2026-02-26
---

# Phase 6 Plan 03: Agent Template Variable System Summary

**Enhanced template module for agent manifests with dot-notation/array-index resolution, built-in variable precedence, collision detection, and load-time undefined variable checking**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-02-26T15:28:56Z
- **Completed:** 2026-02-26T15:30:25Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `src/agent/template.ts` as a standalone module parallel to the existing `src/utils/template.ts` (no import relationship — backwards compatibility fully preserved)
- Implemented all five core functions: `validateVariableNames`, `buildTemplateVars`, `resolveNestedValue`, `renderAgentTemplate`, `validateTemplateVars`, plus convenience `buildBuiltIns`
- 38 tests cover every requirement in MFST-03: collision detection, precedence rules, dot notation, array indexing, JSON serialization, null/number/boolean coercion, load-time validation, beads.* skip, and backwards compatibility

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement agent template variable system** - `23da04c` (feat)
2. **Task 2: Write comprehensive tests for agent template system** - `287aab1` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/agent/template.ts` — Extended template system: BUILT_IN_VARS constant, validateVariableNames (collision), buildTemplateVars (precedence merge), resolveNestedValue (dot/array walk), renderAgentTemplate (extended regex render), validateTemplateVars (load-time check), buildBuiltIns (convenience constructor)
- `tests/unit/template-agent.test.ts` — 38 tests across 8 describe blocks covering all MFST-03 scenarios

## Decisions Made

- `src/utils/template.ts` is intentionally untouched — zero diff confirmed. The two modules serve distinct roles and do not import each other.
- `resolveNestedValue` normalises `[N]` bracket syntax to `.N` before splitting on dots, which keeps the walk logic simple and uniform.
- `renderAgentTemplate` is intentionally lenient (leaves unknown placeholders as-is); the strictness lives in `validateTemplateVars` which is called at load time.
- `beads.*` variables are skipped at load-time validation because bead outputs do not exist until pipeline execution — validating them early would always fail.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Agent template system complete and ready for use by the engine (Phase 8) and manifest loader
- Phase 6 Plan 04 can use `buildTemplateVars`, `validateTemplateVars`, and `renderAgentTemplate` directly when wiring prompt loading
- All exports satisfy the interface contract documented in 06-CONTEXT.md

---
*Phase: 06-plugin-interfaces-manifest-schema*
*Completed: 2026-02-26*

## Self-Check: PASSED

- FOUND: src/agent/template.ts
- FOUND: tests/unit/template-agent.test.ts
- FOUND: .planning/phases/06-plugin-interfaces-manifest-schema/06-03-SUMMARY.md
- FOUND commit: 23da04c (feat: agent template variable system)
- FOUND commit: 287aab1 (test: comprehensive template-agent tests)
