---
phase: 07-config-schema-migration-and-startup-validation
verified: 2026-02-26T16:38:00Z
status: passed
score: 14/14 must-haves verified
---

# Phase 7: Config Schema Migration and Startup Validation — Verification Report

**Phase Goal:** `nightshift.yaml` accepts the new `agents:` array format and the daemon fails at startup — not at 2am — if any referenced agent manifest is broken
**Verified:** 2026-02-26T16:38:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

All truths verified against actual codebase. Sources: 07-01-PLAN.md (7 truths) + 07-02-PLAN.md (7 truths).

#### Plan 07-01 Truths (MIGR-02)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A nightshift.yaml with `agents:` + `schedule:` sections loads successfully and maps to typed NightShiftConfig | VERIFIED | `loadConfig()` test passes; `NightShiftConfig.agents`, `.schedule`, `.agentsDir` confirmed in types.ts lines 86-88 |
| 2 | A nightshift.yaml with old `code_agent:` or `recurring:` keys is rejected by `.strict()` with a standard Zod error | VERIFIED | Tests 7 and 8 in config.test.ts pass; ConfigSchema uses `.strict()` at line 69 of config.ts |
| 3 | A schedule entry referencing an undeclared agent name produces an error containing "Schedule references unknown agent 'foo'" | VERIFIED | Test 10 in config.test.ts passes; `.superRefine()` checks at lines 84-93 of config.ts |
| 4 | Duplicate agent names in `agents:` array are rejected | VERIFIED | Test 9 in config.test.ts passes; duplicate check at lines 72-82 of config.ts |
| 5 | Invalid cron expressions in enabled schedule entries are rejected | VERIFIED | Test 11 in config.test.ts passes; cron check at lines 95-106 of config.ts using `new Cron(entry.cron)` |
| 6 | `getDefaultConfigYaml()` produces YAML showing `agents:` + `schedule:` examples | VERIFIED | Test 21 in config.test.ts passes; `getDefaultConfigYaml()` at lines 200-242 of config.ts contains `agents:`, `schedule:`, `agents_dir:` |
| 7 | TypeScript compiles with strict mode after removing CodeAgentConfig, RecurringTaskConfig, CategoryScheduleConfig | VERIFIED | `npx tsc --noEmit` produces zero errors; removed types relocated to `src/agent/types.ts` (not core) |

**Score (Plan 01):** 7/7

#### Plan 07-02 Truths (WIRE-03)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 8 | nightshift daemon start with a reference to a non-existent agent manifest exits non-zero before the first poll tick | VERIFIED | `validateAgentsAtStartup()` called in `Orchestrator.start()` at line 148, before `pollLoop()` at line 166; throws `ConfigError` → propagates to `process.exit(1)` in daemon/index.ts |
| 9 | nightshift daemon start with an invalid manifest (missing required field) exits non-zero with an actionable error naming the broken manifest | VERIFIED | Tests 3 and 4 in startup-validation.test.ts pass; error message includes agent name and manifest error detail |
| 10 | Startup validation checks ALL agents and reports ALL errors at once, not fail-on-first-agent | VERIFIED | `errors: string[]` accumulation pattern at lines 45-96 of orchestrator.ts; test 12 verifies "2 error(s)" for two broken agents |
| 11 | Startup validation checks prompt file existence for each bead in each manifest | VERIFIED | `fs.readFile(promptPath)` in try/catch at lines 57-63 of orchestrator.ts; test 5 confirms "prompt file not found" error |
| 12 | Startup validation checks template variables are resolvable (built-ins + manifest + config overrides + schedule overrides) | VERIFIED | `validateTemplateVars(promptContent, allKnownVars)` at line 83 of orchestrator.ts; tests 6-11 verify all variable resolution paths |
| 13 | Startup validation checks that required env vars are set in the host environment | VERIFIED | Delegated to `loadManifest()` (Phase 6 implementation); test 14 in startup-validation.test.ts confirms `ManifestError` from env var check propagates correctly |
| 14 | If agents array is empty, startup validation is a no-op (daemon starts normally) | VERIFIED | Early return at line 30 of orchestrator.ts; test 1 in startup-validation.test.ts confirms no `loadManifest` calls and no throw |

**Score (Plan 02):** 7/7

**Overall Score:** 14/14 truths verified

---

## Required Artifacts

### Plan 07-01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/core/config.ts` | AgentDeclarationSchema, ScheduleEntrySchema, ConfigSchema with .strict(), mapConfig for new types | VERIFIED | All schemas present at lines 17-107; `.strict()` at line 69; `.superRefine()` at line 70; `mapConfig` at line 111 |
| `src/core/types.ts` | AgentDeclaration, ScheduleEntry interfaces; updated NightShiftConfig with agents, schedule, agentsDir | VERIFIED | `AgentDeclaration` at line 49; `ScheduleEntry` at line 55; `NightShiftConfig` updated at lines 79-91 |
| `tests/unit/config.test.ts` | Full test coverage for new schema: 21 tests | VERIFIED | 320 lines; 21 tests; all pass in 29ms |

