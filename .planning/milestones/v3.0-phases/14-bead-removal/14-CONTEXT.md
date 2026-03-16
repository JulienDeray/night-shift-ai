# Phase 14: Bead Removal - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Delete the bead abstraction layer (BeadPlugin, BeadRegistry, BeadRunner, GitCloneBeadPlugin, StandardBeadPlugin) and inline pipeline step execution directly into AgentEngine. Also remove the BeadsClient (external `bd` CLI integration) — file-queue becomes the only task persistence mechanism. Full bead→step rename across the codebase. No trace of "bead" in any source file after this phase.

</domain>

<decisions>
## Implementation Decisions

### Step execution model
- Inline standard step logic directly into AgentEngine — no plugin interface, no registry, no factory dispatch
- Drop git-clone as a platform concept entirely — agents handle repo cloning in their prompt steps via Bash
- TempDirManager creates a flat temp dir per run (no repo/ or handoff/ subdirectories)
- Keep retry logic (retryFrom/maxAttempts) in the engine, renamed to step terms
- Delete: bead-plugin.ts, bead-registry.ts, bead-runner.ts (runBead inlined), plugins/standard-bead-plugin.ts, plugins/git-clone-bead-plugin.ts, git-harness.ts

### Manifest schema migration
- Rename `beads` array to `steps` in manifest schema
- Drop the `type` field from step definitions entirely — every step is implicitly standard (prompt→Claude CLI)
- Same env mechanism for token forwarding — steps declare env vars, buildStepEnv forwards only declared vars
- Update the agent scaffold template (src/agent/scaffold.ts) for the new schema
- Code-agent template's first step prompt should include git clone instructions

### Full bead→step rename
- Rename everything: type names, function names, file names, error classes, log messages
- BeadOutcome → StepOutcome, BeadResult → StepResult, BeadErrorCategory → StepErrorCategory
- buildBeadEnv → buildStepEnv, buildBeadArgs → buildStepArgs, runBead → runStep
- BeadContractViolationError → StepContractViolationError, BeadOutputMissingError → StepOutputMissingError
- Remove RegistryError entirely (no registry)
- AgentPipelineContext moves to engine-types.ts (consolidated with StepOutcome, AgentRunResult, etc.)

### BeadsClient removal
- Delete entire src/beads/ directory (client.ts, types.ts, mapper.ts)
- File-queue (.nightshift/queue/*.json) becomes the only task persistence mechanism
- Drop all beads-related config from nightshift.yaml schema (beads.enabled, beads.labels)
- Remove beads conditional branches from orchestrator — file-queue is always used
- Remove `bd` CLI dependency

### Test migration
- Delete: standard-bead-plugin.test.ts, git-clone-bead-plugin.test.ts, bead-registry.test.ts, all beads client tests
- Consolidate coverage into engine.test.ts — mock at spawnWithTimeout level to verify full chain (prompt rendering → arg building → env building → spawn)
- Adapt the 4 GITLAB_TOKEN isolation tests for renamed buildStepEnv function
- Update manifest-schema.test.ts for steps schema
- Update agent-pool.test.ts — no more registry/plugin creation per dispatch

### Claude's Discretion
- Exact file organization for inlined step runner code (whether runStep stays in a separate file or merges into engine.ts)
- Order of operations within the refactor (what to delete first vs last)
- Whether git-harness.ts utility functions are worth keeping for any other purpose

</decisions>

<code_context>
## Existing Code Insights

### Files to Delete
- `src/agent/bead-plugin.ts` — BeadPlugin interface, AgentPipelineContext, BeadOutput types
- `src/agent/bead-registry.ts` — BeadRegistry class (factory map)
- `src/agent/plugins/standard-bead-plugin.ts` — StandardBeadPlugin (logic inlined into engine)
- `src/agent/plugins/git-clone-bead-plugin.ts` — GitCloneBeadPlugin (removed entirely)
- `src/agent/git-harness.ts` — cloneRepo function (agents handle cloning in prompts)
- `src/beads/client.ts` — BeadsClient (external bd CLI integration)
- `src/beads/types.ts` — Bead entry types
- `src/beads/mapper.ts` — Task↔bead mapping functions
- `tests/unit/standard-bead-plugin.test.ts`
- `tests/unit/git-clone-bead-plugin.test.ts`
- `tests/unit/bead-registry.test.ts`

### Files to Modify Heavily
- `src/agent/engine.ts` — Inline step execution (currently delegates to plugins via registry)
- `src/agent/engine-types.ts` — Consolidate context type, rename Bead→Step types
- `src/agent/manifest-schema.ts` — beads→steps, drop type field
- `src/agent/manifest-types.ts` — ResolvedBead→ResolvedStep, LoadedManifest.beads→steps
- `src/agent/manifest-loader.ts` — Update for steps schema
- `src/daemon/agent-pool.ts` — Remove registry/plugin creation, simplified engine instantiation
- `src/daemon/orchestrator.ts` — Remove beads branches, file-queue only
- `src/core/config.ts` — Remove beads config fields
- `src/core/errors.ts` — Rename bead errors to step errors, remove RegistryError
- `src/agent/scaffold.ts` — Update template for steps schema

### Established Patterns
- Engine uses while-loop with index for retry jump-backs — this stays
- buildBeadEnv allowlist pattern (safe env construction) — stays, renamed
- spawnWithTimeout for Claude CLI invocation — stays as-is
- Template rendering (renderAgentTemplate) — stays as-is

### Integration Points
- AgentPool creates engine — simplified (no registry)
- Orchestrator task lifecycle — beads branches removed, file-queue only
- CLI commands that reference beads (submit, status) — need beads references removed
- nightshift.yaml schema — beads config section removed

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Note: removing the BeadsClient is technically broader than the original phase description (which focused on BeadPlugin/Registry/Runner), but the user explicitly decided to remove it as part of the bead cleanup.

</deferred>

---

*Phase: 14-bead-removal*
*Context gathered: 2026-03-13*
