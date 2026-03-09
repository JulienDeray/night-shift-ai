# Roadmap: Night-Shift Code Improvement Agent

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-02-25)
- 🚧 **v2.0 Pluggable Agent Architecture** — Phases 5-11 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED 2026-02-25</summary>

- [x] Phase 1: Notification Foundation (2/2 plans) — completed 2026-02-23
- [x] Phase 2: Orchestrator Hooks (2/2 plans) — completed 2026-02-24
- [x] Phase 3: Agent Prompt and Security (2/2 plans) — completed 2026-02-25
- [x] Phase 4: Git Harness and Logging (2/2 plans) — completed 2026-02-25

</details>

### 🚧 v2.0 Pluggable Agent Architecture (In Progress)

**Milestone Goal:** Transform night-shift from a hardcoded code-improvement tool into a configurable agent platform where agents are directories, beads are composable plugins, and code-agent is one configured template among many.

#### Phase Checklist

- [x] **Phase 5: Dispatch Foundation** — Retire `isCodeAgent`, define `AgentConfig` types, fix concurrent handoff naming (completed 2026-02-25)
- [x] **Phase 6: Plugin Interfaces and Manifest Schema** — `BeadPlugin` interface, `BeadRegistry`, `AgentTemplateLoader`, full manifest Zod schema, security contracts (completed 2026-02-26)
- [x] **Phase 7: Config Schema Migration and Startup Validation** — `nightshift.yaml` accepts `agents:` array, deprecation shim for `code_agent:`, manifest validation at daemon start (completed 2026-02-26)
- [x] **Phase 8: AgentEngine and Bead Plugin Implementations** — Generic `AgentEngine`, `StandardBeadPlugin`, `GitCloneBeadPlugin` (completed 2026-02-27)
- [x] **Phase 9: Code-Agent Migration** — `agents/code-agent/` directory with manifest and prompt files, parity with v1.0 pipeline (completed 2026-02-27)
- [x] **Phase 10: Daemon Wiring and Legacy Cleanup** — Route `agentName` tasks to `AgentEngine`, remove `code-agent.ts` and `code-agent-runner.ts` (completed 2026-03-03)
- [x] **Phase 11: Developer Experience** — `agent init`, `agents list`, `agent validate` CLI commands (completed 2026-03-09)
- [x] **Phase 12: Fix Scheduler Dispatch Wiring** — Capture `evaluateSchedules()` return value and dispatch scheduled tasks to AgentPool (gap closure) (completed 2026-03-09)
- [ ] **Phase 13: Phase 11 Verification** — Produce missing 11-VERIFICATION.md for DX-01/02/03 (gap closure)

## Phase Details

### Phase 5: Dispatch Foundation
**Goal**: The dispatch layer uses `agentName` exclusively — `isCodeAgent` is gone and concurrent runs cannot produce colliding handoff files
**Depends on**: Phase 4 (v1.0 complete)
**Requirements**: FOUN-01, FOUN-02, FOUN-03
**Success Criteria** (what must be TRUE):
  1. `grep -r isCodeAgent src/` returns zero results
  2. `NightShiftTask` carries `agentName?: string` and the type system compiles with strict mode
  3. `AgentConfig`, `PipelineContext`, and `AgentRunResult` interfaces exist and are imported by the dispatch path
  4. Handoff filenames include the task ID suffix — two concurrent runs targeting the same agent do not overwrite each other's files
**Plans**: 2 plans
  - [ ] 05-01-PLAN.md — Retire isCodeAgent, define AgentConfig type system, wire agentName dispatch
  - [ ] 05-02-PLAN.md — Handoff file naming with taskId suffix and per-agent subdirectories

### Phase 6: Plugin Interfaces and Manifest Schema
**Goal**: The contract between agent directories and the engine is fully defined — manifest schema validated, plugin interface typed, bead registry wired, path traversal prevented, env vars and template variables safe
**Depends on**: Phase 5
**Requirements**: MFST-01, MFST-02, MFST-03, PLUG-01, PLUG-02, PLUG-03, PLUG-04
**Success Criteria** (what must be TRUE):
  1. A valid `manifest.yaml` passes Zod validation; a manifest with a missing required field produces a human-readable error identifying the field and file path
  2. An agent directory outside the config root (e.g., via symlink) is rejected with a path-containment error before any file is read
  3. Engine-injected built-in variables (`{{task_id}}`, `{{run_date}}`, etc.) take precedence over any user-defined variable with the same name
  4. A bead that returns output not matching its declared schema causes the engine to abort with `BEAD_CONTRACT_VIOLATION` rather than silently passing wrong data to the next bead
  5. Per-bead `model`, `allowedTools`, `env`, and `timeout` declared in the manifest are enforced — not the engine defaults