### Plan 07-02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/daemon/orchestrator.ts` | validateAgentsAtStartup() called in Orchestrator.start() before pollLoop() | VERIFIED | Exported function at line 26; called at line 148 in `start()`; `pollLoop()` at line 166 |
| `tests/unit/startup-validation.test.ts` | Unit tests for startup validation with mocked loadManifest | VERIFIED | 418 lines; 14 tests; all pass in 14ms |

---

## Key Link Verification

### Plan 07-01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/core/config.ts` | `src/core/types.ts` | `mapConfig` maps RawConfig to NightShiftConfig | WIRED | `mapConfig()` at lines 111-151 maps `agents_dir` → `agentsDir`, `agents` array, `schedule` array |
| `src/daemon/orchestrator.ts` | `src/core/config.ts` | `loadConfig()` in start() and tick() | WIRED | `loadConfig()` called at line 127 in `start()` and line 223 in `tick()` |
| `src/daemon/scheduler.ts` | `src/core/types.ts` | NightShiftConfig type import | WIRED | `import type { NightShiftConfig, NightShiftTask }` at line 3 of scheduler.ts |

### Plan 07-02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/daemon/orchestrator.ts` | `src/agent/manifest-loader.ts` | `loadManifest()` called per agent in validateAgentsAtStartup() | WIRED | Import at line 16; `await loadManifest(agentDir, agentsRoot)` at line 51 |
| `src/daemon/orchestrator.ts` | `src/agent/template.ts` | `validateTemplateVars()` called per bead prompt | WIRED | Import at line 17; `validateTemplateVars(promptContent, allKnownVars)` at line 83 |
| `src/daemon/orchestrator.ts` | `src/core/errors.ts` | `ConfigError` thrown when validation fails | WIRED | Import at line 18; `throw new ConfigError(msg)` at line 99 |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MIGR-02 | 07-01 | `nightshift.yaml` uses `agents:` array where each entry references an agent by name with schedule and variables | SATISFIED | ConfigSchema has `agents` + `schedule` arrays; `.strict()` rejects old keys; 21 tests pass; marked `[x]` in REQUIREMENTS.md |
| WIRE-03 | 07-02 | Daemon validates all referenced agent manifests at startup and fails with actionable error if any are broken | SATISFIED | `validateAgentsAtStartup()` wired in `Orchestrator.start()` before poll loop; 14 tests pass; marked `[x]` in REQUIREMENTS.md |

No orphaned requirements — REQUIREMENTS.md traceability table maps both MIGR-02 and WIRE-03 to Phase 7 and marks them Complete.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/daemon/scheduler.ts` | 37 | `return []` stub in `evaluateSchedules()` | Info | Intentional — documented in plan as Phase 10 work; does not block Phase 7 goal |
| `src/daemon/orchestrator.ts` | 232 | Comment "Evaluate cron schedules → create beads for due **recurring** tasks" | Info | Stale comment wording referencing "recurring"; no functional impact |

No blocker anti-patterns. The scheduler stub is explicitly planned for Phase 10.

---

## Human Verification Required

None. All goal-critical behaviors are fully verifiable programmatically:
- Schema validation logic is tested by unit tests
- Startup validation function is tested with real filesystem + mocked `loadManifest`
- TypeScript compilation verified via `tsc --noEmit`
- Test suite runs deterministically (`35 tests passed` in 664ms)

---

## Commits

All commits referenced in SUMMARY files verified to exist in git log:

| Commit | Description |
|--------|-------------|
| `4c04e02` | feat(07-01): rewrite config schema to agents+schedule model, update daemon and CLI |
| `39bfc08` | test(07-01): rewrite config.test.ts for agents+schedule schema |
| `84cecd6` | feat(07-02): implement validateAgentsAtStartup and wire into orchestrator |
| `6f15e45` | test(07-02): add 14 unit tests for startup validation |

---

## Summary

Phase 7 fully achieves its stated goal. The `nightshift.yaml` config schema has been completely migrated from the hardcoded `code_agent:` + `recurring:` model to the new `agents:` + `schedule:` array model. The ConfigSchema uses `.strict()` to immediately reject any YAML using old keys, and `.superRefine()` for cross-entity validation (duplicate names, unknown agent references, invalid cron expressions). The daemon now performs an eager startup validation gate via `validateAgentsAtStartup()` — called before the poll loop enters — that loads every declared agent's manifest via `loadManifest()`, checks prompt file existence for each bead, validates template variables against the full variable resolution chain (manifest defaults → agent-level overrides → schedule-level overrides → built-in placeholders), and collects all errors before throwing a single descriptive `ConfigError`. If validation fails, the throw propagates to `daemon/index.ts` which calls `process.exit(1)` — the daemon never enters its poll loop.

Both requirement IDs (MIGR-02, WIRE-03) are satisfied with implementation evidence and passing tests.

---

_Verified: 2026-02-26T16:38:00Z_
_Verifier: Claude (gsd-verifier)_
