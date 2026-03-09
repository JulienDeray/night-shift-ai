# Phase 11: Developer Experience - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

CLI commands for scaffolding, inspecting, and validating agents — plus comprehensive documentation (README rewrite and full agent system reference). An engineer (or AI agent) can create a new agent, configure it, validate it, inspect all configured agents, and understand the entire templating system without starting the daemon or reading source code.

</domain>

<decisions>
## Implementation Decisions

### Scaffold output (`agent init`)
- Two-bead template: `clone` (git-clone type) + `analyze` (standard type)
- Creates directory under `agents/<name>/` (always relative to project root)
- Auto-registers the new agent in `nightshift.yaml` with a placeholder cron schedule (e.g., `0 2 * * *`)
- Default model: `claude-sonnet-4-6`
- Includes `preamble.md` with a short placeholder
- Prompt files are functional stubs that produce valid JSON matching the outputSchema — agent actually runs even if output is trivial
- `analyze` bead has a simple outputSchema (e.g., `{result: string, summary: string}`)
- `clone` bead has no env vars by default — user adds their own (e.g., GITLAB_TOKEN) as needed
- Variables section includes `repo_url: ""` with empty default in manifest; nightshift.yaml entry uses placeholder URL (`https://gitlab.com/your-org/your-repo`)
- `--force` flag to overwrite existing agent directory (fails without it)
- Validates agent name with existing kebab-case regex from Phase 5 (`validateAgentName`)
- Prints actionable next steps after scaffolding: edit prompts, set variables, validate, test with `nightshift run`

### List output (`agent list`)
- Table format by default, `--json` flag for programmatic consumption
- 4 columns: Name, Beads (count), Schedule (cron expression), Last Run (outcome + timestamp)
- Reads last run outcome from JSONL run log (`run-log.jsonl`)
- Shows all agents: both configured (in nightshift.yaml) and unregistered (in agents/ directory but not scheduled), with unregistered agents flagged as "(not scheduled)"
- Helpful empty state: "No agents found. Run 'nightshift agent init <name>' to create one."

### Validate behavior (`agent validate`)
- Checks performed: manifest schema validation, prompt file existence, variable completeness (all `{{variables}}` in prompts declared in manifest), output schema compilation (`z.fromJSONSchema()`), env var availability
- Env var availability check is a **warning** (not an error) — agent may run in a different environment
- All other checks are errors (exit 1 on failure)
- Output on success: summary with checkmarks per check category (schema, prompts, variables, env, output schemas)
- Accepts agent name (resolves to `agents/<name>`) OR full directory path

### Show command (`agent show`)
- Displays: manifest summary (name, description, model, timeout, variables), bead pipeline (ordered list with type, model override, retry config), schedule info (cron + next run time if in nightshift.yaml), last 5 runs from JSONL log (timestamp, outcome, duration)
- Added as a 4th subcommand beyond the 3 required by DX-01/02/03

### CLI namespace
- All commands under `nightshift agent` subcommand group: `init`, `validate`, `list`, `show`
- `nightshift agent` without subcommand shows help (available subcommands)
- No conflict with existing `nightshift init` (project init) — different namespace
- Existing `nightshift init` remains unchanged

### Documentation
- Full README.md rewrite reflecting v2.0 pluggable agent architecture (project overview, quick-start, agent system intro, link to full docs)
- Comprehensive `docs/agents.md` covering:
  - Manifest reference: every field documented with type, default, examples
  - Template variable system: `{{variables}}`, built-in vs user-defined, bead output references (`{{beads.clone.repoDir}}`)
  - Bead types and contracts: standard vs git-clone, outputSchema format, retry config, env vars, mcpConfig
  - End-to-end walkthrough: create agent, write prompts, configure schedule, validate, test
- Code-agent used as the annotated reference example throughout the docs ("here's how code-agent does it")
- Documentation should be complete enough for an AI agent to autonomously create, configure, and validate agents

### Claude's Discretion
- Exact table formatting library or manual column alignment
- Placeholder prompt content (as long as it produces valid JSON output)
- Preamble.md placeholder text
- How `agent show` formats the bead pipeline display
- docs/agents.md internal structure and heading hierarchy
- README section ordering

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `loadManifest()` (src/agent/manifest-loader.ts): Full manifest loading + Zod validation + path containment — `agent validate` wraps this
- `ManifestSchema` (src/agent/manifest-schema.ts): Zod schema for manifest validation
- `validateAgentName` (from Phase 5): Kebab-case regex validation — reuse for `agent init` name validation
- `validateBeadOutput` / `extractLastJsonBlock` (src/agent/manifest-loader.ts): Bead output validation
- `validateTemplateVars` (template system): Variable completeness check — reuse for `agent validate`
- Commander typed commands (`@commander-js/extra-typings`): All CLI commands use this pattern
- `formatters.ts` (src/cli/formatters.ts): `success()`, `warn()`, `info()` formatting helpers
- `appendRunLog` / run-log.jsonl (src/agent/run-logger.ts): JSONL log reader for `agent list` and `agent show`
- `agents/code-agent/manifest.yaml`: Reference agent directory — the "known good" example

### Established Patterns
- CLI commands are individual files in `src/cli/commands/`, exported as Commander commands, registered in `src/cli/index.ts`
- Config loaded via `loadConfig()` with Zod validation — `agent list` reads schedule entries from here
- Agent directories live under `agents/` at project root with `manifest.yaml` + `prompts/` subdirectory

### Integration Points
- `src/cli/index.ts`: Register new `agent` subcommand group
- `nightshift.yaml`: `agent init` appends to `schedule:` array
- `agents/` directory: `agent init` creates new subdirectory, `agent list` scans for unregistered agents
- JSONL run log: `agent list` and `agent show` read last run outcomes

</code_context>

<specifics>
## Specific Ideas

- Documentation must be AI-agent-friendly: complete enough that an AI reading docs/agents.md can autonomously create a full agent from scratch, configure it in nightshift.yaml, validate it, and run it
- Code-agent is the annotated reference throughout — not just mentioned, but each docs section shows "here's how code-agent uses this"
- Functional stub prompts in scaffold: the scaffolded agent should actually work out of the box (even if trivially) so the developer can immediately `nightshift run --agent <name>` to see the pipeline in action

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-developer-experience*
*Context gathered: 2026-03-09*
