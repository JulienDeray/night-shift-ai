# Phase 11: Developer Experience - Research

**Researched:** 2026-03-09
**Domain:** CLI scaffolding, validation, listing commands + documentation
**Confidence:** HIGH

## Summary

Phase 11 adds four CLI subcommands (`agent init`, `agent list`, `agent validate`, `agent show`) plus comprehensive documentation (README rewrite and `docs/agents.md`). The codebase already has all the foundational building blocks: manifest loading/validation, template variable validation, run logging, CLI formatters (including a `table()` helper), and the `config` subcommand pattern to model the `agent` subcommand group after.

The primary risk is low -- this phase is a composition phase that wires existing utilities into new CLI commands. No new libraries are needed. Commander subcommand groups are already proven in `config.ts`. The `formatters.ts` module already has `table()`, `success()`, `error()`, `warn()`, `info()`, and `dim()` helpers. All validation logic (`loadManifest`, `validateTemplateVars`, `ManifestSchema`, `validateAgentName`, `z.fromJSONSchema()`) is already implemented and tested.

**Primary recommendation:** Structure as 3 plans: (1) CLI commands (init + validate + list + show), (2) integration tests for all commands, (3) documentation (README rewrite + docs/agents.md).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Scaffold output (`agent init`):** Two-bead template (clone + analyze), creates under `agents/<name>/`, auto-registers in nightshift.yaml with `0 2 * * *` cron, default model `claude-sonnet-4-6`, includes `preamble.md`, functional stubs that produce valid JSON, `--force` flag, uses existing `validateAgentName`, prints next steps
- **List output (`agent list`):** Table format + `--json` flag, 4 columns (Name, Beads, Schedule, Last Run), reads from JSONL run log (`agent-runs.jsonl`), shows both configured and unregistered agents, helpful empty state message
- **Validate behavior (`agent validate`):** Checks manifest schema, prompt files, variable completeness, output schema compilation, env var availability (warning only), exits 0/1, accepts agent name or path
- **Show command (`agent show`):** Manifest summary, bead pipeline, schedule info with next run time, last 5 runs from JSONL log
- **CLI namespace:** All under `nightshift agent` subcommand group (init, validate, list, show), `nightshift agent` without subcommand shows help
- **Documentation:** Full README.md rewrite for v2.0, comprehensive `docs/agents.md`, code-agent as annotated reference example throughout, AI-agent-friendly completeness

### Claude's Discretion
- Exact table formatting library or manual column alignment
- Placeholder prompt content (as long as it produces valid JSON output)
- Preamble.md placeholder text
- How `agent show` formats the bead pipeline display
- docs/agents.md internal structure and heading hierarchy
- README section ordering

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DX-01 | `nightshift agent init <name>` scaffolds a starter agent directory with manifest and placeholder prompts | Scaffold uses existing `validateAgentName`, creates manifest.yaml matching `ManifestSchema`, writes prompt files, appends to nightshift.yaml using `yaml` library (already a dependency) |
| DX-02 | `nightshift agents list` shows configured agents with bead count, schedule, and last run outcome | Reads config via `loadConfig()`, scans `agents/` directory, reads manifest via `loadManifest()` or YAML parse, reads JSONL run log, uses existing `table()` formatter |
| DX-03 | `nightshift agent validate <path>` validates an agent directory without starting the daemon | Wraps existing `loadManifest()` + `validateTemplateVars()` + `z.fromJSONSchema()`, adds env var availability check as warning |
</phase_requirements>

## Standard Stack

### Core (already in project -- no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@commander-js/extra-typings` | ^14.0.0 | CLI framework with typed subcommands | Already used for all CLI commands |
| `yaml` | ^2.8.0 | YAML parse and stringify | Already used for config and manifest loading |
| `zod` | ^4.3.0 | Schema validation | Already used for manifest and config validation |
| `chalk` | ^5.4.0 | Terminal colors | Already used in formatters.ts |
| `croner` | ^10.0.0 | Cron parsing (for next-run-time in `agent show`) | Already used in config validation and scheduler |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `date-fns` | ^4.1.0 | Date formatting | Already used -- for relative time display in `agent show` |

### No New Dependencies Needed
The existing dependency set covers all Phase 11 needs. The `table()` function in `formatters.ts` handles table rendering. No need for cli-table3 or similar.

