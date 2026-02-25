---
phase: 01-notification-foundation
plan: 01
subsystem: config
tags: [zod, typescript, yaml, nightshift-config, ntfy, code-agent]

# Dependency graph
requires: []
provides:
  - NtfyConfig interface and NtfyConfigSchema Zod schema (topic, optional token, base_url with default)
  - CodeAgentConfig interface and CodeAgentSchema Zod schema (SSH repo_url regex, confluence_page_id, category_schedule)
  - CategoryScheduleConfig interface and CategoryScheduleSchema (strict object, all 7 days optional, rejects typos)
  - notify?: boolean on RecurringTaskConfig and RecurringTaskSchema
  - ntfy?: NtfyConfig and codeAgent?: CodeAgentConfig on NightShiftConfig
  - Updated mapConfig() mapping all new fields from snake_case YAML to camelCase TypeScript
  - Updated getDefaultConfigYaml() with commented-out ntfy and code_agent examples
  - 10 new unit tests covering all new config blocks and validation rules
affects:
  - 01-02 (NtfyClient consumes NtfyConfig from config)
  - Phase 2 (orchestrator reads ntfy and codeAgent from NightShiftConfig)
  - Phase 3 (prompt builder reads codeAgent.categorySchedule)
  - Phase 4 (git harness reads codeAgent.repoUrl and confluencePageId)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Optional top-level config block pattern (z.object(...).optional()) — used for ntfy and code_agent
    - Strict category schedule schema (z.object with all days optional + .strict()) — rejects typos like "munday"
    - SSH git URL regex validation in Zod schema
    - snake_case YAML keys mapped to camelCase TypeScript properties in mapConfig()

key-files:
  created: []
  modified:
    - src/core/types.ts
    - src/core/config.ts
    - tests/unit/config.test.ts

key-decisions:
  - "Use z.object().strict() for CategoryScheduleSchema instead of z.record(z.enum(...)) — Zod v4 z.record with enum key requires ALL enum keys present"
  - "NtfyConfigSchema and CodeAgentSchema are .optional() at the outer object level so daemon starts without either block"
  - "confluence_page_id is required (z.string().min(1)) not optional — per user constraints"
  - "repo_url validated by SSH regex pattern at config load time — fails fast on misconfiguration"

patterns-established:
  - "Pattern 1: Optional top-level block — z.object({...}).optional() produces undefined when absent, typed object when present"
  - "Pattern 2: Strict day-of-week map — z.object({monday, tuesday, ...all optional}).strict() rejects unknown keys"

requirements-completed: [NTFY-01, NTFY-06, CONF-01, CONF-02]

# Metrics
duration: 2min
completed: 2026-02-23
---

# Phase 1 Plan 01: Config Schema Extension Summary

**Zod v4 schemas for ntfy notification config, code_agent config, and per-task notify opt-in with strict day-of-week validation and SSH URL regex enforcement**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-23T15:08:58Z
- **Completed:** 2026-02-23T15:11:08Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Extended NightShiftConfig with optional ntfy and codeAgent fields and corresponding Zod schemas
- Added CategoryScheduleSchema with .strict() so typos like "munday" fail validation at config load
- Added SSH git URL regex validation for code_agent.repo_url
- Added notify?: boolean to RecurringTaskConfig with full schema and mapConfig() support
- Updated getDefaultConfigYaml() with commented-out ntfy and code_agent examples
- Added 10 unit tests covering all new validation rules (18 tests total, all passing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add ntfy, code_agent, and notify schemas and types** - `fb42719` (feat)
2. **Task 2: Add config validation unit tests for new blocks** - `fea4079` (test)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified
- `src/core/types.ts` - Added NtfyConfig, CategoryScheduleConfig, CodeAgentConfig interfaces; notify field on RecurringTaskConfig; ntfy and codeAgent fields on NightShiftConfig
- `src/core/config.ts` - Added CategoryScheduleSchema, NtfyConfigSchema, CodeAgentSchema, notify to RecurringTaskSchema, ntfy/code_agent to ConfigSchema; updated mapConfig() and getDefaultConfigYaml()
- `tests/unit/config.test.ts` - Added 10 test cases for ntfy, code_agent, notify, and getDefaultConfigYaml

## Decisions Made
- Used `z.object(...).strict()` for CategoryScheduleSchema rather than `z.record(z.enum(...))` — Zod v4 z.record with an enum key requires ALL enum keys to be present, making partial maps impossible. The strict-object approach allows any subset of days.
- `NtfyConfigSchema` and `CodeAgentSchema` use `.optional()` on the outer object, so both blocks are fully absent when not in YAML. The daemon starts cleanly without either.
- `confluence_page_id` is required (`z.string().min(1)`) per user constraints — not optional.
- SSH regex validation (`/^git@[a-zA-Z0-9._-]+:[a-zA-Z0-9._\/-]+\.git$/`) catches HTTPS URLs at config load time.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Config plumbing is complete. Plan 02 (NtfyClient) can import NtfyConfig from types.ts and proceed.
- NightShiftConfig now exposes ntfy and codeAgent fields ready for Phase 2 orchestrator integration.
- All Zod validation rules are in place and tested — no changes needed before Plan 02.

## Self-Check: PASSED

- FOUND: src/core/types.ts
- FOUND: src/core/config.ts
- FOUND: tests/unit/config.test.ts
- FOUND: .planning/phases/01-notification-foundation/01-01-SUMMARY.md
- FOUND commit: fb42719 (feat: schemas and types)
- FOUND commit: fea4079 (test: unit tests)

---
*Phase: 01-notification-foundation*
*Completed: 2026-02-23*
