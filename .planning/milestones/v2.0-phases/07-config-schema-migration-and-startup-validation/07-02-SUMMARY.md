---
phase: 07-config-schema-migration-and-startup-validation
plan: 02
subsystem: daemon
tags: [startup-validation, orchestrator, manifest-loader, template-vars, config-error]

requires:
  - phase: 07-01
    provides: NightShiftConfig with agents+schedule shape, AgentDeclaration, ScheduleEntry types
  - phase: 06-plugin-interfaces-and-manifest-schema
    provides: loadManifest(), validateTemplateVars(), BUILT_IN_VARS, LoadedManifest

provides:
  - validateAgentsAtStartup() exported from src/daemon/orchestrator.ts
  - Daemon exits non-zero before first poll tick when any agent manifest is broken
  - 14 unit tests covering all startup validation paths

affects:
  - 08-agent-engine (orchestrator.start() now has a validation gate before pollLoop)
  - 10-scheduling-wiring (schedule entries' variables are validated at startup)

tech-stack:
  added: []
  patterns:
    - "Collect-all-errors pattern: iterate all agents, push errors to array, throw once at the end"
    - "Variable resolution precedence: manifest.variables < agent.variables < built-ins (all merged before validateTemplateVars)"
    - "Schedule-level overrides collected per agent via Map before iteration"
    - "beads.* variables skipped at startup validation (only resolved at runtime)"

key-files:
  created:
    - tests/unit/startup-validation.test.ts
  modified:
    - src/daemon/orchestrator.ts

key-decisions:
  - "validateAgentsAtStartup placed before heartbeat timer and before logger.info('Daemon started') in start() — validation failure exits before any daemon logging happens"
  - "Prompt file reads are real fs.readFile() calls — no mocking; only loadManifest is mocked in tests"
  - "builtInPlaceholders injected as string values (e.g. '<task_id>') so validateTemplateVars sees them as defined, not undefined"

patterns-established:
  - "Startup gate pattern: validate all external dependencies before entering main loop; collect all errors before throwing"

requirements-completed:
  - WIRE-03

duration: 2min
completed: 2026-02-26
---

# Phase 7 Plan 02: Startup Validation Summary

**validateAgentsAtStartup() wired into Orchestrator.start() — daemon fails fast before first poll tick if any agent manifest is missing, schema-invalid, has missing prompt files, or references undefined template variables**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-26T16:32:49Z
- **Completed:** 2026-02-26T16:34:52Z
- **Tasks:** 2
- **Files modified:** 1 modified, 1 created

## Accomplishments

- `validateAgentsAtStartup()` exported from `src/daemon/orchestrator.ts` — testable independently from daemon startup
- Wired in `Orchestrator.start()` after `writeHeartbeat()` and before heartbeat timer and `pollLoop()` — throws propagate to `daemon/index.ts` `.catch()` which calls `process.exit(1)`
- Empty `agents` array is a no-op — daemon starts normally with no agents declared
- Each agent is validated by calling `loadManifest()` which handles: path containment, YAML parse, Zod schema validation, env var resolution
- For each bead: prompt file existence checked with real `fs.readFile()`
- Template variables validated with `validateTemplateVars()` using merged variable map (manifest defaults + agent-level config overrides + all schedule-level overrides + built-in placeholders)
- All errors collected across all agents/beads before throwing a single `ConfigError` with numbered error list
- 14 tests pass covering all documented validation paths

## Task Commits

1. **Task 1: Implement validateAgentsAtStartup and wire into orchestrator** — `84cecd6` (feat)
2. **Task 2: Write comprehensive startup validation tests** — `6f15e45` (test)

## Files Created/Modified

- `src/daemon/orchestrator.ts` — Added 3 new imports (loadManifest, BUILT_IN_VARS/validateTemplateVars, ConfigError); added 80-line `validateAgentsAtStartup()` function; wired call in `start()`
- `tests/unit/startup-validation.test.ts` — 418 lines, 14 tests with vi.mock for loadManifest and real tmpdir filesystem

## Decisions Made

- `validateAgentsAtStartup` call placed after `writeHeartbeat()` and before the `logger.info("Daemon started")` log message and heartbeat timer setup — validation failure exits silently without the "Daemon started" log being emitted
- Built-in placeholder values injected as `"<task_id>"` strings so `validateTemplateVars()` sees them as defined (not undefined) — this correctly allows prompts using built-ins to pass validation
- Prompt file reads use real `fs.readFile()` in the implementation; tests mock only `loadManifest` and create real prompt files on disk in a tmpdir — this keeps the template validation path fully exercised by real code

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED
