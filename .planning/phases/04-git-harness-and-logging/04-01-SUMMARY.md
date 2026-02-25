---
phase: 04-git-harness-and-logging
plan: 01
subsystem: agent
tags: [git, tdd, logging, config]
dependency_graph:
  requires: []
  provides: [cloneRepo, cleanupDir, appendRunLog, RunLogEntry, CloneResult]
  affects: [src/core/config.ts, src/core/types.ts]
tech_stack:
  added: []
  patterns: [TDD red-green, vitest mocking, JSONL append, shallow git clone]
key_files:
  created:
    - src/agent/git-harness.ts
    - src/agent/run-logger.ts
    - tests/unit/git-harness.test.ts
    - tests/unit/run-logger.test.ts
  modified:
    - src/core/config.ts
    - src/core/types.ts
decisions:
  - GIT_CONFIG_NOSYSTEM=1 blocks host git config contamination during clone — explicitly set in cloneEnv
  - SSH_AUTH_SOCK forwarded explicitly into cloneEnv so SSH key agent works inside the sandboxed env
  - cleanupDir swallows all errors to never mask original clone failure
  - JSONL append (not overwrite) for run-logger to allow multiple entries per session
  - log_mcp_config added as optional string to support Confluence log bead in Plan 02
metrics:
  duration: 3 min
  completed: 2026-02-25
  tasks_completed: 2
  files_created: 4
  files_modified: 2
---

# Phase 04 Plan 01: Git Harness and Run Logger Summary

**One-liner:** TDD-implemented shallow git clone harness with unconditional cleanup and JSONL run logger, plus config schema extended with log prompt path and log_mcp_config.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 (RED) | git-harness failing tests | 4c65ef0 | tests/unit/git-harness.test.ts |
| 1 (GREEN) | git-harness implementation | 5408bac | src/agent/git-harness.ts |
| 2 (RED) | run-logger failing tests | 30e4529 | tests/unit/run-logger.test.ts |
| 2 (GREEN) | run-logger implementation | a43331d | src/agent/run-logger.ts |
| 2 (config) | config schema extension | 9bdd92e | src/core/config.ts, src/core/types.ts |

## What Was Built

### git-harness.ts

Exports `cloneRepo(repoUrl, gitlabToken)` and `cleanupDir(dirPath)`:

- `cloneRepo` creates two temp dirs under `os.tmpdir()`: `night-shift-repo-<runId>-` and `night-shift-handoff-<runId>-`
- Passes a minimal env to `spawnWithTimeout` with only `HOME`, `PATH`, `SSH_AUTH_SOCK`, `GIT_CONFIG_NOSYSTEM: "1"`, and optionally `GITLAB_TOKEN`
- Returns `{ repoDir, handoffDir }` on exitCode 0
- On non-zero exit, calls `cleanupDir` on both dirs and throws `"git clone failed (exit N): <stderr>"`
- `cleanupDir` calls `fs.rm(path, { recursive: true, force: true })` and swallows any error

### run-logger.ts

Exports `appendRunLog(entry, base?)` and the `RunLogEntry` interface:

- Calls `getLogsDir(base)` then `ensureDir(logsDir)` before any write
- Appends `JSON.stringify(entry) + "\n"` to `.nightshift/logs/code-agent-runs.jsonl` with utf-8 encoding
- `RunLogEntry` has locked fields: `date`, `category`, `mr_url`, `cost_usd`, `duration_seconds`, `summary`

### Config Schema Extension

- `CodeAgentSchema.prompts` extended with `log: z.string().default("./prompts/log.md")`
- `CodeAgentSchema` extended with `log_mcp_config: z.string().optional()`
- `mapConfig` maps `log_mcp_config` to `logMcpConfig`
- `CodeAgentConfig` interface updated with `prompts.log` and `logMcpConfig?: string`
- `getDefaultConfigYaml` updated with commented examples for both new fields

## Test Coverage

- git-harness: 9 tests — temp dir prefixes, clone env (GIT_CONFIG_NOSYSTEM, SSH_AUTH_SOCK, GITLAB_TOKEN presence/absence), success return, failure cleanup and throw, cleanupDir behavior
- run-logger: 7 tests — ensureDir call, file path suffix, JSON line format, locked fields, null mr_url, multiple calls, utf-8 encoding
- All 217 existing tests continue to pass (no regressions)

## Deviations from Plan

None — plan executed exactly as written. The SSH_AUTH_SOCK test was added as a 9th git-harness test (plan mentioned 8 cases) since "preserves SSH_AUTH_SOCK" is a stated truth in must_haves.

## Self-Check

### Created files exist
- src/agent/git-harness.ts: present
- src/agent/run-logger.ts: present
- tests/unit/git-harness.test.ts: present
- tests/unit/run-logger.test.ts: present

### Commits exist
- 4c65ef0: test(04-01): add failing tests for git-harness cloneRepo and cleanupDir
- 5408bac: feat(04-01): implement git-harness with clone lifecycle and unconditional cleanup
- 30e4529: test(04-01): add failing tests for run-logger JSONL append
- a43331d: feat(04-01): implement run-logger with JSONL append
- 9bdd92e: feat(04-01): extend config schema with log prompt path and log_mcp_config

## Self-Check: PASSED
