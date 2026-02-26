# Phase 7: Config Schema Migration and Startup Validation - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

`nightshift.yaml` evolves from the hardcoded `code_agent:` and `recurring:` blocks to a clean `agents:` + `schedule:` model. Agents are declared once, then triggered via schedule (cron) or one-off (`nightshift run`) with config overrides. The daemon validates everything at startup — manifests, prompt files, template variables, env vars — and fails with actionable errors before the first poll tick.

</domain>

<decisions>
## Implementation Decisions

### Config structure: agents: + schedule: separation
- Two new top-level sections: `agents:` (declaration) and `schedule:` (cron triggers)
- `agents:` declares WHAT exists — each entry has `name` (matches directory under `agents_dir`) plus optional defaults: `notify`, `variables`
- `schedule:` declares WHEN agents run — each entry has `agent:` (must reference a declared agent), `cron:`, and optional overrides: `variables`, `enabled`, `notify`
- Every schedule entry MUST reference an agent declared in `agents:` — error if not: "Schedule references unknown agent 'foo'"
- Same agent can appear in multiple schedule entries with different cron/variables (e.g., one per weekday with different categories)
- Agent manifest resolved by convention: `agents_dir/<name>/manifest.yaml`
- `agents_dir` defaults to `./agents` relative to nightshift.yaml — configurable

### Clean break: code_agent: and recurring: removed
- Both `code_agent:` and `recurring:` top-level keys are removed from the schema
- `.strict()` on the Zod schema rejects them as unknown fields — standard Zod error, no special migration message
- No deprecation period — pre-1.0 software, breaking changes expected
- No migration CLI command — migration guide in documentation only
- `nightshift init` template updated to show new `agents:` + `schedule:` format with commented examples

### Schedule entries: no inline prompts
- Every schedule entry references a declared agent — no inline `prompt:` field on schedule entries
- If a user wants a simple cron task (what `recurring:` used to do), they create a simple single-bead agent manifest and schedule it
- One scheduling mechanism for everything: manifest-based agents only

### one_off_defaults: kept
- `one_off_defaults:` stays for global defaults on ad-hoc `nightshift run` invocations (timeout, max_budget_usd)
- Resolution order: `one_off_defaults` < agent-level defaults < CLI flags
- One-off runs also reference declared agents with optional variable overrides

### Startup validation depth
- Full schema validation of every referenced manifest.yaml (Zod parse)
- Prompt file existence check — verify all referenced prompt files exist and are readable
- Template variable validation — parse prompt files, extract `{{var}}` references, verify each is defined in the variable resolution chain (built-ins, manifest defaults, nightshift.yaml overrides)
- Env var presence check — if a manifest declares env vars, verify they're set in the host environment
- All errors across ALL agents reported at once (not fail-on-first-agent) — consistent with Phase 6's "report ALL errors" decision
- Non-zero exit code and actionable error messages before the first poll tick runs

### Claude's Discretion
- Exact Zod schema field naming for the new `agents:` and `schedule:` sections
- How `agents_dir` default resolution works internally
- Error message formatting and grouping (per-agent sections, error counts)
- How the migration from `CategoryScheduleSchema` to cron is documented
- Exit code conventions (which non-zero code for config vs manifest errors)
- Internal structure for merging agent defaults with schedule overrides

</decisions>

<specifics>
## Specific Ideas

- "Agents are declared, and then the schedule and one-off are ways to run those agents with specific configuration" — the core mental model
- Multiple schedule entries for the same agent with different variables is the pattern for day-of-week behavior (replaces `category_schedule`)
- The existing `workbench/nightshift.yaml` with its `code_agent:` block is the canonical migration example

</specifics>

<deferred>
## Deferred Ideas

- `nightshift migrate` CLI command — may add if manual migration proves too painful
- Special "did you mean agents:?" error when detecting `code_agent:` key — revisit if users struggle with the migration
- Convention-based plugin discovery for `bead_plugins:` — evaluate after explicit registration is used (carried from Phase 6)

</deferred>

---

*Phase: 07-config-schema-migration-and-startup-validation*
*Context gathered: 2026-02-26*
