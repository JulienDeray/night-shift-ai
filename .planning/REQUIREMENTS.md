# Requirements: Night-Shift Code Improvement Agent

**Defined:** 2026-03-13
**Core Value:** Small, focused merge requests that appear in the morning — one coherent improvement per night, easy to review, never overwhelming.

## v3.0 Requirements

Requirements for v3.0 Consolidation milestone. Each maps to roadmap phases.

### Bead Removal

- [x] **BEAD-01**: BeadPlugin interface, BeadRegistry, and BeadRunner are deleted from codebase
- [x] **BEAD-02**: AgentEngine executes pipeline steps inline without bead abstraction
- [x] **BEAD-03**: Manifest schema simplified — steps defined directly, no bead ID references
- [x] **BEAD-04**: All bead-related tests updated or removed, no regressions in agent execution

### Notifications

- [x] **NTFY-01**: Task start notification shows task name and agent name in human-readable text
- [x] **NTFY-02**: Task success notification shows task name, agent name, and agent output result
- [x] **NTFY-03**: Task failure notification shows task name, agent name, error description, and which step failed
- [x] **NTFY-04**: Task skip notification shows task name, agent name, and skip reason

### Codebase Cleanup

- [x] **CLEAN-01**: Dead code identified and removed (unused exports, unreachable paths, orphaned types)
- [x] **CLEAN-02**: Over-abstracted patterns simplified (unnecessary indirection layers)
- [x] **CLEAN-03**: Legacy v1.0/v2.0 compatibility remnants removed
- [x] **CLEAN-04**: No regressions — all existing tests pass after cleanup

### Testing

- [x] **TEST-01**: E2E test harness that starts and stops a real daemon process
- [ ] **TEST-02**: Happy path test: daemon start -> agent submit -> execution -> output verification -> daemon stop
- [ ] **TEST-03**: CLI command tests: status, submit, cancel, schedule, inbox with expected output
- [ ] **TEST-04**: Error scenario tests: agent failures, timeouts, invalid manifests
- [x] **TEST-05**: External service mocking: Claude CLI, GitLab, ntfy — no real calls during tests

## Future Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Empirical Validation

- **EVAL-01**: Skip criteria thresholds in bead prompts tuned after real runs
- **EVAL-02**: GIT_CONFIG_NOSYSTEM=1 credential blocking validated on real machine config
- **EVAL-03**: Confluence macro-stripping workaround validated against real Confluence instance

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| New agent types | Consolidation milestone — no new capabilities |
| CLI UX redesign | CLI works, just needs test coverage |
| Multi-repo support | Out of scope per PROJECT.md |
| Agent memory/database | Out of scope per PROJECT.md |
| npm package publishing | Format needs to stabilize over 5+ real agents |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BEAD-01 | Phase 14 | Complete |
| BEAD-02 | Phase 14 | Complete |
| BEAD-03 | Phase 14 | Complete |
| BEAD-04 | Phase 14 | Complete |
| NTFY-01 | Phase 15 | In Progress (formatter done, wiring in 15-02) |
| NTFY-02 | Phase 15 | In Progress (formatter done, wiring in 15-02) |
| NTFY-03 | Phase 15 | In Progress (formatter done, wiring in 15-02) |
| NTFY-04 | Phase 15 | Complete |
| CLEAN-01 | Phase 16 | Complete |
| CLEAN-02 | Phase 16 | Complete |
| CLEAN-03 | Phase 16 | Complete |
| CLEAN-04 | Phase 16 | Complete |
| TEST-01 | Phase 17 | Complete |
| TEST-02 | Phase 17 | Pending |
| TEST-03 | Phase 17 | Pending |
| TEST-04 | Phase 17 | Pending |
| TEST-05 | Phase 17 | Complete |

**Coverage:**
- v3.0 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-03-13*
*Last updated: 2026-03-13 after roadmap creation (phases 14-17)*
