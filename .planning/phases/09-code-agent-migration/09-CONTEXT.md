# Phase 9: Code-Agent Migration - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

The code-agent exists as a self-contained `agents/code-agent/` directory — runnable by `AgentEngine` with no functionality lost compared to v1.0. This phase packages the existing v1.0 pipeline (analyze → implement → verify → MR → log) into the manifest-driven architecture built in Phases 5-8.

</domain>

<decisions>
## Implementation Decisions

### Migration fidelity
- Adapt to new architecture — not a 1:1 v1.0 clone
- Outcome shape parity only: same final results (MR_CREATED, NO_IMPROVEMENT, etc.) and same MR quality; internal pipeline steps can differ in how they get there
- Behaviors that don't fit the manifest model cleanly should be redesigned to work declaratively within the manifest/engine model (manifest-native approach)
- All v1.0 behaviors migrate — nothing is dropped

### Agent directory layout
- Agents root path is configurable in nightshift.yaml (default to project-level `agents/`)
- Prompt files live in a `prompts/` subfolder: `agents/code-agent/prompts/analyze.md`, etc.
- Category guidance text lives as template variables in nightshift.yaml agent config — prompts use `{{category_guidance}}` resolved from config
- Agent directory is fully self-contained — everything the agent needs is in its directory; config overrides come from nightshift.yaml but the agent works standalone

### Retry & fallback policy
- Implement+verify retry expressed as bead-level retry config in manifest: `retry: {maxAttempts: 3, retryFrom: 'implement'}` (engine handles the loop declaratively)
- On retry, the implementation bead receives the verify error details via a template variable (same as v1.0's `verify_error` approach, just manifest-native)
- Category fallback logic lives in the daemon/orchestrator layer, NOT in AgentEngine — the engine runs one category; if it yields NO_IMPROVEMENT, the caller decides what to do
- Fallback category order is configurable per agent in nightshift.yaml (defaults to current fixed order: tests → refactoring → docs → security → performance)

### Log bead
- The Confluence log bead is a regular mandatory bead in the manifest pipeline — not best-effort
- If it fails to log to Confluence, the pipeline reports failure like any other bead
- Code-agent specific — other future agents may or may not have a log bead
- Allowed tools: Atlassian MCP tools + Read tool (so it can inspect local files to build Confluence entries)
- MCP config for Atlassian is provided via the manifest/config
- Receives previous bead outputs via standard template variables (`{{beads.analyze.output.*}}`, `{{beads.mr.output.*}}`, etc.)
- Same Confluence content format as v1.0: JSONL-style entry with date, category, MR URL, cost, duration

### Claude's Discretion
- Exact manifest YAML structure and field naming (within the decided patterns)
- Prompt content adaptation for the new template variable system
- Engine extensions needed for bead-level retry support
- How `agents_root` config field integrates with existing nightshift.yaml schema
- Integration test design for parity verification

</decisions>

<specifics>
## Specific Ideas

- Bead-level retry should feel declarative: `retry: {maxAttempts: 3, retryFrom: 'implement'}` on the verify bead
- Category fallback is a daemon concern — AgentEngine returns NO_IMPROVEMENT, the orchestrator tries the next category
- The log bead is a first-class citizen, not an afterthought — if Confluence logging is configured, it must succeed

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-code-agent-migration*
*Context gathered: 2026-02-27*
