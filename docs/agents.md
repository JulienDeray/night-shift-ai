# Agent System Reference

This document is the complete reference for creating, configuring, and running agents in Night-Shift. It is written to be self-contained: an AI agent or engineer reading this document should be able to create a fully functional agent from scratch without reading source code.

## Overview

An **agent** is a directory containing a `manifest.yaml` file and a `prompts/` directory with markdown prompt files. The manifest declares the agent's pipeline: an ordered list of **beads** (stages), each of which invokes `claude -p` with specific instructions, tools, model, timeout, and an output schema.

When an agent runs, the **AgentEngine** loads its manifest, resolves template variables, and executes beads sequentially. Each bead receives a rendered prompt, produces JSON output validated against a declared schema, and passes its output to subsequent beads via template variable references.

### Directory Structure

```
agents/<name>/
  manifest.yaml              # Pipeline definition (required)
  prompts/                   # Prompt files referenced by beads (required)
    preamble.md              # Optional: prepended to all bead prompts
    analyze.md               # One .md file per bead
    implement.md
    ...
```

The `agents/` directory location is configurable via `agents_dir` in `nightshift.yaml` (default: `./agents`).

### How Agents Execute

1. The engine loads `manifest.yaml` and validates it against the manifest schema (Zod).
2. Agent-level defaults (model, timeout, allowedTools, env) are resolved.
3. Each bead is executed in order:
   a. The prompt template is loaded from the path specified in `prompt`.
   b. Template variables are rendered (built-ins, config overrides, manifest defaults, prior bead outputs).
   c. `claude -p` is spawned with the rendered prompt, tools, model, timeout, and environment.
   d. The last JSON code block in the response is extracted and validated against the bead's `outputSchema`.
   e. The validated output is stored and made available to subsequent beads via `{{beads.<name>.output.<field>}}`.
4. On pipeline success, the final bead's output is returned as `AgentRunResult.finalOutput`.
5. On failure, the engine reports which bead failed, the error category (FATAL or TRANSIENT), and per-bead outcomes.

## Quick Start

### Create a new agent

```bash
nightshift agent init my-agent
```

This creates `agents/my-agent/` with a starter `manifest.yaml`, a `prompts/` directory with functional stub prompts, and registers the agent in `nightshift.yaml`.

### Edit prompts

Modify the files in `agents/my-agent/prompts/` to define what each bead does. Each prompt is a markdown file that will be passed to `claude -p`. Use `{{variable_name}}` for template variables.

### Configure in nightshift.yaml

Set agent variables and schedule:

```yaml
agents:
  - name: my-agent
    variables:
      repo_url: "git@gitlab.com:team/project.git"

schedule:
  - agent: my-agent
    cron: "0 2 * * 1-5"
    variables:
      category: "refactoring"
```

### Validate

```bash
nightshift agent validate my-agent
```

This checks: manifest schema, prompt file existence, variable completeness, output schema compilation, and env var availability (warning only).

### Test

```bash
nightshift run --agent my-agent
```

Runs the agent in the foreground. You see per-bead status and the final result.

### Schedule

