# Agent System Reference

This document is the complete reference for creating, configuring, and running agents in Night-Shift. It is written to be self-contained: an AI agent or engineer reading this document should be able to create a fully functional agent from scratch without reading source code.

## Overview

An **agent** is a directory containing a `manifest.yaml` file and a `prompts/` directory with markdown prompt files. The manifest declares the agent's pipeline: an ordered list of **steps** (stages), each of which invokes `claude -p` with specific instructions, tools, model, timeout, and an output schema.

When an agent runs, the **AgentEngine** loads its manifest, resolves template variables, and executes steps sequentially. Each step receives a rendered prompt, produces JSON output validated against a declared schema, and passes its output to subsequent steps via template variable references.

### Directory Structure

```
agents/<name>/
  manifest.yaml              # Pipeline definition (required)
  prompts/                   # Prompt files referenced by steps (required)
    preamble.md              # Optional: prepended to all step prompts
    analyze.md               # One .md file per step
    implement.md
    ...
```

The `agents/` directory location is configurable via `agents_dir` in `nightshift.yaml` (default: `./agents`).

### How Agents Execute

1. The engine loads `manifest.yaml` and validates it against the manifest schema (Zod).
2. Agent-level defaults (model, timeout, allowedTools, env) are resolved.
3. Each step is executed in order:
   a. The prompt template is loaded from the path specified in `prompt`.
   b. Template variables are rendered (built-ins, config overrides, manifest defaults, prior step outputs).
   c. `claude -p` is spawned with the rendered prompt, tools, model, timeout, and environment.
   d. The last JSON code block in the response is extracted and validated against the step's `outputSchema`.
   e. The validated output is stored and made available to subsequent steps via `{{steps.<name>.output.<field>}}`.
4. On pipeline success, the final step's output is returned as `AgentRunResult.finalOutput`.
5. On failure, the engine reports which step failed, the error category (FATAL or TRANSIENT), and per-step outcomes.

## Quick Start

### Create a new agent

```bash
nightshift agent init my-agent
```

This creates `agents/my-agent/` with a starter `manifest.yaml`, a `prompts/` directory with functional stub prompts, and registers the agent in `nightshift.yaml`.

### Edit prompts

Modify the files in `agents/my-agent/prompts/` to define what each step does. Each prompt is a markdown file that will be passed to `claude -p`. Use `{{variable_name}}` for template variables.

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

