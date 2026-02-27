---
phase: 08-agentengine-and-bead-plugin-implementations
plan: "01"
subsystem: agent-engine
tags: [engine-types, bead-plugins, temp-dir, api-widening]
dependency_graph:
  requires:
    - "06-01: BeadPlugin interface, AgentPipelineContext"
    - "06-02: manifest-loader, validateBeadOutput"
    - "06-03: renderAgentTemplate, parseTimeout, template system"
  provides:
    - "AgentRunResult<T>, BeadErrorCategory for AgentEngine (Plan 02)"
    - "TempDirManager for AgentEngine temp dir lifecycle"
    - "StandardBeadPlugin and GitCloneBeadPlugin for BeadRegistry"
    - "Widened runBead()/cloneRepo() APIs (string beadName, optional repoDir)"
  affects:
    - "08-02: AgentEngine uses all four artifacts directly"
tech_stack:
  added: []
  patterns:
    - "Plugin pattern: thin wrappers mapping AgentPipelineContext to existing infrastructure"
    - "GITLAB_TOKEN gating moved from bead name to caller presence of gitlabToken arg"
    - "Engine-owned temp dir lifecycle with static orphan cleanup"
key_files:
  created:
    - src/agent/engine-types.ts
    - src/agent/temp-dir-manager.ts
    - src/agent/plugins/standard-bead-plugin.ts
    - src/agent/plugins/git-clone-bead-plugin.ts
    - tests/unit/temp-dir-manager.test.ts
    - tests/unit/standard-bead-plugin.test.ts
    - tests/unit/git-clone-bead-plugin.test.ts
  modified:
    - src/agent/bead-runner.ts
    - src/agent/git-harness.ts
decisions:
  - "GITLAB_TOKEN gating changed from beadName==='mr' to gitlabToken presence — removes code-agent-specific logic from shared infrastructure"
  - "cloneRepo() caller-provided repoDir skips mkdtemp; on clone failure, only handoffDir is cleaned (caller owns repoDir lifecycle)"
  - "StandardBeadPlugin reads prompt file and renders template inline — no separate prompt-loader indirection"
  - "GitCloneBeadPlugin uses ctx.workDir as the pre-created repo directory — engine pre-creates this via TempDirManager"
metrics:
  duration: "~4 minutes"
  completed_date: "2026-02-27"
  tasks_completed: 2
  tests_added: 20
  files_created: 7
  files_modified: 2
---

# Phase 8 Plan 01: Engine Types, TempDirManager, and Bead Plugin Implementations Summary

**One-liner:** Engine type system (AgentRunResult<T>, BeadErrorCategory) plus TempDirManager and two thin plugin wrappers (StandardBeadPlugin, GitCloneBeadPlugin) that map AgentPipelineContext to existing runBead()/cloneRepo() infrastructure.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Engine types, TempDirManager, API widening | 03c7ebb | engine-types.ts, temp-dir-manager.ts, bead-runner.ts, git-harness.ts, temp-dir-manager.test.ts |
| 2 | StandardBeadPlugin and GitCloneBeadPlugin with tests | c907aab | plugins/standard-bead-plugin.ts, plugins/git-clone-bead-plugin.ts, standard-bead-plugin.test.ts, git-clone-bead-plugin.test.ts |

## What Was Built

### engine-types.ts

Defines the typed contracts for AgentEngine results:
- `BeadErrorCategory`: `"FATAL" | "TRANSIENT"` — classifies whether a failure is recoverable
- `PipelineStatus`: `"SUCCESS" | "FATAL" | "TRANSIENT"` — overall pipeline outcome
- `BeadOutcome`: Per-bead execution record with name, status, durationMs, error
- `AgentRunResult<T>`: Generic result with runId, agentName, status, finalOutput, perBead, totalDurationMs, failedBeadIndex (restart hint), errorCategory, suggestedDelayMs (retry hint), error

### temp-dir-manager.ts

Manages isolated temp directories for each engine run:
- `create(runId)`: Creates `/tmp/nightshift-{runId}/` with `repo/` and `handoff/` subdirectories
- `cleanup(tmpDir)`: Removes directory, never rethrows (warns on failure)
- `static cleanupOrphans(logger, maxAgeMs?)`: Scans os.tmpdir() for `nightshift-*` dirs older than 1 hour (default), removes them

### bead-runner.ts changes

- `buildBeadEnv()` and `runBead()`: `beadName` widened from `"analyze" | "implement" | "verify" | "mr" | "log"` to `string`
- GITLAB_TOKEN gating changed from `beadName === "mr"` to `gitlabToken !== undefined` — caller decides whether to pass the token; code-agent-runner.ts behavior preserved (still only passes gitlabToken for mr bead)

### git-harness.ts changes

- `cloneRepo()`: Added optional third parameter `repoDir?: string`
- When provided: skips mkdtemp for repo dir, uses caller path directly; on failure only cleans handoffDir (caller owns repoDir)
- When omitted: unchanged behavior (mkdtemp, cleans both on failure)

### StandardBeadPlugin

Maps `AgentPipelineContext` to `runBead()`:
1. Reads prompt file from `ctx.agentDir + ctx.currentBead.prompt`
2. Renders template with `ctx.variables`
3. Parses timeout via `parseTimeout(ctx.currentBead.timeout)`
4. Extracts GITLAB_TOKEN from `ctx.currentBead.env` if present
5. Calls `runBead()` with mapped parameters
6. Throws on non-zero exit or timeout; returns `{ rawOutput: result.stdout }` on success

### GitCloneBeadPlugin

Maps `AgentPipelineContext` to `cloneRepo()`:
1. Validates `ctx.variables["repo_url"]` is a string
2. Extracts GITLAB_TOKEN from `ctx.currentBead.env` if present
3. Uses `ctx.workDir` as the pre-created repo directory
4. Returns `{ rawOutput: JSON.stringify({ repoDir, handoffDir }) }`

## Tests

20 new tests across 3 test files, all passing. No regressions in existing tests.

- `tests/unit/temp-dir-manager.test.ts` (6 tests): Real temp dirs, tests create/cleanup/cleanupOrphans
- `tests/unit/standard-bead-plugin.test.ts` (7 tests): Mocked runBead, tests success path, template rendering, error/timeout handling, GITLAB_TOKEN forwarding
- `tests/unit/git-clone-bead-plugin.test.ts` (7 tests): Mocked cloneRepo, tests success path, missing repo_url, GITLAB_TOKEN forwarding, workDir passthrough

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

All 7 created files found on disk. Both task commits (03c7ebb, c907aab) verified in git log.
