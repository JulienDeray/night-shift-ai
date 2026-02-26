---
phase: 06-plugin-interfaces-manifest-schema
plan: 01
subsystem: agent
tags: [zod, schema, manifest, plugin, registry, typescript]

# Dependency graph
requires:
  - phase: 05-dispatch-foundation
    provides: PipelineContext and AgentRunResult types used as reference to avoid naming collision
provides:
  - ManifestSchema Zod definition with .strict(), allowedTools validation, KNOWN_CLAUDE_TOOLS constant
  - ManifestBead, ResolvedBead, ResolvedEnvVar, LoadedManifest TypeScript interfaces
  - BeadPlugin interface, BeadOutput type, BeadPluginFactory type, AgentPipelineContext interface
  - BeadRegistry class with register/resolve/hasType/registeredTypes methods
  - ManifestError, ManifestSecurityError, BeadContractViolationError, BeadOutputMissingError, RegistryError error classes
affects:
  - 06-02 (manifest loader consumes ManifestSchema, LoadedManifest, ManifestError)
  - 06-03 (template system uses manifest-types and bead-plugin interfaces)
  - 08-agent-engine (engine imports BeadPlugin, BeadRegistry, AgentPipelineContext)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zod .strict() on all schema objects — unknown fields are validation errors not silent drops"
    - "superRefine for cross-field validation (duplicate names, absolute paths, unknown tools)"
    - "BeadPluginFactory as factory-function type — registry stores factories not instances"
    - "Named AgentPipelineContext to avoid collision with two existing PipelineContext types"

key-files:
  created:
    - src/agent/manifest-schema.ts
    - src/agent/manifest-types.ts
    - src/agent/bead-plugin.ts
    - src/agent/bead-registry.ts
    - tests/unit/manifest-schema.test.ts
    - tests/unit/bead-registry.test.ts
  modified:
    - src/core/errors.ts

key-decisions:
  - "KNOWN_CLAUDE_TOOLS list hardcoded in manifest-schema.ts — unknown tools rejected at schema parse time"
  - "BeadRegistry is a DI instance (not singleton) — passed to engine constructor"
  - "AgentPipelineContext named explicitly to avoid shadowing agent-types.ts PipelineContext and code-agent-runner.ts PipelineContext"
  - "BeadPlugin.execute() single-method interface — no lifecycle hooks per locked CONTEXT.md decision"
  - "compiledOutputSchema field on ResolvedBead uses z.ZodTypeAny to avoid Zod version-specific generics"

patterns-established:
  - "Schema-first contracts: all downstream phases import from manifest-schema.ts and manifest-types.ts"
  - "Error taxonomy: domain-specific errors (ManifestError, RegistryError) extend NightShiftError base"

requirements-completed: [MFST-01, PLUG-01, PLUG-02]

# Metrics
duration: 2min
completed: 2026-02-26
---

# Phase 6 Plan 01: Plugin Interfaces and Manifest Schema Summary

**Zod manifest schema with .strict() and unknown-tool validation, BeadPlugin/BeadRegistry contracts, and 5 domain error classes — the complete type foundation for Phase 6**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-26T15:24:20Z
- **Completed:** 2026-02-26T15:26:37Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- ManifestSchema validates all MFST-01 requirements: strict mode, duplicate bead detection, absolute path rejection, allowedTools against KNOWN_CLAUDE_TOOLS list, all errors reported at once via safeParse
- BeadPlugin interface with single execute(ctx) method and AgentPipelineContext carrying previousBeads and variables maps
- BeadRegistry class as non-singleton DI instance with RegistryError listing known types on unknown lookup
- All 5 error classes (ManifestError, ManifestSecurityError, BeadContractViolationError, BeadOutputMissingError, RegistryError) added to errors.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Create error classes and manifest Zod schema with types** - `1df9d20` (feat)
2. **Task 2: Create BeadPlugin interface, BeadRegistry class, and tests** - `232fdef` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified

- `src/core/errors.ts` - Added 5 new error classes extending NightShiftError
- `src/agent/manifest-schema.ts` - ManifestSchema, BeadSchema, EnvVarSchema with .strict() and superRefine validation
- `src/agent/manifest-types.ts` - Manifest, ManifestBead, ResolvedBead, ResolvedEnvVar, LoadedManifest interfaces
- `src/agent/bead-plugin.ts` - BeadPlugin interface, BeadOutput, BeadPluginFactory, AgentPipelineContext
- `src/agent/bead-registry.ts` - BeadRegistry class with register/resolve/hasType/registeredTypes
- `tests/unit/manifest-schema.test.ts` - 15 tests covering all schema validation requirements
- `tests/unit/bead-registry.test.ts` - 6 tests covering registry behavior

## Decisions Made

- KNOWN_CLAUDE_TOOLS validates allowedTools at schema parse time — unknown tools are immediately rejected with helpful error listing all valid options
- BeadRegistry is a class instance (not module-level singleton) — allows multiple test registries and clean DI
- AgentPipelineContext named to avoid collision with two existing PipelineContext types in codebase

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All type contracts stable: Plan 02 (manifest loader) and Plan 03 (template system) can import from these files
- ManifestSchema and BeadRegistry are ready for integration testing in Plan 02
- No blockers

---
*Phase: 06-plugin-interfaces-manifest-schema*
*Completed: 2026-02-26*

## Self-Check: PASSED

- All 7 files exist (src/core/errors.ts, src/agent/manifest-schema.ts, src/agent/manifest-types.ts, src/agent/bead-plugin.ts, src/agent/bead-registry.ts, tests/unit/manifest-schema.test.ts, tests/unit/bead-registry.test.ts)
- All commits verified: 1df9d20 (task 1), 232fdef (task 2)
- 21 tests pass, TypeScript compiles with zero errors