**Plans**: TBD

### Phase 7: Config Schema Migration and Startup Validation
**Goal**: `nightshift.yaml` accepts the new `agents:` array format and the daemon fails at startup — not at 2am — if any referenced agent manifest is broken
**Depends on**: Phase 6
**Requirements**: MIGR-02, WIRE-03
**Success Criteria** (what must be TRUE):
  1. A `nightshift.yaml` with only the old `code_agent:` block loads successfully and logs a deprecation warning — no error, no silent failure
  2. A `nightshift.yaml` with `agents:` array schedules agents correctly with their declared variables and schedules
  3. `nightshift daemon start` with a reference to a non-existent or invalid agent manifest exits with a non-zero code and an error message naming the broken manifest before the first poll tick runs
**Plans**: 2 plans
  - [ ] 07-01-PLAN.md — Config schema rewrite: agents: + schedule: Zod schema, type updates, daemon/CLI dead code removal
  - [ ] 07-02-PLAN.md — Startup validation gate: validateAgentsAtStartup wired into Orchestrator.start()

### Phase 8: AgentEngine and Bead Plugin Implementations
**Goal**: The `AgentEngine` drives any agent directory's bead pipeline from its manifest with no agent-specific logic — using thin plugin wrappers over the existing `runBead()` and `cloneRepo()` functions
**Depends on**: Phase 7
**Requirements**: ENGN-01, ENGN-02, ENGN-03
**Success Criteria** (what must be TRUE):
  1. `AgentEngine` unit tests pass with a mock agent directory — no real `claude -p` invocation required
  2. `StandardBeadPlugin` invokes the existing `runBead()` function unchanged — no new subprocess logic
  3. `GitCloneBeadPlugin` invokes the existing `cloneRepo()` function unchanged — no new git logic
  4. The engine contains zero references to `code-agent`, category rotation, or any agent-specific constant
**Plans**: 2 plans
Plans:
- [ ] 08-01-PLAN.md — Engine types, TempDirManager, widen runBead/cloneRepo APIs, StandardBeadPlugin, GitCloneBeadPlugin
- [ ] 08-02-PLAN.md — AgentEngine class with run(), dryRun(), error categorization, rollback, and comprehensive tests

### Phase 9: Code-Agent Migration
**Goal**: The code-agent exists as a self-contained `agents/code-agent/` directory — runnable by `AgentEngine` with no functionality lost compared to v1.0
**Depends on**: Phase 8
**Requirements**: MIGR-01
**Success Criteria** (what must be TRUE):
  1. `agents/code-agent/manifest.yaml` declares the full pipeline and all prompt files are present in the directory
  2. Running the code-agent through `AgentEngine` in an integration test produces a result with the same outcome shape (`MR_CREATED`, `NO_IMPROVEMENT`, etc.) as the v1.0 `runCodeAgentPipeline()`
  3. The code-agent directory can be copied to a new location and pointed to from `nightshift.yaml` without modifying any engine code
**Plans**: 2 plans
Plans:
- [x] 09-01-PLAN.md — Engine extensions: mcpConfig, retry, mcp__ tools, preamble, beadOutputs
- [x] 09-02-PLAN.md — Agent directory creation (manifest + prompts) and integration test

### Phase 10: Daemon Wiring and Legacy Cleanup
**Goal**: The daemon routes all `agentName` tasks through `AgentEngine` and the hardcoded `code-agent-runner.ts` is deleted — one dispatch path, no dead code
**Depends on**: Phase 9
**Requirements**: WIRE-01, WIRE-02
**Success Criteria** (what must be TRUE):
  1. `AgentPool.dispatch()` routes tasks with `agentName` to `AgentEngine` — the old `runCodeAgent` branch is gone
  2. `code-agent.ts` and `code-agent-runner.ts` no longer exist in `src/`
  3. All existing integration tests pass on the new dispatch path with the migrated code-agent directory
  4. `grep -r isCodeAgent src/` returns zero results (final verification)