## Architecture Patterns

### Recommended Project Structure
```
src/cli/commands/
  agent.ts                    # Commander subcommand group (like config.ts)
                              # Contains: init, validate, list, show subcommands

src/agent/
  scaffold.ts                 # Scaffold logic: create directory, write manifest, write prompts
                              # Separated from CLI command for testability

agents/<name>/                # Generated scaffold output
  manifest.yaml
  prompts/
    preamble.md
    clone-stub.md
    analyze.md

docs/
  agents.md                   # Comprehensive agent system reference
```

### Pattern 1: Commander Subcommand Group
**What:** Use Commander's `.command()` chaining to create a subcommand group, exactly like `config.ts`.
**When to use:** The `agent` command with `init`, `validate`, `list`, `show` subcommands.
**Example:**
```typescript
// Source: existing src/cli/commands/config.ts pattern
import { Command } from "@commander-js/extra-typings";

export const agentCommand = new Command("agent")
  .description("Manage agents");

agentCommand
  .command("init")
  .argument("<name>", "Agent name (kebab-case)")
  .option("--force", "Overwrite existing agent directory")
  .action(async (name, options) => { /* ... */ });

agentCommand
  .command("validate")
  .argument("<path>", "Agent name or directory path")
  .action(async (agentPath) => { /* ... */ });

agentCommand
  .command("list")
  .option("--json", "Output as JSON")
  .action(async (options) => { /* ... */ });

agentCommand
  .command("show")
  .argument("<name>", "Agent name")
  .action(async (name) => { /* ... */ });
```

### Pattern 2: Scaffold Separation
**What:** Keep scaffold file generation logic in `src/agent/scaffold.ts`, separate from CLI command handler.
**When to use:** For `agent init` -- the CLI command handles user interaction (args, output, error display), while `scaffold.ts` handles file creation.
**Why:** Makes scaffold logic unit-testable without CLI subprocess invocation. Same pattern as `loadManifest` being separate from the CLI that calls it.

### Pattern 3: nightshift.yaml Modification
**What:** Read existing YAML, parse, modify the JS object, then stringify back.
**When to use:** `agent init` auto-registering the new agent in nightshift.yaml.
**Example:**
```typescript
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// Read existing config
const content = await fs.readFile(configPath, "utf-8");
const config = parseYaml(content) as Record<string, unknown>;

// Append to agents array
const agents = (config.agents as Array<Record<string, unknown>>) ?? [];
agents.push({ name: agentName });
config.agents = agents;

// Append to schedule array
const schedule = (config.schedule as Array<Record<string, unknown>>) ?? [];
schedule.push({
  agent: agentName,
  cron: "0 2 * * *",
  variables: { repo_url: "https://gitlab.com/your-org/your-repo" },
});
config.schedule = schedule;

// Write back
await fs.writeFile(configPath, stringifyYaml(config), "utf-8");
```

**Important caveat:** `yaml` library's `stringify` will lose comments from the original file. This is acceptable since nightshift.yaml is a managed config file and comments in the default template are just guidance.

### Pattern 4: JSONL Run Log Reading
**What:** Read `agent-runs.jsonl` line-by-line, parse JSON, filter by agent name.
**When to use:** `agent list` (last run per agent) and `agent show` (last 5 runs).
**Example:**
```typescript
// The run log lives at .nightshift/logs/agent-runs.jsonl
// Each line is a RunLogEntry: { date, agent_name, final_output, duration_seconds, summary }
const logPath = path.join(getLogsDir(base), "agent-runs.jsonl");
const content = await fs.readFile(logPath, "utf-8").catch(() => "");
const entries = content
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as RunLogEntry);
```

### Pattern 5: Unregistered Agent Discovery
**What:** Scan `agents/` directory for subdirectories containing `manifest.yaml` that are not declared in nightshift.yaml `agents:` array.
**When to use:** `agent list` showing "(not scheduled)" for unregistered agents.
**Example:**
```typescript
const agentsDir = path.resolve(base, config.agentsDir);
const entries = await fs.readdir(agentsDir, { withFileTypes: true });
const agentDirs = entries.filter((e) => e.isDirectory());
for (const dir of agentDirs) {
  const hasManifest = await fs.access(path.join(agentsDir, dir.name, "manifest.yaml"))
    .then(() => true).catch(() => false);
  if (hasManifest && !configuredNames.has(dir.name)) {
    // This is an unregistered agent
  }
}
```

