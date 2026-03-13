# Roadmap: Night-Shift Code Improvement Agent

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-02-25)
- ✅ **v2.0 Pluggable Agent Architecture** — Phases 5-13 (shipped 2026-03-09)
- 🚧 **v3.0 Consolidation** — Phases 14-17 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED 2026-02-25</summary>

- [x] Phase 1: Notification Foundation (2/2 plans) — completed 2026-02-23
- [x] Phase 2: Orchestrator Hooks (2/2 plans) — completed 2026-02-24
- [x] Phase 3: Agent Prompt and Security (2/2 plans) — completed 2026-02-25
- [x] Phase 4: Git Harness and Logging (2/2 plans) — completed 2026-02-25

</details>

<details>
<summary>✅ v2.0 Pluggable Agent Architecture (Phases 5-13) — SHIPPED 2026-03-09</summary>

- [x] Phase 5: Dispatch Foundation (2/2 plans) — completed 2026-02-25
- [x] Phase 6: Plugin Interfaces and Manifest Schema (3/3 plans) — completed 2026-02-26
- [x] Phase 7: Config Schema Migration and Startup Validation (2/2 plans) — completed 2026-02-26
- [x] Phase 8: AgentEngine and Bead Plugin Implementations (2/2 plans) — completed 2026-02-27
- [x] Phase 9: Code-Agent Migration (2/2 plans) — completed 2026-02-27
- [x] Phase 10: Daemon Wiring and Legacy Cleanup (3/3 plans) — completed 2026-03-03
- [x] Phase 11: Developer Experience (3/3 plans) — completed 2026-03-09
- [x] Phase 12: Fix Scheduler Dispatch Wiring (1/1 plan) — completed 2026-03-09
- [x] Phase 13: Phase 11 Verification (1/1 plan) — completed 2026-03-09

</details>

### 🚧 v3.0 Consolidation (In Progress)

**Milestone Goal:** Eliminate the bead abstraction layer, improve notification quality, reduce codebase complexity, and establish a full E2E test harness — leaving the platform in its cleanest, most testable state.

- [ ] **Phase 14: Bead Removal** - Delete BeadPlugin/BeadRegistry/BeadRunner and inline pipeline execution into AgentEngine
- [ ] **Phase 15: Notifications** - Replace raw JSON ntfy payloads with human-readable, agent-agnostic messages
- [ ] **Phase 16: Codebase Cleanup** - Audit and remove dead code, over-abstracted patterns, and legacy remnants
- [ ] **Phase 17: E2E Testing Framework** - Build a full E2E harness covering the daemon lifecycle, CLI, errors, and mocked externals

## Phase Details

### Phase 14: Bead Removal
**Goal**: The bead abstraction (BeadPlugin, BeadRegistry, BeadRunner) is gone — AgentEngine executes pipeline steps directly with no intermediary layer
**Depends on**: Phase 13
**Requirements**: BEAD-01, BEAD-02, BEAD-03, BEAD-04
**Success Criteria** (what must be TRUE):
  1. BeadPlugin, BeadRegistry, and BeadRunner files no longer exist in the codebase
  2. AgentEngine runs pipeline steps inline — no plugin dispatch, no registry lookup
  3. Manifest schema uses direct step definitions — no bead ID references in any agent directory
  4. All agent execution tests pass with no bead-related test helpers or fixtures remaining
**Plans**: 3 plans
Plans:
- [ ] 14-01-PLAN.md — Rename types, schemas, and errors from bead to step terminology
- [ ] 14-02-PLAN.md — Inline step execution into AgentEngine, delete plugin system and BeadsClient
- [ ] 14-03-PLAN.md — Migrate tests, update scaffold, final bead-word sweep

### Phase 15: Notifications
**Goal**: Ntfy notifications are human-readable and agent-agnostic — showing task name, agent name, and structured output for every lifecycle event
**Depends on**: Phase 13
**Requirements**: NTFY-01, NTFY-02, NTFY-03, NTFY-04
**Success Criteria** (what must be TRUE):
  1. A task start notification shows the task name and agent name in plain human-readable text (no raw JSON)
  2. A task success notification shows the task name, agent name, and the agent's output result
  3. A task failure notification shows the task name, agent name, error description, and which step failed
  4. A task skip notification shows the task name, agent name, and the reason execution was skipped
**Plans**: TBD

### Phase 16: Codebase Cleanup
**Goal**: The codebase reflects only what night-shift currently is — no dead code, no over-abstracted patterns, no v1/v2 compatibility remnants
**Depends on**: Phase 14
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04
**Success Criteria** (what must be TRUE):
  1. Unused exports, unreachable code paths, and orphaned types are identified and removed
  2. Unnecessary indirection layers are collapsed — call sites reach their targets without superfluous wrappers
  3. No v1.0 or v2.0 compatibility shims, migration helpers, or deprecated code paths remain
  4. All existing tests pass after cleanup with no regressions
**Plans**: TBD

### Phase 17: E2E Testing Framework
**Goal**: A full E2E test harness covers the daemon lifecycle, agent execution, CLI commands, error scenarios, and external service boundaries — with no real network calls
**Depends on**: Phase 16
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05
**Success Criteria** (what must be TRUE):
  1. Tests can start and stop a real daemon process as part of a test suite run
  2. A happy-path test submits an agent, waits for execution, and verifies the output end-to-end
  3. CLI commands (status, submit, cancel, schedule, inbox) have tests that assert on expected output
  4. Error scenarios (agent failure, timeout, invalid manifest) each have a dedicated test that confirms correct behavior
  5. Claude CLI, GitLab, and ntfy are intercepted by mocks — no real external calls fire during the test run
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Notification Foundation | v1.0 | 2/2 | Complete | 2026-02-23 |
| 2. Orchestrator Hooks | v1.0 | 2/2 | Complete | 2026-02-24 |
| 3. Agent Prompt and Security | v1.0 | 2/2 | Complete | 2026-02-25 |
| 4. Git Harness and Logging | v1.0 | 2/2 | Complete | 2026-02-25 |
| 5. Dispatch Foundation | v2.0 | 2/2 | Complete | 2026-02-25 |
| 6. Plugin Interfaces and Manifest Schema | v2.0 | 3/3 | Complete | 2026-02-26 |
| 7. Config Schema Migration and Startup Validation | v2.0 | 2/2 | Complete | 2026-02-26 |
| 8. AgentEngine and Bead Plugin Implementations | v2.0 | 2/2 | Complete | 2026-02-27 |
| 9. Code-Agent Migration | v2.0 | 2/2 | Complete | 2026-02-27 |
| 10. Daemon Wiring and Legacy Cleanup | v2.0 | 3/3 | Complete | 2026-03-03 |
| 11. Developer Experience | v2.0 | 3/3 | Complete | 2026-03-09 |
| 12. Fix Scheduler Dispatch Wiring | v2.0 | 1/1 | Complete | 2026-03-09 |
| 13. Phase 11 Verification | v2.0 | 1/1 | Complete | 2026-03-09 |
| 14. Bead Removal | 2/3 | In Progress|  | - |
| 15. Notifications | v3.0 | 0/? | Not started | - |
| 16. Codebase Cleanup | v3.0 | 0/? | Not started | - |
| 17. E2E Testing Framework | v3.0 | 0/? | Not started | - |
