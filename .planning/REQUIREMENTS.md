# Requirements: Night-Shift

**Defined:** 2026-02-25
**Core Value:** Small, focused merge requests that appear in the morning — one coherent improvement per night, easy to review, never overwhelming.

## v2.0 Requirements

Requirements for the Pluggable Agent Architecture milestone. Each maps to roadmap phases.

### Foundation

- [x] **FOUN-01**: `isCodeAgent` boolean flag is fully retired — replaced by `agentName?: string` on task types
- [x] **FOUN-02**: `AgentConfig` type system defines agent configuration, pipeline context, and run result interfaces
- [x] **FOUN-03**: Handoff files include task ID suffix to prevent collisions when `maxConcurrent > 1`

### Manifest

- [x] **MFST-01**: `manifest.yaml` schema declares the full bead pipeline (name, type, prompt file, model, allowedTools, env vars, timeout, output schema)
- [x] **MFST-02**: Agent template loader reads and Zod-validates manifest from an agent directory with `realpath()` path containment
- [x] **MFST-03**: Engine injects built-in variables and agent-specific variables into prompt templates, with built-ins taking precedence on collision

### Plugin

- [x] **PLUG-01**: `BeadPlugin<TInput, TOutput>` interface defines typed plugin contract with shared `PipelineContext`
- [x] **PLUG-02**: `BeadRegistry` maps bead type strings from manifests to plugin factory functions
- [x] **PLUG-03**: Engine validates bead output against manifest-declared schema before passing to next bead
- [x] **PLUG-04**: Per-bead model, allowedTools, env vars, and timeout are declared in manifest and enforced by engine

### Engine

- [ ] **ENGN-01**: `AgentEngine` loads any agent directory and drives its bead pipeline from the manifest with no agent-specific logic
- [ ] **ENGN-02**: `StandardBeadPlugin` wraps existing `runBead()` (claude -p subprocess) as a bead plugin
- [ ] **ENGN-03**: `GitCloneBeadPlugin` wraps existing `cloneRepo()` as a harness-side bead plugin

### Migration

- [ ] **MIGR-01**: Code-agent exists as `agents/code-agent/` directory with manifest.yaml and prompt files — no functionality lost from v1.0
- [x] **MIGR-02**: `nightshift.yaml` uses `agents:` array where each entry references an agent by name with schedule and variables

### Wiring

- [ ] **WIRE-01**: `AgentPool.dispatch()` routes tasks with `agentName` to `AgentEngine` instead of hardcoded `runCodeAgent`
- [ ] **WIRE-02**: Legacy `code-agent.ts` and `code-agent-runner.ts` are removed after migration is validated
- [ ] **WIRE-03**: Daemon validates all referenced agent manifests at startup and fails with actionable error if any are broken

### Developer Experience

- [ ] **DX-01**: `nightshift agent init <name>` scaffolds a starter agent directory with manifest and placeholder prompts
- [ ] **DX-02**: `nightshift agents list` shows configured agents with bead count, schedule, and last run outcome
- [ ] **DX-03**: `nightshift agent validate <path>` validates an agent directory without starting the daemon

## Future Requirements

Deferred to future releases. Tracked but not in current roadmap.

### Cross-Agent Composition

- **COMP-01**: Shared bead definitions can be referenced across multiple agent directories
- **COMP-02**: Agent registry enables community agent discovery and installation

### Advanced Pipeline

- **ADVP-01**: Bead output caching across runs to avoid re-analysis on implementation failure
- **ADVP-02**: Parallel bead execution for agents with independent pipeline stages

## Out of Scope

| Feature | Reason |
|---------|--------|
| npm-publish agent packages | Premature — format needs to stabilize over 5+ real agents before standardizing on a registry |
| Docker/VM agent isolation | Enormous operational complexity; `allowedTools` + env allowlist provides sufficient isolation for a local tool |
| GUI for building agent templates | User base is engineers comfortable with YAML; `agent init` scaffold is sufficient |
| Dynamic bead registration at runtime | Security surface — arbitrary code loaded at runtime has user's full credentials |
| Agent-to-agent communication mid-pipeline | Requires message-passing infrastructure beyond complexity budget; handoff files are sufficient |
| LLM-driven bead ordering | Non-deterministic ordering breaks manifest contract; YAML is better for sequencing |
| Backward compat for codeAgent: config | Personal tool — clean break to agents: list is preferred over maintaining shim |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUN-01 | Phase 5 | Complete |
| FOUN-02 | Phase 5 | Complete |
| FOUN-03 | Phase 5 | Complete |
| MFST-01 | Phase 6 | Complete |
| MFST-02 | Phase 6 | Complete |
| MFST-03 | Phase 6 | Complete |
| PLUG-01 | Phase 6 | Complete |
| PLUG-02 | Phase 6 | Complete |
| PLUG-03 | Phase 6 | Complete |
| PLUG-04 | Phase 6 | Complete |
| MIGR-02 | Phase 7 | Complete |
| WIRE-03 | Phase 7 | Pending |
| ENGN-01 | Phase 8 | Pending |
| ENGN-02 | Phase 8 | Pending |
| ENGN-03 | Phase 8 | Pending |
| MIGR-01 | Phase 9 | Pending |
| WIRE-01 | Phase 10 | Pending |
| WIRE-02 | Phase 10 | Pending |
| DX-01 | Phase 11 | Pending |
| DX-02 | Phase 11 | Pending |
| DX-03 | Phase 11 | Pending |

**Coverage:**
- v2.0 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-02-25*
*Last updated: 2026-02-25 after roadmap creation (phases 5-11)*
