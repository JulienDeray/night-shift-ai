---
phase: 11-developer-experience
plan: 01
subsystem: cli
tags: [commander, yaml, scaffold, agent-management]

requires:
  - phase: 06-manifest-schema
    provides: ManifestSchema, manifest-loader, manifest-types
  - phase: 07-config-migration
    provides: NightShiftConfig with agents/schedule arrays
  - phase: 10-daemon-wiring
    provides: run-logger with RunLogEntry, CLI command patterns
provides:
  - scaffoldAgent() function for creating agent directories with manifest and prompts
  - agent CLI subcommand group (init, validate, list, show)
  - Agent inspection and validation tooling for developers
affects: [12-documentation, future-agent-templates]

tech-stack:
  added: []
  patterns: [CLI subcommand group pattern with Commander, two-pass manifest validation]

key-files:
  created:
    - src/agent/scaffold.ts
    - src/cli/commands/agent.ts
  modified:
    - src/cli/index.ts

key-decisions:
  - "Two-pass validate: ManifestSchema.safeParse for schema, loadManifest for env vars (env missing = warning not error)"
  - "scaffold uses parseYaml for raw config editing to avoid Zod schema enforcement on nightshift.yaml write-back"
  - "agent list and show use parseYaml (not loadManifest) to avoid env var errors when inspecting agents"

patterns-established:
  - "CLI subcommand group: new Command('agent') with chained .command() calls, matching config.ts pattern"
  - "Two-pass validation: schema-only parse first, then full loadManifest for env resolution"

requirements-completed: [DX-01, DX-02, DX-03]

duration: 3min
completed: 2026-03-09
---

# Phase 11 Plan 01: Agent CLI Subcommands Summary

**scaffoldAgent() module and four CLI subcommands (init, validate, list, show) for agent lifecycle management**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-09T17:50:01Z
- **Completed:** 2026-03-09T17:53:13Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- scaffoldAgent() creates complete agent directories with manifest.yaml, preamble.md, clone-stub.md, and analyze.md
- agent init command scaffolds agents and optionally registers them in nightshift.yaml
- agent validate performs schema, prompt, variable, and env var checks with warnings for missing env vars
- agent list shows table of discovered agents with bead count, schedule, and last run info
- agent show displays manifest summary, bead pipeline, schedule, and recent run history

## Task Commits

Each task was committed atomically:

1. **Task 1: Create scaffold logic module** - `94fb83a` (feat)
2. **Task 2: Create agent CLI subcommand group** - `c48d047` (feat)

## Files Created/Modified
- `src/agent/scaffold.ts` - Agent scaffolding logic with manifest and prompt generation
- `src/cli/commands/agent.ts` - Commander subcommand group with init, validate, list, show
- `src/cli/index.ts` - Registered agentCommand in CLI program

## Decisions Made
- Two-pass validation approach in `agent validate`: first ManifestSchema.safeParse for schema-only check, then loadManifest to test env var resolution (missing env vars downgraded to warnings)
- scaffold.ts uses raw YAML parse/stringify for nightshift.yaml editing to avoid Zod schema enforcement on write-back
- agent list and show use parseYaml (not loadManifest) to avoid throwing on missing env vars when inspecting agents

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Agent CLI tooling complete, ready for documentation or additional agent templates
- All existing tests pass (350/350)
- TypeScript compiles cleanly

---
*Phase: 11-developer-experience*
*Completed: 2026-03-09*