### Anti-Patterns to Avoid
- **Don't re-implement manifest validation in `agent validate`**: Use `loadManifest()` directly. It already does YAML parse, Zod schema validation, path containment, env var resolution. The `validate` command just needs to wrap it and add the env-var-as-warning behavior.
- **Don't use `loadManifest()` for `agent list`**: `loadManifest()` resolves env vars and throws if they're missing. For listing, you only need the manifest name and bead count -- parse YAML and validate schema without resolving env vars.
- **Don't read the entire run log into memory for large logs**: For `agent list`, read and filter. For `agent show`, read last N lines. In practice, JSONL files for a local tool won't be massive, but be aware of the pattern.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Table formatting | Custom column alignment | Existing `table()` in `formatters.ts` | Already handles column width calculation, Unicode box-drawing chars |
| Manifest validation | Custom YAML/schema checks | `loadManifest()` from `manifest-loader.ts` | Handles Zod validation, path containment, outputSchema compilation |
| Template variable validation | Custom regex placeholder scan | `validateTemplateVars()` from `template.ts` | Already handles beads.* skip, nested resolution |
| Agent name validation | Custom regex | `validateAgentName()` from `agent-types.ts` | Handles kebab-case, reserved names, length limits |
| Cron parsing/next-run | Custom cron calculator | `Cron` from `croner` | Already a dependency, `.nextRun()` method gives next execution time |

## Common Pitfalls

### Pitfall 1: loadManifest Throws on Missing Env Vars
**What goes wrong:** `agent validate` uses `loadManifest()` which calls `resolveEnvVars()`, which throws `ManifestError` if a passthrough env var is missing from the host environment.
**Why it happens:** `loadManifest()` was designed for runtime use where env vars must exist.
**How to avoid:** For `agent validate`, catch `ManifestError` from env var resolution separately. Either (a) use a modified validation path that skips env var resolution, or (b) catch the specific error and downgrade it to a warning. Option (b) aligns with CONTEXT.md decision: "Env var availability check is a warning (not an error)."
**Warning signs:** `agent validate` exits 1 when GITLAB_TOKEN is not set, even though the agent is structurally valid.

### Pitfall 2: nightshift.yaml May Not Exist During `agent init`
**What goes wrong:** `agent init` tries to append to nightshift.yaml but the file doesn't exist if the user hasn't run `nightshift init` yet.
**How to avoid:** Check if nightshift.yaml exists. If not, either (a) create it with defaults + the new agent, or (b) print a warning saying "Run 'nightshift init' first, then add this agent to nightshift.yaml." Option (a) is better UX -- or simply run `nightshift init` implicitly.

### Pitfall 3: YAML Stringify Loses Comments
**What goes wrong:** Reading and re-writing nightshift.yaml with the `yaml` library strips all comments from the original file.
**Why it happens:** YAML parse discards comments by default.
**How to avoid:** Accept this limitation. Alternatively, use simple string append to add YAML blocks at the end of the file instead of parse-modify-stringify.

### Pitfall 4: `agent list` Without Config
**What goes wrong:** `agent list` calls `loadConfig()` which throws `ConfigError` if nightshift.yaml doesn't exist.
**How to avoid:** Catch ConfigError and fall back to scanning agents/ directory only (no schedule info available).

### Pitfall 5: Scaffold Prompt Must Actually Work
**What goes wrong:** Placeholder prompts that don't produce valid JSON matching the outputSchema will fail when the user tries `nightshift run --agent <name>`.
**Why it happens:** CONTEXT.md explicitly requires "functional stubs that produce valid JSON matching the outputSchema."
**How to avoid:** Scaffold prompt must include explicit instructions to output JSON in a code block matching the exact schema. Test that the scaffolded agent can pass `agent validate`.

### Pitfall 6: Path Resolution for `agent validate`
**What goes wrong:** `agent validate my-agent` vs `agent validate ./agents/my-agent` need different resolution logic.
**How to avoid:** If the argument doesn't contain path separators, resolve as `path.join(agentsRoot, name)`. If it does, use it as-is (resolve relative to cwd). CONTEXT.md: "Accepts agent name (resolves to `agents/<name>`) OR full directory path."

