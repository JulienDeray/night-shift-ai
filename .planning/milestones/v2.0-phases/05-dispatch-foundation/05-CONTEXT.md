# Phase 5: Dispatch Foundation - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Retire `isCodeAgent` boolean, replace with string-based `agentName` dispatch, define foundational type interfaces (`AgentConfig`, `PipelineContext`, `AgentRunResult`), and fix concurrent handoff file naming. This is internal plumbing — no new user-facing capabilities.

</domain>

<decisions>
## Implementation Decisions

### Agent naming convention
- kebab-case only, enforced by validation
- Max 64 characters, reserved name list (e.g. `default`, `all`, `none`)
- Agent name must match its directory name 1:1 — no manifest override
- Agent directories live in `agents/` next to `nightshift.yaml` in the user's project root (not inside the night-shift source tree)

### AgentConfig shape
- Minimal stub in Phase 5: just name + path. Later phases expand as fields are needed
- `PipelineContext` carries task identity + paths only: `taskId`, `agentName`, `workDir`, `handoffDir`
- `AgentRunResult` uses generic outcomes: `SUCCESS`, `FAILURE`, `SKIPPED` (not agent-specific like `MR_CREATED`)
- `AgentRunResult` includes `details: Record<string, unknown>` for agent-specific data (MR URL, summary, etc.)

### Default agent behavior
- `agentName` is **required at runtime** on `NightShiftTask` — no implicit default, every task must declare its agent. In the TypeScript type, `agentName` is optional (`agentName?: string`) during Phases 5-9 migration to avoid breaking non-code-agent task paths; it becomes a required field (`agentName: string`) in Phase 10 when AgentEngine is the sole dispatch path
- During migration (Phases 5-9): hardcode `agentName='code-agent'` routing to the old pipeline. Phase 10 switches to AgentEngine
- No directory validation in Phase 5 — agentName is carried as a string. Validation against `agents/` comes in Phase 7

### Handoff file convention
- Format: JSON content with `.json` extension (not markdown)
- Filename pattern: `handoff-{agentName}-{taskId}.json` where taskId is a 6-char random hex
- Location: per-agent subdirectory — `handoffs/{agentName}/handoff-{agentName}-{taskId}.json`
- Typed `HandoffPayload` interface defined in Phase 5 for type-safe bead-to-bead data passing
- Cleanup is configurable in `nightshift.yaml`: on = auto-delete after run completes, off = never auto-delete

### Claude's Discretion
- Exact fields on the minimal AgentConfig stub beyond name + path
- HandoffPayload interface shape based on current producer/consumer needs
- Reserved name list contents
- How to generate the 6-char hex task ID (crypto.randomBytes or similar)

</decisions>

<specifics>
## Specific Ideas

- Agent directories model: `agents/` is always a sibling of `nightshift.yaml` in the user's project — this is the user's workspace, not the night-shift source tree
- Handoff files should be machine-parseable (JSON) for downstream bead consumption, not human-first markdown

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-dispatch-foundation*
*Context gathered: 2026-02-25*
