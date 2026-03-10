---
phase: quick-8
plan: "01"
subsystem: agent-engine
tags: [observability, logging, file-output, per-bead]
dependency_graph:
  requires: []
  provides: [per-bead-output-files, run-output-dir-path]
  affects: [engine, run-logger, orchestrator, cli-run-agent]
tech_stack:
  added: []
  patterns: [best-effort-file-write, run-id-correlation]
key_files:
  created: []
  modified:
    - src/core/paths.ts
    - src/agent/engine.ts
    - src/agent/run-logger.ts
    - src/daemon/orchestrator.ts
    - src/cli/commands/_run-agent.ts
    - tests/unit/engine.test.ts
    - tests/unit/run-logger.test.ts
decisions:
  - "writeBeadOutput is best-effort (try/catch, warn on failure, never throws) to match existing best-effort JSONL logging pattern"
  - "rawOutput initialized to empty string so catch block can detect partial output from schema validation failures"
  - "run_id added to RunLogEntry as a non-breaking addition (callers must now provide it)"
metrics:
  duration_minutes: 3
  completed_date: "2026-03-10"
  tasks_completed: 2
  files_modified: 7
---

# Quick Task 8: Write Per-Bead Output Files and Make Bead IDs Visible in Logs

**One-liner:** Per-bead JSON output files written to `.nightshift/logs/runs/<runId>/<beadName>.json` with full raw output, plus runId correlation in daemon logs, run log JSONL, and CLI terminal output.

## What Was Built

### Task 1: Per-bead output file writing (TDD)

Added `getRunOutputDir(runId, base)` to `src/core/paths.ts` returning `.nightshift/logs/runs/<runId>`.

Added `writeBeadOutput(runId, beadName, rawOutput)` private method to `AgentEngine`:
- Calls `getRunOutputDir` then `ensureDir` then `fs.writeFile`
- Wrapped in try/catch — logs warning on failure, never throws (best-effort)
- Called after each successful bead completion
- Also called on bead failure when `rawOutput` was captured before the error (handles schema validation failures where the raw output exists but doesn't match the schema)

Changed `let rawOutput: string` to `let rawOutput = ""` so the catch block can check if output was captured before the failure.

4 new tests added to `tests/unit/engine.test.ts` under "per-bead output files" describe block, covering:
- File written with correct path after successful bead
- File content equals full raw output (not truncated)
- File still written on schema validation failure
- `getRunOutputDir` returns correct path

### Task 2: runId visibility in logs and CLI

**`src/agent/run-logger.ts`**: Added `run_id: string` field to `RunLogEntry` interface.

**`src/daemon/orchestrator.ts`**:
- `handleCompleted()` log message now includes `runId` and `perBead` summary (name + status per bead) so daemon operators can correlate with the output directory
- `appendRunLog` call now passes `run_id: result.runId`

**`src/cli/commands/_run-agent.ts`**: After printing Agent/Duration, now prints `Logs: .nightshift/logs/runs/<runId>` so users know exactly where to find the full bead output after a run.

**`tests/unit/run-logger.test.ts`**: Updated `makeEntry()` helper and the "exact fields" test to include `run_id`.

## Deviations from Plan

None — plan executed exactly as written.

## Verification

Full test suite: 424 tests passed across 33 test files.

## Self-Check

Commits made:
- `85ecdbb`: test(quick-8): add failing tests for per-bead output files (RED)
- `f6cc9c1`: feat(quick-8): add per-bead output file writing in AgentEngine (GREEN)
- `bcb60c7`: feat(quick-8): add runId to daemon logs, run log JSONL, and CLI output
