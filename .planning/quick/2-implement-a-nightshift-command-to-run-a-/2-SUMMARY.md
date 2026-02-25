---
phase: quick-2
plan: "01"
subsystem: cli
tags: [cli, run-command, code-agent, foreground-execution]
dependency_graph:
  requires: []
  provides: [nightshift-run-command]
  affects: [src/cli/index.ts, src/cli/commands/run.ts]
tech_stack:
  added: []
  patterns: [commander-js, direct-agent-runner-instantiation, cli-formatters]
key_files:
  created:
    - src/cli/commands/run.ts
    - tests/integration/run.test.ts
  modified:
    - src/cli/index.ts
decisions:
  - "Validate --code-agent and prompt as mutually exclusive at runtime rather than schema level"
  - "Warn (not error) on missing GITLAB_TOKEN since SSH clone works without it"
  - "Use Logger.createCliLogger(true) for verbose output in foreground mode"
metrics:
  duration: "14 minutes"
  completed: "2026-02-25"
  tasks_completed: 2
  files_created: 2
  files_modified: 1
---

# Quick Task 2: nightshift run Command Summary

**One-liner:** Foreground `nightshift run` command that executes tasks directly via AgentRunner or runCodeAgent, bypassing the daemon queue entirely.

## What Was Built

Added a `nightshift run` CLI command that supports two execution modes:

1. **Generic task mode** (`nightshift run <prompt>`): constructs a NightShiftTask and runs it directly via a new AgentRunner instance, printing a structured summary (name, duration, cost, result excerpt) on completion.

2. **Code-agent mode** (`nightshift run --code-agent`): calls `runCodeAgent()` directly with config loaded from `nightshift.yaml`, printing outcome, category, MR URL (if any), duration, and cost.

Both modes support `--notify` for ntfy push notifications on start/end, and exit with code 0 on success or 1 on error.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create `nightshift run` command | 6dddca2 | src/cli/commands/run.ts, src/cli/index.ts |
| 2 | Add integration tests | acad107 | tests/integration/run.test.ts |

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

Files verified:
- FOUND: src/cli/commands/run.ts
- FOUND: tests/integration/run.test.ts
- FOUND: src/cli/index.ts (modified)

Commits verified:
- FOUND: 6dddca2 feat(quick-2): add nightshift run command
- FOUND: acad107 test(quick-2): add integration tests for nightshift run command

Tests: 251/251 passed (7 new integration tests, no regressions)
TypeScript: 0 errors (npx tsc --noEmit clean)
