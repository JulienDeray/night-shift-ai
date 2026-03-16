---
phase: 14-bead-removal
plan: 01
subsystem: agent
tags: [typescript, manifest, schema, zod, types, refactor]

# Dependency graph
requires: []
provides:
  - "StepOutcome, StepErrorCategory, AgentRunResult with perStep in engine-types.ts"
  - "StepSchema, ManifestSchema with steps array (no type field) in manifest-schema.ts"
  - "ResolvedStep, LoadedManifest with steps field in manifest-types.ts"
  - "StepContractViolationError, StepOutputMissingError in errors.ts (RegistryError and BeadsError deleted)"
  - "step-runner.ts with buildStepEnv, buildStepArgs, runStep, StepResult"
  - "AgentPipelineContext consolidated into engine-types.ts (currentStep, previousSteps, no handoffDir)"
  - "TempDirManager.create() returns flat tmpDir only"
  - "BeadsConfig removed from types.ts and config.ts"
affects: [14-02, 14-03, engine, manifest-loader, agent-pool, orchestrator, tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Step terminology: all pipeline unit types, schemas, errors now use 'step' not 'bead'"
    - "Flat temp dir: TempDirManager creates a single tmpDir per run with no subdirectories"
    - "Consolidated context: AgentPipelineContext lives alongside AgentRunResult in engine-types.ts"

key-files:
  created:
    - src/agent/step-runner.ts
  modified:
    - src/agent/engine-types.ts
    - src/agent/manifest-schema.ts
    - src/agent/manifest-types.ts
    - src/agent/manifest-loader.ts
    - src/core/errors.ts
    - src/core/types.ts
    - src/core/config.ts
    - src/agent/temp-dir-manager.ts

key-decisions:
  - "AgentPipelineContext moved from bead-plugin.ts into engine-types.ts alongside other pipeline types"
  - "handoffDir removed from AgentPipelineContext — flat temp dir model, no subdirectories"
  - "type field dropped from StepSchema and ResolvedStep — every step is implicitly standard"
  - "BeadsError and RegistryError deleted — no BeadsClient or registry remain in the codebase"
  - "beadCount renamed to stepCount in InboxEntry"

patterns-established:
  - "All contract types (StepOutcome, AgentRunResult, AgentPipelineContext) grouped in engine-types.ts"
  - "ManifestSchema uses steps array; no type discriminator field needed"

requirements-completed: [BEAD-01, BEAD-03]

# Metrics
duration: 4min
completed: 2026-03-13
---

# Phase 14 Plan 01: Bead-to-Step Contract Layer Rename Summary

**Full rename of bead-named types, schemas, errors, and runner to step equivalents — contract layer ready for engine inlining (Plan 02) and test migration (Plan 03)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-13T13:40:52Z
- **Completed:** 2026-03-13T13:44:32Z
- **Tasks:** 2
- **Files modified:** 8 (+ 1 created, 1 deleted)

## Accomplishments

- Renamed all bead-named types to step equivalents across engine-types, manifest-schema, manifest-types, manifest-loader, errors, step-runner
- Moved `AgentPipelineContext` from `bead-plugin.ts` into `engine-types.ts` with `currentStep`/`previousSteps` and no `handoffDir` (flat temp dir model)
- Deleted `RegistryError` and `BeadsError`; replaced `BeadContractViolationError`/`BeadOutputMissingError` with `StepContractViolationError`/`StepOutputMissingError`
- `ManifestSchema` now accepts `steps` array with `StepSchema` (no `type` field)
- `bead-runner.ts` renamed to `step-runner.ts` with all exports renamed (`buildStepEnv`, `buildStepArgs`, `runStep`, `StepResult`)
- `BeadsConfig` interface and `beads` config field removed from `types.ts` and `config.ts`
- `TempDirManager.create()` returns flat `{ tmpDir }` only — no `repo/` or `handoff/` subdirectories

## Task Commits

Each task was committed atomically:

1. **Task 1: Rename types, schemas, and errors from bead to step** - `d13d027` (feat)
2. **Task 2: Rename bead-runner.ts to step-runner.ts and remove beads config** - `5e911af` (feat)

## Files Created/Modified

- `src/agent/engine-types.ts` - StepErrorCategory, StepOutcome, AgentRunResult.perStep, AgentPipelineContext with currentStep/previousSteps
- `src/agent/manifest-schema.ts` - StepSchema (no type field), ManifestSchema with steps array
- `src/agent/manifest-types.ts` - ManifestStep, ResolvedStep (no type field), LoadedManifest.steps
- `src/agent/manifest-loader.ts` - resolveStepConfig, validateStepOutput, all variable names step-based
- `src/core/errors.ts` - StepContractViolationError, StepOutputMissingError; RegistryError and BeadsError deleted
- `src/agent/step-runner.ts` - Created: StepResult, buildStepEnv, buildStepArgs, runStep
- `src/agent/bead-runner.ts` - Deleted
- `src/core/types.ts` - BeadsConfig deleted, NightShiftConfig.beads removed, InboxEntry.beadCount->stepCount
- `src/core/config.ts` - beads field removed from ConfigSchema, mapConfig, getDefaultConfigYaml
- `src/agent/temp-dir-manager.ts` - create() returns flat { tmpDir }, no subdirectories

## Decisions Made

- `AgentPipelineContext` consolidated into `engine-types.ts` alongside all other pipeline result types for discoverability
- `handoffDir` removed from context per CONTEXT.md decision: flat temp dir, no subdirectories
- `type` field dropped from step definition — no dispatch by type needed after plugin removal
- TypeScript errors in downstream consumers (`engine.ts`, `agent-pool.ts`, etc.) are expected and intentionally left for Plan 02

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Contract layer (types, schemas, errors, step-runner) fully renamed — Plan 02 can inline engine logic against the new step-based contracts
- Plan 03 (test migration) can update tests to use step terminology
- Downstream consumers (`engine.ts`, `agent-pool.ts`, `orchestrator.ts`, `bead-plugin.ts`, `bead-registry.ts`, `beads/`) still reference old names — those are Plan 02's scope

---
*Phase: 14-bead-removal*
*Completed: 2026-03-13*
