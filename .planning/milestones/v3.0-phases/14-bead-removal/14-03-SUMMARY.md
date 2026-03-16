---
phase: 14-bead-removal
plan: "03"
subsystem: tests
tags: [bead-removal, test-migration, step-terminology, scaffold]
dependency_graph:
  requires: [14-01, 14-02]
  provides: [clean-test-suite, zero-bead-references]
  affects: [all-tests]
tech_stack:
  added: []
  patterns: [step-based-testing, spawnWithTimeout-mocking]
key_files:
  created:
    - tests/unit/step-runner.test.ts
  modified:
    - src/agent/scaffold.ts
    - src/agent/prompt-loader.ts
    - src/agent/template.ts
    - src/agent/agent-types.ts
    - src/agent/prompts/analyze.md
    - src/agent/prompts/implement.md
    - src/agent/prompts/verify.md
    - src/agent/prompts/log.md
    - src/agent/prompts/mr.md
    - tests/unit/engine.test.ts
    - tests/unit/manifest-schema.test.ts
    - tests/unit/manifest-loader.test.ts
    - tests/unit/agent-pool.test.ts
    - tests/unit/startup-validation.test.ts
    - tests/unit/config.test.ts
    - tests/unit/orchestrator.test.ts
    - tests/unit/reporter.test.ts
    - tests/unit/scaffold.test.ts
    - tests/unit/temp-dir-manager.test.ts
    - tests/unit/template-agent.test.ts
    - tests/unit/scheduler.test.ts
    - tests/unit/prompt-loader.test.ts
    - tests/integration/run.test.ts
    - tests/integration/agent-commands.test.ts
    - tests/integration/submit.test.ts
    - tests/integration/cancel.test.ts
    - tests/integration/status.test.ts
    - tests/integration/inbox.test.ts
    - tests/integration/schedule.test.ts
  deleted:
    - tests/unit/bead-registry.test.ts
    - tests/unit/standard-bead-plugin.test.ts
    - tests/unit/git-clone-bead-plugin.test.ts
    - tests/unit/git-harness.test.ts
    - tests/unit/mapper.test.ts
    - tests/unit/bead-runner.test.ts
decisions:
  - "loadBeadPrompt renamed to loadStepPrompt (only exposed symbol with bead in name)"
  - "resolveNestedValue test fixtures updated from beads.* to steps.* for consistency"
  - "agent prompt .md files updated: Bead -> Step in role descriptions"
metrics:
  duration: ~30min
  completed: 2026-03-13
  tasks_completed: 2
  files_changed: 35
  tests_passing: 381
---

# Phase 14 Plan 03: Test Migration and Final Bead Sweep Summary

Deleted 6 obsolete bead test files, renamed bead-runner.test.ts to step-runner.test.ts, updated all remaining tests to step terminology, renamed loadBeadPrompt to loadStepPrompt, updated agent prompt templates, and verified zero bead references remain in the entire codebase with 381/381 tests passing.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Delete obsolete tests, rename and update remaining tests | 3b32b95 | 6 deleted, 21 modified, 1 created |
| 2 | Update scaffold template and final bead-word sweep | d8d6fcc | scaffold.ts, prompt-loader.ts, 5 prompt .md files |

## What Was Built

**Task 1:** Deleted 6 obsolete bead test files (bead-registry, standard-bead-plugin, git-clone-bead-plugin, git-harness, mapper, bead-runner). Created `tests/unit/step-runner.test.ts` (renamed from bead-runner.test.ts) testing `runStep`, `buildStepEnv`, `buildStepArgs`. Rewrote engine.test.ts to mock at `spawnWithTimeout` level. Updated all remaining unit and integration tests: `steps` array, `perStep`, `stepCount`, `StepContractViolationError`, `StepOutputMissingError`, `STEP_*` error codes. Removed `beads: enabled: false` from all integration test config YAML strings.

**Task 2:** Updated `src/agent/scaffold.ts` to remove `variables: { repo_url: "" }` and the `repo_url` from the schedule entry, updated next-steps message. Renamed `loadBeadPrompt` to `loadStepPrompt` in `prompt-loader.ts` and updated its test. Updated all 5 agent prompt `.md` files to use "step" instead of "bead" in role descriptions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] src/agent/template.ts still used beads namespace internally**
- **Found during:** Task 1 (template-agent.test.ts failures)
- **Issue:** `buildTemplateVars` stored step outputs under `merged.beads` and `validateTemplateVars` skipped `beads.*` prefixes, so `steps.*` template references did not resolve
- **Fix:** Changed `merged.beads` to `merged.steps`, `key.startsWith("beads.")` to `key.startsWith("steps.")`, renamed parameter from `beadOutputs` to `stepOutputs`
- **Files modified:** `src/agent/template.ts`
- **Commit:** 3b32b95

**2. [Rule 1 - Bug] scheduler.test.ts had stale beads: { enabled: false } in makeConfig()**
- **Found during:** Task 1 full test run
- **Issue:** `NightShiftConfig` no longer has a `beads` field (removed in Plan 02), but scheduler.test.ts still passed `beads: { enabled: false }` causing TypeScript errors
- **Fix:** Removed the stale field
- **Files modified:** `tests/unit/scheduler.test.ts`
- **Commit:** 3b32b95

**3. [Rule 1 - Bug] inbox.test.ts and schedule.test.ts still had beads: enabled: false in config YAML**
- **Found during:** Task 1 integration test run
- **Issue:** Config YAML strings caused "Unrecognized key: beads" validation errors, making all inbox and schedule tests fail with exit code 1
- **Fix:** Removed `beads:\n  enabled: false\n` sections from both files
- **Files modified:** `tests/integration/inbox.test.ts`, `tests/integration/schedule.test.ts`
- **Commit:** 3b32b95

**4. [Rule 1 - Bug] prompt-loader.ts exported loadBeadPrompt — only public symbol with bead in name**
- **Found during:** Task 2 final sweep
- **Issue:** `grep -rn "bead" src/ --include="*.ts"` revealed `loadBeadPrompt` was not renamed
- **Fix:** Renamed to `loadStepPrompt` in source and test
- **Files modified:** `src/agent/prompt-loader.ts`, `tests/unit/prompt-loader.test.ts`
- **Commit:** d8d6fcc

**5. [Rule 1 - Bug] Agent prompt .md files in src/agent/prompts/ still used "Bead" in role descriptions**
- **Found during:** Task 2 final MD sweep
- **Issue:** Plan specified checking `.md` files; 5 prompt files had "Analyze Bead", "Implement Bead", "Verify Bead", "MR Bead", "log bead" in their content
- **Fix:** Updated all 5 files: "Bead" -> "Step" in titles and role descriptions
- **Files modified:** analyze.md, implement.md, verify.md, log.md, mr.md
- **Commit:** d8d6fcc

## Verification Results

```
npm test: 381/381 tests pass (29 test files)
npx tsc --noEmit: clean (no errors)
grep bead in .ts files: 0 occurrences
Deleted files confirmed missing: 6/6
step-runner.test.ts: exists
```

## Self-Check: PASSED