Runs the agent in the foreground. You see per-step status and the final result.

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
| `model` | string | no | `"claude-sonnet-4-20250514"` | Default model for all steps. Step-level `model` overrides this. |
| `timeout` | string | no | `"15m"` | Default timeout for all steps. Accepts duration format (e.g., `"30m"`, `"2h"`). |
| `allowedTools` | string[] | no | `["Bash", "Read", "Write"]` | Default tools for all steps. Step-level `allowedTools` **replaces** this entirely (no merge). |
| `env` | array | no | `[]` | Agent-level environment variables. See [Environment Variables](#environment-variables). |
| `variables` | Record<string, string> | no | `{}` | Template variables with default values. Overridden by `nightshift.yaml` config. |
| `stateDir` | string | no | -- | Relative path to a persistent directory within the agent dir. Created automatically. Injected as `{{state_dir}}`. See [Persistent State Directory](#persistent-state-directory). |
| `imports` | Record<string, string> | no | -- | Cross-agent directory imports. Maps variable names to `agentName/dirName`. See [Cross-Agent Imports](#cross-agent-imports). |
| `steps` | array | yes | -- | Ordered list of pipeline stages. At least one step required. |

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

## Step Reference

Steps are the pipeline stages within an agent. They execute sequentially. Each step must declare an `outputSchema` -- the engine validates every step's output before proceeding to the next.

### Step Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | -- | Unique identifier within the manifest. Must match `/^[a-zA-Z][a-zA-Z0-9_]*$/` — no hyphens. Used in template references (`{{steps.<name>.output.*}}`). |
| `prompt` | string | yes | -- | Relative path to the prompt markdown file (e.g., `prompts/analyze.md`). Must not start with `/`. |
| `model` | string | no | inherits agent | Overrides the agent-level model for this step. |
| `timeout` | string | no | inherits agent | Overrides the agent-level timeout for this step. |
| `allowedTools` | string[] | no | inherits agent | **Replaces** the agent-level tools entirely (no merge). |
| `env` | array | no | `[]` | Step-level env vars. **Merged** with agent-level env (step wins on name collision). |
| `outputSchema` | object | yes | -- | JSON Schema object. Compiled to Zod at load time via `z.fromJSONSchema()`. |
| `mcpConfig` | string | no | -- | Path to an MCP config JSON file. Supports template variables (e.g., `"{{mcp_config_path}}"`). Must be a relative path or template variable. |
| `retry` | object | no | -- | Retry configuration: `{ maxAttempts: number, retryFrom: string }`. |
| `earlyExit` | object | no | -- | Early exit configuration: `{ when: Record<string, unknown>, reason?: string }`. When step output matches `when` conditions, remaining steps are skipped. See [Pipeline Early Exit](#pipeline-early-exit). |

The step schema is also strict -- unknown fields are rejected.

### Inheritance Rules

- **model, timeout**: step overrides agent-level, which overrides system defaults (`claude-sonnet-4-20250514` / `15m`).
- **allowedTools**: step **replaces** agent-level entirely. If a step declares `allowedTools`, the agent-level list is ignored for that step.
- **env**: step **merges** with agent-level. On name collision, the step-level value wins.
- **outputSchema**: no inheritance. Every step must declare its own schema.

### Retry Configuration

The `retry` field enables automatic retry from a previous step:

```yaml
retry:
  maxAttempts: 3        # Maximum number of retry attempts (1-10)
  retryFrom: implement  # Name of a preceding step to restart from
```

The `retryFrom` step must appear **before** the current step in the pipeline — this is enforced at schema validation time.

**How retry triggers:**

Retry is NOT triggered by step exceptions or crashes. It triggers when the step **succeeds** (produces valid JSON matching its schema) but the output contains `passed: false`. This means:

1. The step must include a `passed` boolean field in its `outputSchema`
2. When `passed` is `false`, the engine checks for retry config
3. If retries remain, the engine:
   a. Reads `error_details` from the step output and injects it as the `retry_error` template variable
   b. Runs `git reset --hard HEAD` on the working directory to restore a clean state
   c. Re-executes from the `retryFrom` step
4. If retries are exhausted (`retryCount > maxAttempts`), execution continues to the next step

Step failures (exceptions, timeouts, missing output) are categorized as FATAL or TRANSIENT errors and abort the pipeline immediately — they do not trigger retry.

**How code-agent uses retry:** The `verify` step retries from `implement`. If verification fails (tests break), the engine re-runs `implement` and `verify` up to 3 times. The `retry_error` variable is populated with the error details from the failed verify run, so the implement step can see what went wrong and adapt its approach.

```yaml
- name: verify
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

### Step Name Uniqueness

### Step Name Uniqueness

Step names must be unique within a manifest. The schema validation rejects duplicate names at load time.

### Step Name Rules

Step names must match `/^[a-zA-Z][a-zA-Z0-9_]*$/`:
- Must start with a letter
- Followed by letters, digits, or underscores
- **No hyphens, no spaces, no special characters**

Invalid names are rejected at manifest load time with an actionable error:

```
Step name 'pick-item' contains unsupported characters. Use 'pick_item' instead.
```

### Pipeline Early Exit

The `earlyExit` field on a step enables declarative pipeline short-circuiting. When the step's JSON output matches all conditions in `earlyExit.when`, remaining steps are skipped:

```yaml
- name: check_inbox
  prompt: prompts/check_inbox.md
  earlyExit:
    when:
      result: "NOTHING_TO_DO"
    reason: "No pending reviews"
  outputSchema:
    type: object
    properties:
      result:
        type: string
    required: [result]
```

- `when` (required): Key-value pairs to match against step output. Uses deep equality (JSON.stringify comparison). All pairs must match.
- `reason` (optional): Human-readable reason for the notification body. Falls back to auto-generated text from matched conditions.
- On match: remaining steps get status `SKIPPED` with `durationMs: 0`, overall result is `SUCCESS`, and `earlyExitReason` is populated on the `AgentRunResult`.
- Early exit takes precedence over retry triggers.

See the [M002 Developer Guide](m002-developer-guide.md#3-pipeline-early-exit) for detailed examples.

### Persistent State Directory

The `stateDir` top-level field declares a persistent directory within the agent directory:

```yaml
name: gardener-feedback
stateDir: memory
```

- The path is relative to the agent directory (absolute paths are rejected)
- The engine creates the directory automatically via `ensureDir()` before executing steps
- The absolute path is injected as `{{state_dir}}` in all prompt templates
- The directory persists across runs (never cleaned up by the framework)

### Cross-Agent Imports

The `imports` top-level field maps variable names to another agent's directory:

```yaml
name: gardener-v2
imports:
  gardener_memory: "gardener-feedback/memory"
```

- Import values must match `agentName/dirName` (exactly one slash)
- At daemon startup, the orchestrator validates: referenced agent exists, directory exists on disk, variable name is not reserved
- Resolved absolute paths are injected as template variables (e.g., `{{gardener_memory}}`)

See the [M002 Developer Guide](m002-developer-guide.md) for full documentation of these features.

### Example: code-agent steps

Code-agent declares 6 steps:

1. **clone** -- clones the target repository via prompt-driven git operations, provides `repoDir` and `handoffDir`
2. **analyze** (model: `claude-opus-4-6`) -- scans repo for improvement candidates, outputs ranked list or `NO_IMPROVEMENT`
3. **implement** (model: `claude-opus-4-6`) -- applies the selected improvement
4. **verify** (model: `claude-sonnet-4-6`, retry from implement) -- runs build + tests
5. **mr** (model: `claude-sonnet-4-6`, env: `GITLAB_TOKEN`) -- creates merge request
6. **log** (model: `claude-sonnet-4-6`, mcpConfig, custom tools) -- logs to Confluence

## Template Variable System

Prompt files support template variables using `{{variable_name}}` syntax. Variables are resolved before the prompt is passed to `claude -p`.

### Syntax

```
{{variable_name}}                    # Simple variable
{{steps.clone.output.repoDir}}       # Step output reference (dot notation)
{{steps.analyze.output.results[0]}}  # Array indexing
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
| `state_dir` | Absolute path to agent's persistent state directory (only when `stateDir` is declared in manifest) | `/path/to/agents/gardener-feedback/memory` |

**User-defined variables**: Declared in the manifest `variables:` section with default values. Overridden by `nightshift.yaml` agent or schedule entries.

**Step output references**: Access previous step outputs using `{{steps.<step_name>.output.<field>}}` and `{{steps.<step_name>.rawOutput}}`.

### Resolution Precedence

From highest to lowest:

1. **Built-in variables** (`task_id`, `run_date`, `agent_name`, `repo_path`)
2. **Config overrides** (from `nightshift.yaml` agent `variables:` or schedule entry `variables:`)
3. **Manifest defaults** (from manifest `variables:` section)

### Step Output References

After a step completes, its validated JSON output is available to all subsequent steps:

```
{{steps.clone.output.repoDir}}       # Access the repoDir field from clone's output
{{steps.analyze.output.selected}}    # Access the selected object from analyze's output
{{steps.clone.rawOutput}}            # Access the raw string output (before JSON parsing)
```

**Dot notation resolution:** The engine normalizes array indexing (`foo[0].bar` becomes `foo.0.bar`) and walks the nested object tree. If any segment resolves to `null` or `undefined`, the entire expression returns `undefined` and the placeholder is left as-is.

**How code-agent uses step output references:** The `implement.md` prompt references the analyze step's output to know which improvement to apply:

```
The analysis step selected the following improvement:
{{steps.analyze.output.selected}}

Apply this improvement to the repository at {{steps.clone.output.repoDir}}.
```

Since `selected` is an object, it is JSON-serialized when injected.

### Validation

At load time, `validateTemplateVars` checks that all `{{placeholder}}` patterns in prompts resolve to defined variables. **Exception:** `steps.*` references are skipped during load-time validation because step outputs only exist at runtime.

If a prompt references `{{category}}` but the manifest does not declare `category` in its `variables:` section, validation fails with:

```
Prompt references undefined variables: category
```

**Variable name collision**: User-defined variable names (and import variable names) must not collide with reserved names (`task_id`, `run_date`, `agent_name`, `repo_path`, `state_dir`). Declaring a variable or import with any of these names is a hard error (`ManifestError`).

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
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Agent name (must match `agents/<name>/` directory). Kebab-case. |
| `notify` | boolean | no | Send Ntfy push notifications on start/end. |
| `variables` | Record<string, string> | no | Variable overrides applied to all runs of this agent. |

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

Every step must declare an `outputSchema` as a JSON Schema object. This is a strict contract: if a step's output does not match, the pipeline aborts.

### How It Works

1. At manifest load time, each step's `outputSchema` is compiled from JSON Schema to a Zod schema using `z.fromJSONSchema()`.
2. After `claude -p` completes, the engine extracts the **last JSON code block** from the response text.
3. The extracted JSON is parsed and validated against the compiled Zod schema.
4. On validation failure, the engine throws `STEP_CONTRACT_VIOLATION` and aborts the pipeline.
5. On missing JSON code block, the engine throws `STEP_OUTPUT_MISSING`.

### JSON Code Block Extraction

The engine uses the regex `` ```(?:json)?\n([\s\S]*?)\n``` `` to find all fenced code blocks. Both ```` ```json ```` and plain ```` ``` ```` blocks are matched. When multiple code blocks are present, only the **last** one is used.

This means the step prompt should instruct the AI to produce its final output as a JSON code block:

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

From code-agent's `analyze` step:

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

This schema allows the analyze step to return either `IMPROVEMENT_FOUND` (with candidates and a selected improvement) or `NO_IMPROVEMENT` (with a reason). The `result` and `categoryUsed` fields are required; everything else is optional.

### Minimal Output Schema

For a simple step that just reports success:

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

With `nullable: true`, the field accepts both its declared type and `null`. Without it, `null` values cause a `STEP_CONTRACT_VIOLATION`.

Under the hood, `nullable: true` is an OpenAPI 3.0-style shorthand. The manifest loader transforms it to standard JSON Schema `type: ["string", "null"]` before compilation. You can also use the array type syntax directly if you prefer:

```yaml
    epic_key:
      type:
        - string
        - "null"
```

## Environment Variables

Steps execute in a minimal, isolated environment. Only explicitly declared env vars are passed through.

### Safe Base Environment

Every step receives these host variables automatically (no declaration needed):

- `HOME`
- `PATH`
- `USER`
- `LANG`
- `SHELL`
- `TERM`

All other host environment variables are blocked unless explicitly declared.

### Declaration Syntax

Env vars are declared in the `env` array at agent or step level. Two forms are supported:

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

Agent-level env and step-level env are **merged**. On name collision, the step-level value wins.

```yaml
# Agent level
env:
  - NODE_ENV                  # passthrough from host

steps:
  - name: my-step
    env:
      - name: NODE_ENV        # overrides agent-level for this step only
        value: test
```

### How code-agent uses env vars

Code-agent declares `GITLAB_TOKEN` as a passthrough on only two steps: `clone` (needs it for `git clone` over HTTPS) and `mr` (needs it for `glab mr create`). All other steps (analyze, implement, verify, log) do not receive `GITLAB_TOKEN` -- this is deliberate for security: they only interact with local files and do not need GitLab access.

```yaml
steps:
  - name: clone
    prompt: prompts/clone.md
    env:
      - GITLAB_TOKEN             # Passthrough: reads from host
    outputSchema: ...

  - name: analyze
    prompt: prompts/analyze.md
    # No env -- no GITLAB_TOKEN access
    outputSchema: ...

  - name: mr
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
- `agents/my-agent/manifest.yaml` -- starter manifest with an analyze step
- `agents/my-agent/prompts/preamble.md` -- placeholder preamble
- `agents/my-agent/prompts/analyze.md` -- step prompt with functional JSON output

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
2. **Prompt files** -- all prompt files referenced by steps exist
3. **Variable completeness** -- all `{{placeholders}}` in prompts are declared in manifest variables (`steps.*` references skipped)
4. **Output schema compilation** -- all `outputSchema` entries compile via `z.fromJSONSchema()`
5. **Env var availability** -- passthrough env vars exist in the host environment (**warning only**, not an error)

Exit code: 0 on success, 1 on any error (env var warnings do not cause failure).

### `nightshift agent list [--json]`

Shows all agents:

```bash
nightshift agent list
```

Displays a table with columns: Name, Steps (count), Schedule (cron), Last Run (outcome + timestamp). Shows both configured agents (in `nightshift.yaml`) and unregistered agents (in `agents/` directory but not in config), with unregistered agents flagged as "(not scheduled)".

Use `--json` for machine-readable output.

### `nightshift agent show <name>`

Displays detailed agent information:

```bash
nightshift agent show code-agent
```

Shows: manifest summary (name, description, model, timeout, variables), step pipeline (ordered list with model, retry config), schedule info (cron + next run), and recent runs from the JSONL log.

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

**Why Opus?** Code-agent uses Opus as the default model because the analysis and implementation steps benefit from stronger reasoning. Individual steps can downgrade to Sonnet where cheaper, faster execution is sufficient (verify, mr, log).

```yaml
allowedTools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
```

These are the default tools available to all steps unless overridden. Code-agent needs file system access and shell execution for repository analysis and modification.

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
- `confluence_page_id` -- Confluence page for the log step to update
- `mcp_config_path` -- path to MCP config for the Confluence step
- `reviewer` -- GitLab username to assign as MR reviewer
- `allowed_commands` -- commands the agent is allowed to execute (safety constraint in prompts)
- `retry_error` -- populated by the engine on verify retry with the error details from the failed run

### Step Pipeline

#### 1. Clone

```yaml
- name: clone
  prompt: prompts/clone.md
  env:
    - GITLAB_TOKEN
  outputSchema:
    type: object
    properties:
      repoDir: { type: string }
      handoffDir: { type: string }
    required: [repoDir, handoffDir]
```

The clone step handles the actual `git clone` operation via its prompt instructions. `GITLAB_TOKEN` is passed through from the host for authenticated clone. The output (`repoDir`, `handoffDir`) is referenced by all subsequent steps via `{{steps.clone.output.repoDir}}` and `{{steps.clone.output.handoffDir}}`.

#### 2. Analyze (Opus)

```yaml
- name: analyze
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

The analyze step explicitly sets `model: claude-opus-4-6` (same as agent default, but explicit for clarity). It uses the `enum` constraint on `result` to enforce a binary outcome. If `NO_IMPROVEMENT` is returned, the agent handles any retry or fallback logic internally via subsequent steps.

#### 3. Implement (Opus)

```yaml
- name: implement
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

The implement step receives the analyze step's selected improvement via `{{steps.analyze.output.selected}}` in its prompt. It has a simple schema: just report that the implementation is done.

#### 4. Verify (Sonnet, with retry)

```yaml
- name: verify
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

**Why retry from implement?** If verification fails, the implementation needs to change. The engine re-executes from `implement` through `verify`, up to 3 attempts. The `retry_error` variable carries the failure details so the implement step can adapt.

#### 5. MR (Sonnet, env: GITLAB_TOKEN)

```yaml
- name: mr
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

The MR step is the only step (besides clone) that receives `GITLAB_TOKEN`. It uses `glab` to create branches, push commits, and open merge requests. The enum constraint distinguishes success from failure.

#### 6. Log (Sonnet, MCP tools, short timeout)

```yaml
- name: log
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

**Custom tools:** The log step overrides the agent-level `allowedTools` entirely. It only needs Confluence MCP tools and `Read` (to read the run log file). No `Bash`, `Write`, or `Edit` -- this step should not modify the repository.

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

### "STEP_CONTRACT_VIOLATION"

The step's output JSON does not match the declared `outputSchema`. Common causes:
- Missing required fields in the JSON output
- Wrong data types (e.g., string where integer is expected)
- Invalid enum values
- JSON output not in a fenced code block

Check that the prompt instructs the AI to produce JSON matching the exact schema.

### "STEP_OUTPUT_MISSING"

The step's response did not contain a JSON code block. Ensure the prompt explicitly asks for output in a fenced code block with triple backticks.

### "env var X (passthrough) is not set in the host environment"

A passthrough env var is declared but not available in the host. Export the variable before running the agent, or use `agent validate` to check (reports as warning).

### "Path containment violation"

A prompt path or agent directory resolves outside the agents root directory. Ensure all paths are relative and within the `agents/` tree.

### "Duplicate step names: X"

Two or more steps share the same `name`. Step names must be unique within a manifest.

### "X is not a preceding step name"

A step's `retry.retryFrom` references a step that either does not exist or appears after the current step in the pipeline. The `retryFrom` target must be a step that comes before the step with the retry configuration.

### "Variable name collision with built-ins: X"

A manifest declares a user variable or import variable with the same name as a reserved name (`task_id`, `run_date`, `agent_name`, `repo_path`, or `state_dir`). Rename the variable to avoid the collision.

### "Step name 'X' contains unsupported characters. Use 'Y' instead."

Step names must match `/^[a-zA-Z][a-zA-Z0-9_]*$/`. Hyphens, spaces, and leading digits are not allowed. The error suggests the snake_case equivalent.

### "import value 'X' must match the pattern 'agentName/dirName'"

An import value in the `imports` section doesn't follow the `agentName/dirName` pattern. Must be exactly one slash with no leading/trailing slashes.

### "import 'X' references agent 'Y' which is not declared in config.agents"

The import references an agent that is not listed in `nightshift.yaml`'s `agents` array. Add the referenced agent to your config.

### "import 'X' references directory 'Y' which does not exist"

The resolved import path doesn't exist on disk. Create the directory (or declare `stateDir` on the referenced agent and run it once).