Add a cron entry in `nightshift.yaml` (see [nightshift.yaml Configuration](#nightshiftyaml-configuration)) and start the daemon:

```bash
nightshift start
```

## Manifest Reference

The manifest is a YAML file at `agents/<name>/manifest.yaml`. All fields are validated at load time using Zod.

### Top-Level Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | -- | Agent identifier. Must be kebab-case (e.g., `code-agent`, `my-agent`). |
| `description` | string | yes | -- | Human-readable description of what the agent does. |
| `model` | string | no | `"claude-sonnet-4-20250514"` | Default model for all beads. Bead-level `model` overrides this. |
| `timeout` | string | no | `"15m"` | Default timeout for all beads. Accepts duration format (e.g., `"30m"`, `"2h"`). |
| `allowedTools` | string[] | no | `["Bash", "Read", "Write"]` | Default tools for all beads. Bead-level `allowedTools` **replaces** this entirely (no merge). |
| `env` | array | no | `[]` | Agent-level environment variables. See [Environment Variables](#environment-variables). |
| `variables` | Record<string, string> | no | `{}` | Template variables with default values. Overridden by `nightshift.yaml` config. |
| `beads` | array | yes | -- | Ordered list of pipeline stages. At least one bead required. |

The schema is strict -- unknown fields are rejected at load time.

### Example: code-agent top-level

```yaml
name: code-agent
description: Analyzes a repository nightly and creates a focused improvement MR

model: claude-opus-4-6
timeout: 30m
allowedTools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep

variables:
  repo_url: ""
  category: ""
  category_guidance: ""
  confluence_page_id: ""
  mcp_config_path: ""
  reviewer: ""
  allowed_commands: "git, glab"
  retry_error: ""
```

Here `code-agent` sets `claude-opus-4-6` as the default model and a 30-minute timeout. It declares 8 variables, all with empty-string defaults that must be overridden in `nightshift.yaml` or at runtime.

## Bead Reference

Beads are the pipeline stages within an agent. They execute sequentially. Each bead must declare an `outputSchema` -- the engine validates every bead's output before proceeding to the next.

### Bead Types

**`standard`** -- The default bead type. Runs `claude -p` with the rendered prompt and validates the JSON output.

**`git-clone`** -- Clones a Git repository. Uses the `GitCloneBeadPlugin` internally. The prompt file is still required but is used minimally -- the plugin handles the clone operation. Output provides `repoDir` (path to cloned repo) and `handoffDir` (temporary directory for handoff files).

### Bead Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | -- | Unique identifier within the manifest. Used in template references (`{{beads.<name>.output.*}}`). |
| `type` | string | yes | -- | `"standard"` or `"git-clone"`. |
| `prompt` | string | yes | -- | Relative path to the prompt markdown file (e.g., `prompts/analyze.md`). Must not start with `/`. |
| `model` | string | no | inherits agent | Overrides the agent-level model for this bead. |
| `timeout` | string | no | inherits agent | Overrides the agent-level timeout for this bead. |
| `allowedTools` | string[] | no | inherits agent | **Replaces** the agent-level tools entirely (no merge). |
| `env` | array | no | `[]` | Bead-level env vars. **Merged** with agent-level env (bead wins on name collision). |
| `outputSchema` | object | yes | -- | JSON Schema object. Compiled to Zod at load time via `z.fromJSONSchema()`. |
| `mcpConfig` | string | no | -- | Path to an MCP config JSON file. Supports template variables (e.g., `"{{mcp_config_path}}"`). Must be a relative path or template variable. |
| `retry` | object | no | -- | Retry configuration: `{ maxAttempts: number, retryFrom: string }`. |

The bead schema is also strict -- unknown fields are rejected.

### Inheritance Rules

- **model, timeout**: bead overrides agent-level, which overrides system defaults (`claude-sonnet-4-20250514` / `15m`).
- **allowedTools**: bead **replaces** agent-level entirely. If a bead declares `allowedTools`, the agent-level list is ignored for that bead.
- **env**: bead **merges** with agent-level. On name collision, the bead-level value wins.
- **outputSchema**: no inheritance. Every bead must declare its own schema.

### Retry Configuration

The `retry` field enables automatic retry from a previous bead:

```yaml
retry:
  maxAttempts: 3        # Maximum number of retry attempts (1-10)
  retryFrom: implement  # Name of a preceding bead to restart from
```

When a bead with retry fails, the engine re-executes the pipeline starting from `retryFrom` up to `maxAttempts` times. The `retryFrom` bead must appear **before** the current bead in the pipeline -- this is enforced at schema validation time.

**How code-agent uses retry:** The `verify` bead retries from `implement`. If verification fails (tests break), the engine re-runs `implement` and `verify` up to 3 times. The `retry_error` variable is populated with the error details from the failed verify run, so the implement bead can see what went wrong and adapt its approach.

```yaml
- name: verify
  type: standard
  prompt: prompts/verify.md
  model: claude-sonnet-4-6
  retry:
    maxAttempts: 3
    retryFrom: implement
  outputSchema:
    type: object
    properties:
      passed:
        type: boolean
      error_details:
        type: string
    required:
      - passed
```

### Bead Name Uniqueness

Bead names must be unique within a manifest. The schema validation rejects duplicate names at load time.

### Example: code-agent beads

Code-agent declares 6 beads:

1. **clone** (`git-clone`) -- clones the target repository, provides `repoDir` and `handoffDir`
2. **analyze** (`standard`, model: `claude-opus-4-6`) -- scans repo for improvement candidates, outputs ranked list or `NO_IMPROVEMENT`
3. **implement** (`standard`, model: `claude-opus-4-6`) -- applies the selected improvement
4. **verify** (`standard`, model: `claude-sonnet-4-6`, retry from implement) -- runs build + tests
5. **mr** (`standard`, model: `claude-sonnet-4-6`, env: `GITLAB_TOKEN`) -- creates merge request
6. **log** (`standard`, model: `claude-sonnet-4-6`, mcpConfig, custom tools) -- logs to Confluence

## Template Variable System

Prompt files support template variables using `{{variable_name}}` syntax. Variables are resolved before the prompt is passed to `claude -p`.

### Syntax

```
{{variable_name}}                    # Simple variable
{{beads.clone.output.repoDir}}       # Bead output reference (dot notation)
{{beads.analyze.output.results[0]}}  # Array indexing
```

The template engine uses regex matching for `{{...}}` patterns. The regex accepts alphanumeric characters, dots, underscores, and bracket syntax: `{{[a-zA-Z0-9_.[\]]+}}`.

Arrays and objects are JSON-serialized when injected into a prompt. Undefined placeholders are left as-is in the rendered output (and caught at load-time validation).

### Variable Categories

**Built-in variables** (always available, highest precedence):

| Variable | Description | Example |
|----------|-------------|---------|
| `task_id` | Unique task identifier | `ns-a3f2b1c4` |
| `run_date` | Current date (yyyy-MM-dd) | `2026-03-09` |
| `agent_name` | Name from the manifest | `code-agent` |
| `repo_path` | Path to the agent directory | `/path/to/agents/code-agent` |

**User-defined variables**: Declared in the manifest `variables:` section with default values. Overridden by `nightshift.yaml` agent or schedule entries.

**Bead output references**: Access previous bead outputs using `{{beads.<bead_name>.output.<field>}}` and `{{beads.<bead_name>.rawOutput}}`.

### Resolution Precedence

From highest to lowest:

1. **Built-in variables** (`task_id`, `run_date`, `agent_name`, `repo_path`)
2. **Config overrides** (from `nightshift.yaml` agent `variables:` or schedule entry `variables:`)
3. **Manifest defaults** (from manifest `variables:` section)

### Bead Output References

After a bead completes, its validated JSON output is available to all subsequent beads:

```
{{beads.clone.output.repoDir}}       # Access the repoDir field from clone's output
{{beads.analyze.output.selected}}    # Access the selected object from analyze's output
{{beads.clone.rawOutput}}            # Access the raw string output (before JSON parsing)
```

**Dot notation resolution:** The engine normalizes array indexing (`foo[0].bar` becomes `foo.0.bar`) and walks the nested object tree. If any segment resolves to `null` or `undefined`, the entire expression returns `undefined` and the placeholder is left as-is.

**How code-agent uses bead output references:** The `implement.md` prompt references the analyze bead's output to know which improvement to apply:

```
The analysis bead selected the following improvement:
{{beads.analyze.output.selected}}

Apply this improvement to the repository at {{beads.clone.output.repoDir}}.
```

Since `selected` is an object, it is JSON-serialized when injected.

### Validation

At load time, `validateTemplateVars` checks that all `{{placeholder}}` patterns in prompts resolve to defined variables. **Exception:** `beads.*` references are skipped during load-time validation because bead outputs only exist at runtime.

If a prompt references `{{category}}` but the manifest does not declare `category` in its `variables:` section, validation fails with:

```
Prompt references undefined variables: category
```

**Variable name collision**: User-defined variable names must not collide with built-in names. Declaring a variable named `task_id` or `run_date` in the manifest is a hard error (`ManifestError`).

## nightshift.yaml Configuration

Agents are configured in `nightshift.yaml` using two top-level arrays: `agents` and `schedule`.

### `agents` Array

Declares agents by name with optional configuration:

```yaml
agents:
  - name: code-agent
    notify: true                          # Send push notifications (optional)
    variables:                            # Override manifest variable defaults (optional)
      repo_url: "git@gitlab.com:team/project.git"
      confluence_page_id: "12345678"
      mcp_config_path: "./mcp-atlassian.json"
      reviewer: "username"
    fallback_categories:                  # Agent-specific config (optional)
      - tests
      - refactoring
      - docs
      - security
      - performance
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Agent name (must match `agents/<name>/` directory). Kebab-case. |
| `notify` | boolean | no | Send Ntfy push notifications on start/end. |
| `variables` | Record<string, string> | no | Variable overrides applied to all runs of this agent. |
| `fallback_categories` | string[] | no | Category fallback order for code-agent. |

### `schedule` Array

Cron entries that trigger agent runs:

```yaml
schedule:
  - agent: code-agent
    cron: "0 2 * * 1-5"                  # 2 AM on weekdays
    variables:
      category: "refactoring"
    enabled: true                         # default: true
    notify: true                          # override agent-level notify

  - agent: code-agent
    cron: "0 2 * * 6"                    # 2 AM on Saturdays
    variables:
      category: "tests"
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `agent` | string | yes | -- | Agent name. Must be declared in the `agents` array. |
| `cron` | string | yes | -- | Cron expression ([croner](https://github.com/Hexagon/croner) syntax). |
| `variables` | Record<string, string> | no | `{}` | Variable overrides for this schedule entry. |
| `enabled` | boolean | no | `true` | Set to `false` to disable without removing. |
| `notify` | boolean | no | -- | Override agent-level notification setting. |

Schedule-level `variables` are merged with agent-level `variables` (schedule wins on collision). The combined result overrides manifest defaults.

### `agents_dir`

Path to the agents directory relative to the project root.

```yaml
agents_dir: ./agents    # default
```

### Config Validation

```bash
nightshift config validate    # Validates nightshift.yaml
```

The schema enforces:
- Agent names are kebab-case and unique.
- Schedule entries reference declared agents.
- Cron expressions are valid (for enabled entries).

## Output Schema and Contracts

Every bead must declare an `outputSchema` as a JSON Schema object. This is a strict contract: if a bead's output does not match, the pipeline aborts.

### How It Works

1. At manifest load time, each bead's `outputSchema` is compiled from JSON Schema to a Zod schema using `z.fromJSONSchema()`.
2. After `claude -p` completes, the engine extracts the **last JSON code block** from the response text.
3. The extracted JSON is parsed and validated against the compiled Zod schema.
4. On validation failure, the engine throws `BEAD_CONTRACT_VIOLATION` and aborts the pipeline.
5. On missing JSON code block, the engine throws `BEAD_OUTPUT_MISSING`.

### JSON Code Block Extraction

The engine uses the regex `` ```(?:json)?\n([\s\S]*?)\n``` `` to find all fenced code blocks. Both ```` ```json ```` and plain ```` ``` ```` blocks are matched. When multiple code blocks are present, only the **last** one is used.

This means the bead prompt should instruct the AI to produce its final output as a JSON code block:

```
Produce your output as a JSON code block:

  ```json
  {
    "result": "IMPROVEMENT_FOUND",
    "summary": "Added input validation to the API endpoint"
  }
  ```
```

### Example Output Schema

From code-agent's `analyze` bead:

```yaml
outputSchema:
  type: object
  properties:
    result:
      type: string
      enum:
        - IMPROVEMENT_FOUND
        - NO_IMPROVEMENT
    categoryUsed:
      type: string
    reason:
      type: string
    candidates:
      type: array
      items:
        type: object
        properties:
          rank:
            type: integer
          files:
            type: array
            items:
              type: string
          description:
            type: string
          rationale:
            type: string
    selected:
      type: object
      properties:
        rank:
          type: integer
        files:
          type: array
          items:
            type: string
        description:
          type: string
        rationale:
          type: string
  required:
    - result
    - categoryUsed
```

This schema allows the analyze bead to return either `IMPROVEMENT_FOUND` (with candidates and a selected improvement) or `NO_IMPROVEMENT` (with a reason). The `result` and `categoryUsed` fields are required; everything else is optional.

### Minimal Output Schema

For a simple bead that just reports success:

```yaml
outputSchema:
  type: object
  properties:
    status:
      type: string
  required:
    - status
```

### Nullable Fields

To allow a field to accept `null` values, add `nullable: true` to the field definition:

```yaml
outputSchema:
  type: object
  properties:
    name:
      type: string
    epic_key:
      type: string
      nullable: true
  required:
    - name
```

With `nullable: true`, the field accepts both its declared type and `null`. Without it, `null` values cause a `BEAD_CONTRACT_VIOLATION`.

Under the hood, `nullable: true` is an OpenAPI 3.0-style shorthand. The manifest loader transforms it to standard JSON Schema `type: ["string", "null"]` before compilation. You can also use the array type syntax directly if you prefer:

```yaml
    epic_key:
      type:
        - string
        - "null"
```

## Environment Variables

Beads execute in a minimal, isolated environment. Only explicitly declared env vars are passed through.

### Safe Base Environment

Every bead receives these host variables automatically (no declaration needed):

- `HOME`
- `PATH`
- `USER`
- `LANG`
- `SHELL`
- `TERM`

All other host environment variables are blocked unless explicitly declared.

### Declaration Syntax

Env vars are declared in the `env` array at agent or bead level. Two forms are supported:

**Passthrough string** -- reads the value from the host environment at runtime:

```yaml
env:
  - GITLAB_TOKEN          # Must exist in host env; throws ManifestError if missing
```

**Explicit object** -- hardcodes a value:

```yaml
env:
  - name: NODE_ENV
    value: production
```

**Security warning**: If a variable name matches the pattern `token|key|secret|password` (case-insensitive) and uses the explicit object form, the engine emits a console warning. Use passthrough syntax for secrets -- it avoids hardcoding sensitive values in manifest files.

### Merge Rules

Agent-level env and bead-level env are **merged**. On name collision, the bead-level value wins.

```yaml
# Agent level
env:
  - NODE_ENV                  # passthrough from host

beads:
  - name: my-bead
    env:
      - name: NODE_ENV        # overrides agent-level for this bead only
        value: test
```

### How code-agent uses env vars

Code-agent declares `GITLAB_TOKEN` as a passthrough on only two beads: `clone` (needs it for `git clone` over HTTPS) and `mr` (needs it for `glab mr create`). All other beads (analyze, implement, verify, log) do not receive `GITLAB_TOKEN` -- this is deliberate for security: they only interact with local files and do not need GitLab access.

```yaml
beads:
  - name: clone
    type: git-clone
    prompt: prompts/clone-stub.md
    env:
      - GITLAB_TOKEN             # Passthrough: reads from host
    outputSchema: ...

  - name: analyze
    type: standard
    prompt: prompts/analyze.md
    # No env -- no GITLAB_TOKEN access
    outputSchema: ...

  - name: mr
    type: standard
    prompt: prompts/mr.md
    env:
      - GITLAB_TOKEN             # Passthrough: reads from host
    outputSchema: ...
```

## CLI Commands Reference

### `nightshift agent init <name> [--force]`

Scaffolds a new agent directory:

```bash
nightshift agent init my-agent
```

Creates:
- `agents/my-agent/manifest.yaml` -- starter manifest with two beads (clone + analyze)
- `agents/my-agent/prompts/preamble.md` -- placeholder preamble
- `agents/my-agent/prompts/clone-stub.md` -- git-clone bead prompt
- `agents/my-agent/prompts/analyze.md` -- standard bead prompt with functional JSON output

Registers the agent in `nightshift.yaml` with a placeholder cron schedule.

**Name validation**: Agent names must be kebab-case (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`). Names like `my-agent`, `code-review`, and `a` are valid. Names like `MyAgent`, `my_agent`, and `-bad` are not.

Use `--force` to overwrite an existing agent directory.

### `nightshift agent validate <name|path>`

Validates an agent directory:

```bash
nightshift agent validate my-agent           # by name
nightshift agent validate ./agents/my-agent  # by path
```

Checks performed:
1. **Manifest schema** -- YAML parses correctly and matches the ManifestSchema
2. **Prompt files** -- all prompt files referenced by beads exist
3. **Variable completeness** -- all `{{placeholders}}` in prompts are declared in manifest variables (`beads.*` references skipped)
4. **Output schema compilation** -- all `outputSchema` entries compile via `z.fromJSONSchema()`
5. **Env var availability** -- passthrough env vars exist in the host environment (**warning only**, not an error)

Exit code: 0 on success, 1 on any error (env var warnings do not cause failure).

### `nightshift agent list [--json]`

Shows all agents:

```bash
nightshift agent list
```

Displays a table with columns: Name, Beads (count), Schedule (cron), Last Run (outcome + timestamp). Shows both configured agents (in `nightshift.yaml`) and unregistered agents (in `agents/` directory but not in config), with unregistered agents flagged as "(not scheduled)".

Use `--json` for machine-readable output.

### `nightshift agent show <name>`

Displays detailed agent information:

```bash
nightshift agent show code-agent
```

Shows: manifest summary (name, description, model, timeout, variables), bead pipeline (ordered list with type, model, retry config), schedule info (cron + next run), and recent runs from the JSONL log.

### `nightshift run --agent <name> [--var key=value...] [-n name] [-N]`

Run an agent in the foreground:

```bash
nightshift run --agent code-agent
nightshift run --agent code-agent --var repo_url=git@gitlab.com:team/repo.git --var category=tests
```

The `--var` flag passes variable overrides that take precedence over both manifest defaults and config overrides.

### `nightshift submit --agent <name> [prompt] [-t timeout] [-n name]`

Queue a task for daemon execution:

```bash
nightshift submit --agent code-agent
nightshift submit --agent my-agent "Analyze the codebase for security issues"
```

## Code-Agent: Annotated Reference

This section walks through `agents/code-agent/manifest.yaml` as a complete, annotated example. Code-agent is the built-in agent that ships with Night-Shift. It clones a repository, finds one focused improvement, implements it, verifies it, creates a merge request, and logs the result.

### Agent-Level Configuration

```yaml
name: code-agent
description: Analyzes a repository nightly and creates a focused improvement MR
```

The name `code-agent` matches the directory name `agents/code-agent/`.

```yaml
model: claude-opus-4-6
timeout: 30m
```

**Why Opus?** Code-agent uses Opus as the default model because the analysis and implementation beads benefit from stronger reasoning. Individual beads can downgrade to Sonnet where cheaper, faster execution is sufficient (verify, mr, log).

```yaml
allowedTools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
```

These are the default tools available to all beads unless overridden. Code-agent needs file system access and shell execution for repository analysis and modification.

### Variables

```yaml
variables:
  repo_url: ""
  category: ""
  category_guidance: ""
  confluence_page_id: ""
  mcp_config_path: ""
  reviewer: ""
  allowed_commands: "git, glab"
  retry_error: ""
```

All variables have empty-string defaults. In practice:

- `repo_url` -- set in `nightshift.yaml` to the target repository SSH/HTTPS URL
- `category` -- set per schedule entry (e.g., "tests" on Mondays, "refactoring" on Tuesdays)
- `category_guidance` -- optional detailed guidance for the category
- `confluence_page_id` -- Confluence page for the log bead to update
- `mcp_config_path` -- path to MCP config for the Confluence bead
- `reviewer` -- GitLab username to assign as MR reviewer
- `allowed_commands` -- commands the agent is allowed to execute (safety constraint in prompts)
- `retry_error` -- populated by the engine on verify retry with the error details from the failed run

### Bead Pipeline

#### 1. Clone (`git-clone` type)

```yaml
- name: clone
  type: git-clone
  prompt: prompts/clone-stub.md
  env:
    - GITLAB_TOKEN
  outputSchema:
    type: object
    properties:
      repoDir: { type: string }
      handoffDir: { type: string }
    required: [repoDir, handoffDir]
```

The `git-clone` type uses the `GitCloneBeadPlugin`, which handles the actual `git clone` operation. `GITLAB_TOKEN` is passed through from the host for authenticated clone. The output (`repoDir`, `handoffDir`) is referenced by all subsequent beads via `{{beads.clone.output.repoDir}}` and `{{beads.clone.output.handoffDir}}`.

#### 2. Analyze (`standard`, Opus)

```yaml
- name: analyze
  type: standard
  prompt: prompts/analyze.md
  model: claude-opus-4-6
  outputSchema:
    type: object
    properties:
      result:
        type: string
        enum: [IMPROVEMENT_FOUND, NO_IMPROVEMENT]
      categoryUsed: { type: string }
      reason: { type: string }
      candidates:
        type: array
        items:
          type: object
          properties:
            rank: { type: integer }
            files: { type: array, items: { type: string } }
            description: { type: string }
            rationale: { type: string }
      selected:
        type: object
        properties:
          rank: { type: integer }
          files: { type: array, items: { type: string } }
          description: { type: string }
          rationale: { type: string }
    required: [result, categoryUsed]
```

The analyze bead explicitly sets `model: claude-opus-4-6` (same as agent default, but explicit for clarity). It uses the `enum` constraint on `result` to enforce a binary outcome. If `NO_IMPROVEMENT` is returned, the agent may try fallback categories (configured via `fallback_categories` in `nightshift.yaml`).

#### 3. Implement (`standard`, Opus)

```yaml
- name: implement
  type: standard
  prompt: prompts/implement.md
  model: claude-opus-4-6
  outputSchema:
    type: object
    properties:
      status:
        type: string
        enum: [IMPLEMENTED]
    required: [status]
```

The implement bead receives the analyze bead's selected improvement via `{{beads.analyze.output.selected}}` in its prompt. It has a simple schema: just report that the implementation is done.

#### 4. Verify (`standard`, Sonnet, with retry)

```yaml
- name: verify
  type: standard
  prompt: prompts/verify.md
  model: claude-sonnet-4-6
  retry:
    maxAttempts: 3
    retryFrom: implement
  outputSchema:
    type: object
    properties:
      passed: { type: boolean }
      error_details: { type: string }
    required: [passed]
```

**Why Sonnet for verify?** Verification is a focused task (run tests, check build) that does not need Opus-level reasoning. Sonnet is faster and cheaper.

**Why retry from implement?** If verification fails, the implementation needs to change. The engine re-executes from `implement` through `verify`, up to 3 attempts. The `retry_error` variable carries the failure details so the implement bead can adapt.

#### 5. MR (`standard`, Sonnet, env: GITLAB_TOKEN)

```yaml
- name: mr
  type: standard
  prompt: prompts/mr.md
  model: claude-sonnet-4-6
  env:
    - GITLAB_TOKEN
  outputSchema:
    type: object
    properties:
      mr_url: { type: string }
      outcome:
        type: string
        enum: [MR_CREATED, MR_FAILED]
    required: [outcome]
```

The MR bead is the only standard bead (besides clone) that receives `GITLAB_TOKEN`. It uses `glab` to create branches, push commits, and open merge requests. The enum constraint distinguishes success from failure.

#### 6. Log (`standard`, Sonnet, MCP tools, short timeout)

```yaml
- name: log
  type: standard
  prompt: prompts/log.md
  model: claude-sonnet-4-6
  timeout: 2m
  mcpConfig: "{{mcp_config_path}}"
  allowedTools:
    - mcp__atlassian__getAccessibleAtlassianResources
    - mcp__atlassian__getConfluencePage
    - mcp__atlassian__updateConfluencePage
    - Read
  outputSchema:
    type: object
    properties:
      logged: { type: boolean }
    required: [logged]
```

**Custom tools:** The log bead overrides the agent-level `allowedTools` entirely. It only needs Confluence MCP tools and `Read` (to read the run log file). No `Bash`, `Write`, or `Edit` -- this bead should not modify the repository.

**mcpConfig with template variable:** The `{{mcp_config_path}}` is resolved at runtime from the manifest variable. This lets the user point to their MCP Atlassian config file without hardcoding the path.

**Short timeout:** Logging to Confluence is a simple operation. The 2-minute timeout (vs. the 30-minute agent default) prevents a stuck MCP connection from blocking the pipeline.

## Known Tools

The manifest schema validates `allowedTools` against a known list:

| Tool | Description |
|------|-------------|
| `Bash` | Execute shell commands |
| `Read` | Read file contents |
| `Write` | Write/create files |
| `Edit` | Edit existing files |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents |
| `WebFetch` | Fetch web pages |
| `WebSearch` | Search the web |
| `Task` | Create subtasks |
| `NotebookEdit` | Edit Jupyter notebooks |
| `mcp__*` | Any MCP server tool (e.g., `mcp__jira__getIssue`, `mcp__atlassian__getConfluencePage`) |

Unknown tool names are rejected at load time with a validation error listing the known tools.

## Path Security

The manifest loader performs path containment checks to prevent directory traversal attacks:

- The agent directory must be contained within the configured `agents_dir` root.
- Prompt paths must be relative (no leading `/`).
- `mcpConfig` must be a relative path or a template variable (no leading `/` unless it starts with `{{`).
- Symlinks are resolved before containment checks (`fs.realpath()`).
- Violations throw `ManifestSecurityError`.

## Troubleshooting

### "Prompt references undefined variables: X"

The prompt file uses `{{X}}` but `X` is not declared in the manifest `variables:` section. Add it to `variables:` with a default value, or check for typos.

### "BEAD_CONTRACT_VIOLATION"

The bead's output JSON does not match the declared `outputSchema`. Common causes:
- Missing required fields in the JSON output
- Wrong data types (e.g., string where integer is expected)
- Invalid enum values
- JSON output not in a fenced code block

Check that the prompt instructs the AI to produce JSON matching the exact schema.

### "BEAD_OUTPUT_MISSING"

The bead's response did not contain a JSON code block. Ensure the prompt explicitly asks for output in a fenced code block with triple backticks.

### "env var X (passthrough) is not set in the host environment"

A passthrough env var is declared but not available in the host. Export the variable before running the agent, or use `agent validate` to check (reports as warning).

### "Path containment violation"

A prompt path or agent directory resolves outside the agents root directory. Ensure all paths are relative and within the `agents/` tree.

### "Duplicate bead names: X"

Two or more beads share the same `name`. Bead names must be unique within a manifest.

### "X is not a preceding bead name"

A bead's `retry.retryFrom` references a bead that either does not exist or appears after the current bead in the pipeline. The `retryFrom` target must be a bead that comes before the bead with the retry configuration.

### "Variable name collision with built-ins: X"

A manifest declares a user variable with the same name as a built-in variable (`task_id`, `run_date`, `agent_name`, or `repo_path`). Rename the variable to avoid the collision.
