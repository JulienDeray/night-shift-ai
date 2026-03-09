# Phase 6: Plugin Interfaces and Manifest Schema - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Define the contract between agent directories and the engine: manifest.yaml Zod schema, BeadPlugin interface, BeadRegistry, template variable injection, and security boundaries (path containment, env isolation). This phase produces types, schemas, and validation — no engine execution logic (Phase 8).

</domain>

<decisions>
## Implementation Decisions

### Manifest DX
- Minimal defaults: only `name`, `description`, and `beads` array are required — model, timeout, env, allowedTools all have sensible defaults
- `description` is required on every manifest
- No `version` field for now — add when schema actually evolves
- Bead-level overrides (model, timeout, allowedTools, env) are inline on the bead entry, not in a separate section
- Agent-level defaults for `model`, `timeout`, `allowedTools`, and `env` — beads inherit unless they override
- Inheritance behavior: `model` and `timeout` use override (bead replaces agent-level); `env` uses merge (bead adds to agent-level, bead wins on collision); `allowedTools` uses override (bead replaces agent-level entirely, can expand beyond agent-level)
- All prompt file paths are relative to the agent directory — no absolute paths, no shared refs
- Manifest validation reports ALL errors at once, not fail-on-first
- Bead `name` must be unique within a manifest
- `outputSchema` uses inline JSON Schema in the manifest (no external file refs)
- `outputSchema` is required on ALL beads (including the last one)
- Bead types are registry-based: any string is valid as a type, BeadRegistry maps type strings to plugin factory functions
- Custom bead types are declared in nightshift.yaml under `bead_plugins:` with paths to implementations
- `env` supports both passthrough syntax (string = name from host) and explicit values (key-value pair)
- `variables` section at agent level only (not per-bead), injected into prompt templates
- nightshift.yaml can override manifest variables at schedule time — enables one agent template with multiple configurations
- No `maxTurns` — `timeout` is sufficient for cost/execution control
- Linear pipelines only — no conditional beads (`when`) for now
- Schedule lives in nightshift.yaml only — manifest defines WHAT, config defines WHEN

### Bead contract strictness
- Hard abort on schema violation: `BEAD_CONTRACT_VIOLATION` stops the pipeline immediately, no partial results
- Distinct error `BEAD_OUTPUT_MISSING` when a bead with outputSchema produces no JSON block (different root cause from violation)
- JSON block extraction: engine looks for JSON code blocks in bead output; uses the LAST block if multiple exist
- Both structured + raw output passed to next bead: `previousBead.output` (parsed JSON) and `previousBead.rawOutput` (full text)
- All previous beads' outputs are accessible via PipelineContext (not just the immediately preceding bead)
- Schema validation is manifest-driven only — plugins don't declare input/output types, engine handles validation
- No retries on contract violation — fail immediately, fix the prompt/schema
- Error output shows truncated preview (500 chars) of raw output, full output in log file
- BeadPlugin interface: single `execute(ctx: PipelineContext): Promise<BeadOutput>` method, no lifecycle hooks
- BeadOutput is raw string output only — metadata (duration, model, tokens) tracked separately by engine logging
- BeadRegistry is a DI instance passed to the engine, not a singleton

### Template variable system
- Handlebars `{{var}}` syntax for template variables in prompt files
- Pure substitution only — no conditionals, loops, or helpers
- Fail at load time if a prompt references an undefined variable (catch typos before agent runs)
- Core built-in variables (always available, no declaration needed): `{{task_id}}`, `{{run_date}}`, `{{agent_name}}`, `{{repo_path}}`
- Hard error when user-defined variable collides with a built-in name (not just a warning)
- Variable resolution precedence: built-ins (immutable) > nightshift.yaml overrides > manifest defaults
- Previous bead outputs accessible as template variables via dot notation: `{{beads.analyze.output.summary}}`
- Full deep access with array indexing: `{{beads.analyze.output.results.categories[0].name}}`
- Raw output also accessible: `{{beads.analyze.rawOutput}}`
- Arrays and objects are JSON-serialized when injected into prompts

### Security boundaries
- realpath() containment: resolve all paths with realpath(), verify resolved path is within the agents root directory
- Path containment checked at BOTH load time AND runtime (TOCTOU protection)
- Agents root directory is configurable via `agents_dir` in nightshift.yaml (default: `./agents`)
- Env isolation: bead subprocess gets ONLY declared env vars plus OS essentials (PATH, HOME, USER, SHELL, TMPDIR) — all other host env vars stripped
- Error at load time if a declared env var isn't set in the host environment
- Warn on secret-looking explicit values (var names containing token/key/secret/password with hardcoded values)
- Validate `allowedTools` against known Claude tool names at load time (reject unknown tools)
- Plugin paths in `bead_plugins` also undergo containment checks (must resolve within project root)
- Zod schema uses `.strict()` — unknown fields in manifest are validation errors
- All paths in nightshift.yaml validated at startup (agents_dir, bead_plugins, agent references)
- Security error messages include the full resolved path (local tool, developer needs debugging info)

### Claude's Discretion
- Exact Zod schema structure and field naming conventions
- Error message formatting and "did you mean?" suggestion implementation
- Internal PipelineContext type structure
- JSON block extraction regex/parsing approach
- How bead output variables are resolved at template substitution time
- Which specific OS-essential env vars to include beyond the decided set

</decisions>

<specifics>
## Specific Ideas

- "Users should be able to create and compose their own beads — it is a basis of nightshift" — bead types are registry-based, not a fixed set
- Manifest validation error format should show all errors at once with file path and field location (like the TypeScript compiler)
- Security errors should include full resolved paths since this is a local developer tool, not a web service
- The agent-level defaults pattern (model, timeout, env, allowedTools) should feel consistent — same inheritance logic across all fields, with env being the exception (merge vs override)

</specifics>

<deferred>
## Deferred Ideas

- Conditional beads (`when` clause) — future enhancement after linear pipelines prove out
- Convention-based plugin discovery (auto-scan plugins/ directory) — evaluate after explicit registration is used
- Shared prompt refs (`@shared/` prefix for cross-agent prompt reuse) — future phase
- `maxTurns` per bead for API usage control — reconsider if timeout proves insufficient
- Manifest `version` field for schema evolution — add when schema actually changes

</deferred>

---

*Phase: 06-plugin-interfaces-manifest-schema*
*Context gathered: 2026-02-26*