## Code Examples

### Scaffold Manifest Template
```yaml
# Source: derived from agents/code-agent/manifest.yaml + CONTEXT.md decisions
name: {{name}}
description: A scaffolded night-shift agent

model: claude-sonnet-4-6
timeout: 15m
allowedTools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep

variables:
  repo_url: ""

beads:
  - name: clone
    type: git-clone
    prompt: prompts/clone-stub.md
    outputSchema:
      type: object
      properties:
        repoDir:
          type: string
        handoffDir:
          type: string
      required:
        - repoDir
        - handoffDir

  - name: analyze
    type: standard
    prompt: prompts/analyze.md
    outputSchema:
      type: object
      properties:
        result:
          type: string
        summary:
          type: string
      required:
        - result
        - summary
```

### Scaffold nightshift.yaml Entry
```yaml
# Added to agents: array
- name: my-new-agent

# Added to schedule: array
- agent: my-new-agent
  cron: "0 2 * * *"
  variables:
    repo_url: "https://gitlab.com/your-org/your-repo"
```

### Validate Command Flow
```typescript
// Source: composition of existing loadManifest + validateTemplateVars
async function validateAgent(agentPath: string): Promise<ValidationResult> {
  const checks: CheckResult[] = [];

  // 1. Manifest schema validation (via loadManifest, but catch env errors)
  // 2. Prompt file existence (already in engine.dryRun logic)
  // 3. Variable completeness (validateTemplateVars)
  // 4. Output schema compilation (z.fromJSONSchema -- done inside loadManifest)
  // 5. Env var availability (warning only)

  return { checks, hasErrors: checks.some(c => c.level === 'error') };
}
```

### Reading Next Cron Run Time
```typescript
// Source: croner library (already a dependency)
import { Cron } from "croner";

const job = new Cron("0 2 * * *");
const nextRun = job.nextRun(); // Returns Date or null
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded code-agent | Pluggable agent architecture | v2.0 (Phases 5-10) | `agent init` scaffolds any agent, not just code-agent |
| `nightshift init` only | `nightshift init` + `nightshift agent init` | Phase 11 | Two-level init: project-level and agent-level |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/unit/` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DX-01 | `agent init` creates valid scaffold | integration | `npx vitest run tests/integration/agent-commands.test.ts` | No -- Wave 0 |
| DX-01 | scaffold.ts creates correct files | unit | `npx vitest run tests/unit/scaffold.test.ts` | No -- Wave 0 |
| DX-02 | `agent list` shows agents with metadata | integration | `npx vitest run tests/integration/agent-commands.test.ts` | No -- Wave 0 |
| DX-03 | `agent validate` exits 0 for valid, 1 for invalid | integration | `npx vitest run tests/integration/agent-commands.test.ts` | No -- Wave 0 |
| DX-03 | validate warns on missing env vars (not error) | unit | `npx vitest run tests/unit/scaffold.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/unit/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/integration/agent-commands.test.ts` -- covers DX-01, DX-02, DX-03 integration tests
- [ ] `tests/unit/scaffold.test.ts` -- covers scaffold logic unit tests

## Sources

### Primary (HIGH confidence)
- Project source code: `src/cli/commands/config.ts` -- subcommand group pattern
- Project source code: `src/cli/formatters.ts` -- table() and formatting helpers
- Project source code: `src/agent/manifest-loader.ts` -- loadManifest(), validateBeadOutput()
- Project source code: `src/agent/manifest-schema.ts` -- ManifestSchema, BeadSchema
- Project source code: `src/agent/template.ts` -- validateTemplateVars(), buildTemplateVars()
- Project source code: `src/agent/agent-types.ts` -- validateAgentName()
- Project source code: `src/agent/run-logger.ts` -- RunLogEntry, appendRunLog()
- Project source code: `src/core/config.ts` -- loadConfig(), ConfigSchema, getDefaultConfigYaml()
- Project source code: `agents/code-agent/manifest.yaml` -- reference agent structure

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions (locked by user discussion)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all existing
- Architecture: HIGH - follows established project patterns (config.ts subcommand group)
- Pitfalls: HIGH - derived from direct code reading of loadManifest() behavior

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- internal project patterns)
