# Phase 16: Codebase Cleanup - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Audit and remove dead code, over-abstracted patterns, and legacy v1.0/v2.0 remnants from the codebase. Collapse thin wrappers, simplify the error hierarchy, merge tiny type files, and delete orphaned modules. All existing tests must pass after cleanup with no regressions. The codebase should reflect only what night-shift currently is.

</domain>

<decisions>
## Implementation Decisions

### Cleanup aggressiveness
- Aggressive cleanup: delete dead code AND simplify patterns, collapse thin wrappers, reduce class hierarchies
- Inline aggressively: if a wrapper just delegates to one call with no added logic, replace it with the direct call at all sites
- Clean test files too: delete tests for removed code, consolidate test files that became thin after prior phases
- Tests should mirror the simplified source structure

### Error hierarchy
- Collapse the entire NightShiftError class hierarchy into a single NightShiftError class with a `code` or `category` field
- Catch sites use error.code instead of instanceof checks
- Remove all subclasses: ConfigError, DaemonError, StepContractViolationError, StepOutputMissingError, etc.

### Over-abstraction handling
- Keep AgentPool as-is (concurrency management is a real concern, clean abstraction)
- Keep template engine (src/utils/template.ts) as-is (tested, used in multiple places)
- Keep manifest file separation (manifest-schema.ts, manifest-types.ts, manifest-loader.ts) as-is
- Leave notifications directory untouched (just created in Phase 15, already clean)

### File reorganization
- Merge only tiny files (under ~50 lines) that exist just to export a few types or a single function
- Check agent-types.ts and engine-types.ts for merge candidates
- Do NOT update codebase maps (.planning/codebase/*.md) — skip docs
- Audit and clean nightshift.yaml Zod schema for stale fields that survived prior phases

### Legacy remnant removal
- Delete src/agent/prompts/*.md (analyze.md, implement.md, verify.md, mr.md, log.md) — v1.0 prompt templates, no runtime references, dead code
- Full "bead" word sweep across all source and test files — zero remaining references (not even in comments)
- Audit AgentRunner (src/daemon/agent-runner.ts) — remove if no longer in the execution path, simplify if still used
- Audit run-logger.ts — remove if no agent or runtime code references it
- Do NOT audit CLI commands — CLI is fine as-is

### Claude's Discretion
- Exact order of cleanup operations (what to delete first vs last)
- Which specific exports/types are dead (requires static analysis during planning)
- How to restructure error.code values (string literals, enum, or union type)
- Whether any other modules are discovered to be dead during the audit

</decisions>

<code_context>
## Existing Code Insights

### Known Dead Code
- `src/agent/prompts/*.md` (5 files) — v1.0 prompt templates, no runtime imports
- Potential: `src/daemon/agent-runner.ts` — may be superseded by engine + step-runner
- Potential: `src/agent/run-logger.ts` — may be orphaned v1.0 feature

### Established Patterns
- Engine uses while-loop with index for retry jump-backs — stays
- buildStepEnv allowlist pattern (safe env construction) — stays
- spawnWithTimeout for Claude CLI invocation — stays
- Template rendering (renderAgentTemplate) — stays

### Integration Points
- `src/core/errors.ts` — error hierarchy collapse affects every catch site in the codebase
- `src/core/config.ts` — Zod schema audit may remove stale fields
- Test files throughout `tests/unit/` and `tests/integration/` — must be cleaned in parallel with source

### Current Scale
- 44 source files, 30 test files, ~15,960 LOC total
- Key directories: src/agent/ (10 files), src/cli/ (12 files), src/daemon/ (6 files), src/core/ (5 files)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 16-codebase-cleanup*
*Context gathered: 2026-03-13*