**Plans**: 3 plans
Plans:
- [x] 10-01-PLAN.md — AgentPool dispatch wiring, type migration to AgentRunResult, orchestrator bridging with fallback dispatch and JSONL hook
- [x] 10-02-PLAN.md — Scheduler wiring, CLI rewrite, legacy file deletion, test cleanup
- [ ] 10-03-PLAN.md — Gap closure: update integration test config fixtures from legacy recurring: to agents:/schedule: schema

### Phase 11: Developer Experience
**Goal**: An engineer can scaffold a new agent, inspect all configured agents, and validate an agent directory without starting the daemon — all from the CLI
**Depends on**: Phase 10
**Requirements**: DX-01, DX-02, DX-03
**Success Criteria** (what must be TRUE):
  1. `nightshift agent init <name>` creates a directory with a valid `manifest.yaml` and placeholder prompt files that pass `agent validate`
  2. `nightshift agents list` prints each configured agent's name, bead count, schedule expression, and last run outcome
  3. `nightshift agent validate <path>` exits 0 for a valid agent directory and exits non-zero with a human-readable error for an invalid one — without starting the daemon
**Plans**: 3 plans
Plans:
- [x] 11-01-PLAN.md — Scaffold logic + agent CLI subcommand group (init, validate, list, show)
- [x] 11-02-PLAN.md — Unit and integration tests for scaffold and CLI commands
- [x] 11-03-PLAN.md — Documentation: README.md rewrite + docs/agents.md reference

### Phase 12: Fix Scheduler Dispatch Wiring
**Goal**: Scheduled agents actually execute — `evaluateSchedules()` return value is captured and dispatched to `AgentPool`
**Depends on**: Phase 10
**Requirements**: WIRE-01
**Gap Closure:** Closes integration bug + flow gap from v2.0 audit
**Success Criteria** (what must be TRUE):
  1. `orchestrator.ts` captures the `NightShiftTask[]` returned by `evaluateSchedules()` and dispatches each to `pool.dispatch()`
  2. A unit test verifies that scheduled tasks flow from `evaluateSchedules()` through to `pool.dispatch()`
  3. The E2E flow "config → schedule evaluation → agent dispatch" no longer breaks at schedule→dispatch
**Plans**: 1 plan
Plans:
- [ ] 12-01-PLAN.md — Wire evaluateSchedules() return value into pool.dispatch() with TDD test

### Phase 13: Phase 11 Verification
**Goal**: Phase 11 (Developer Experience) has formal verification confirming DX-01, DX-02, DX-03 are satisfied
**Depends on**: Phase 11
**Requirements**: DX-01, DX-02, DX-03
**Gap Closure:** Closes verification gap from v2.0 audit
**Success Criteria** (what must be TRUE):
  1. `11-VERIFICATION.md` exists with structured results for all 3 DX requirements
  2. Each DX requirement is verified against Phase 11 success criteria with evidence from the 21 passing tests
**Plans**: 1 plan
Plans:
- [ ] 13-01-PLAN.md — Gather verification evidence and produce 11-VERIFICATION.md

## Progress

**Execution Order:** 5 → 6 → 7 → 8 → 9 → 10 → 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Notification Foundation | v1.0 | 2/2 | Complete | 2026-02-23 |
| 2. Orchestrator Hooks | v1.0 | 2/2 | Complete | 2026-02-24 |
| 3. Agent Prompt and Security | v1.0 | 2/2 | Complete | 2026-02-25 |
| 4. Git Harness and Logging | v1.0 | 2/2 | Complete | 2026-02-25 |
| 5. Dispatch Foundation | 2/2 | Complete   | 2026-02-25 | - |
| 6. Plugin Interfaces and Manifest Schema | 3/3 | Complete   | 2026-02-26 | - |
| 7. Config Schema Migration and Startup Validation | 2/2 | Complete   | 2026-02-26 | - |
| 8. AgentEngine and Bead Plugin Implementations | 2/2 | Complete   | 2026-02-27 | - |
| 9. Code-Agent Migration | 2/2 | Complete   | 2026-02-27 | - |
| 10. Daemon Wiring and Legacy Cleanup | 3/3 | Complete    | 2026-03-04 | - |
| 11. Developer Experience | v2.0 | 3/3 | Complete | 2026-03-09 |
| 12. Fix Scheduler Dispatch Wiring | 1/1 | Complete    | 2026-03-09 | — |
| 13. Phase 11 Verification | v2.0 | 0/1 | Pending | — |
