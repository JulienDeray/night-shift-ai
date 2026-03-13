# Night-Shift

[![CI](https://github.com/julienderay/night-shift/.github/workflows/ci.yml/badge.svg)](https://github.com/julienderay/night-shift/.github/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

Local-first framework for running autonomous AI agents during off-hours.

## Why

Night-shift turns your machine into an agent platform that works while you sleep. Define agents as directories with YAML manifests and prompt files, schedule them with cron, and read results in the morning.

The system is **local-first** by design. No cloud infrastructure, no servers, no accounts. A background daemon on your machine evaluates schedules, loads agent manifests, and executes bead pipelines through `claude -p` processes with your existing MCP server connections (Jira, Confluence, filesystem, etc.). Results are written as markdown files you review in the morning.

Agents are **pluggable**. Night-shift ships with a `code-agent` that clones a GitLab repo each night, finds one small improvement, and creates a merge request. You can create your own agents for any task -- each is a self-contained directory with a `manifest.yaml` defining the pipeline and `prompts/` containing the instructions.

Night-shift requires the [Claude CLI](https://claude.ai/download) -- all agent execution goes through `claude -p`.

Task tracking uses [beads](https://github.com/steveyegge/beads) for dependency graphs and atomic claiming, but falls back to a simple file-based queue when beads is unavailable.

## Prerequisites

- **Node.js >= 20**
- **[Claude CLI](https://claude.ai/download)** -- the agent runtime (`claude -p`)
- **[beads](https://github.com/steveyegge/beads)** (optional) -- enables dependency graphs and atomic task claiming; falls back to a file-based queue without it

## Quick Start

```bash
# Install from source
git clone https://github.com/julienderay/night-shift.git
cd night-shift
npm install
npm run build
npm link                     # registers the `nightshift` binary on your PATH

# Initialize project
nightshift init              # creates .nightshift/ and nightshift.yaml

# Create your first agent
nightshift agent init my-agent       # scaffold agent directory + manifest
nightshift agent validate my-agent   # check manifest, prompts, variables
nightshift run --agent my-agent      # test run in foreground

# Start the daemon (runs in background)
nightshift start

# Check on things
nightshift status            # daemon state + queue depth
nightshift inbox             # browse completed reports

# Stop when done
nightshift stop
```

Edit `nightshift.yaml` to configure agents, schedules, and settings. See [Agent System](#agent-system) for details.

## Agent System

Agents are directories under `agents/`, each containing a `manifest.yaml` and a `prompts/` directory with markdown prompt files. The manifest defines the agent's pipeline: an ordered list of **beads** (stages), each invoking `claude -p` with specific tools, model, timeout, and an output schema contract.

```
agents/
  code-agent/
    manifest.yaml          # Pipeline definition
    prompts/
      clone-stub.md        # Git clone instructions
      analyze.md           # Analysis prompt
      implement.md         # Implementation prompt
      verify.md            # Verification prompt
      mr.md                # Merge request prompt
      log.md               # Confluence logging prompt
  my-agent/
    manifest.yaml
    prompts/
      clone-stub.md
      analyze.md
```

**Bead types:**
- `standard` -- runs `claude -p` with the prompt, validates JSON output against the declared schema
- `git-clone` -- clones a repository, provides `repoDir` and `handoffDir` to downstream beads

**Key features:**
- Template variables (`{{variable_name}}`) in prompts, with bead output references (`{{beads.clone.output.repoDir}}`)
- Output schema contracts -- every bead declares a JSON Schema; violations abort the pipeline. Supports `nullable: true` on fields (OpenAPI 3.0 shorthand for accepting `null` values)
- Retry support -- a bead can declare `retry: { maxAttempts: N, retryFrom: <bead> }` to re-execute from a preceding bead on failure (e.g., verify retries from implement up to 3 times). Retry triggers when the bead output contains `passed: false`; the working directory is `git reset --hard` before each retry, and the `retry_error` variable is populated with the failure's `error_details`
- Per-bead MCP config -- a bead can declare `mcpConfig: "path/to/mcp.json"` (supports template variables) to load MCP server connections for that bead only
- Environment variable isolation -- minimal safe env by default (`HOME`, `PATH`, `USER`, `LANG`, `SHELL`, `TERM`), explicit allowlisting per bead via `env` (passthrough strings or `{name, value}` objects)
- Tool restriction -- `allowedTools` at agent or bead level controls which Claude tools are available. Bead-level **replaces** agent-level entirely (no merge)

Night-shift ships with `code-agent` as a built-in example. See [docs/agents.md](docs/agents.md) for the full agent system reference.

## Using Night-Shift from an LLM Agent

Night-shift is designed to be driven from the command line, which makes it straightforward to use from any LLM agent that can execute bash commands (including Claude Code itself).

### Installation

```bash
git clone https://github.com/julienderay/night-shift.git /path/to/night-shift
cd /path/to/night-shift && npm install && npm run build && npm link
nightshift init
```

After `npm link`, the `nightshift` binary is available on `PATH`.

### Agent management

```bash
nightshift agent init my-agent          # scaffold a new agent
nightshift agent validate my-agent      # check manifest + prompts + variables
nightshift agent list                   # show all agents with schedule info
nightshift agent list --json            # machine-readable output
nightshift agent show my-agent          # detailed agent info + recent runs
```

### Running agents

```bash
nightshift run --agent my-agent                      # foreground run
nightshift run --agent my-agent --var repo_url=...   # with variable overrides
nightshift submit --agent my-agent                   # queue for daemon
nightshift submit --agent my-agent "custom prompt"   # with prompt override
```

### Start / stop the daemon

```bash
nightshift start             # fork background daemon
nightshift stop              # graceful shutdown (drains active tasks)
nightshift stop --force      # immediate shutdown (SIGKILL)
```

### Checking status

```bash
nightshift status            # daemon state, active tasks, total executed
nightshift schedule          # list scheduled agents with next run times
```

### Reading results

```bash
nightshift inbox             # list recent reports (default: last 10)
nightshift inbox -n 5        # list last 5 reports
nightshift inbox --read <filename>  # display a specific report
```

Reports are markdown files in `.nightshift/inbox/` with YAML frontmatter containing task metadata (duration, status).

### Validating config

```bash
nightshift config validate   # check nightshift.yaml against the schema
nightshift config show       # print resolved config with defaults applied
```

### Complete workflow example

```bash
# One-time setup
git clone https://github.com/julienderay/night-shift.git ~/night-shift
cd ~/night-shift && npm install && npm run build && npm link
nightshift init

# Create and configure an agent
nightshift agent init code-review
# Edit agents/code-review/manifest.yaml and prompts as needed
nightshift agent validate code-review

# Start daemon and submit work
nightshift start
nightshift run --agent code-review     # test in foreground first
nightshift submit --agent code-review  # or queue for daemon

# Check progress
nightshift status

# Read results when done
nightshift inbox
nightshift inbox --read 2026-02-20_code-review_ns-a1b2c3d4.md

# Stop daemon
nightshift stop
```

### Key facts for LLM agents

- **All commands are non-interactive** -- no prompts, no confirmations, safe for scripted use.
- **The daemon must be running** for queued tasks to execute. Start it with `nightshift start` before submitting tasks.
- **Tasks execute asynchronously** -- `nightshift submit` queues the task and returns immediately. Poll `nightshift status` or `nightshift inbox` to check completion.
- **`nightshift run` is synchronous** -- runs the agent in the foreground and blocks until completion. Useful for testing.
- **Each bead spawns a `claude -p` process** with `--dangerously-skip-permissions`. Safety is enforced via `allowedTools` per bead in the manifest.
- **MCP servers are inherited** from the user's existing Claude CLI config -- no additional setup needed.
- **Results are markdown files** in `.nightshift/inbox/`, parseable via the YAML frontmatter.
- **Exit codes**: all commands exit `0` on success, non-zero on error.

## Architecture

```
User --- CLI (nightshift agent/run/submit/start/stop/...)
              |
              v
         Config (nightshift.yaml)  <-- agents[] + schedule[] + settings
              |
              v
         Daemon (background process)
           |-- Scheduler -- evaluates cron schedule entries, creates tasks
           |-- Orchestrator -- main poll loop: schedule > poll > dispatch > collect
           |     +-- NtfyClient -- fire-and-forget push notifications (start/end)
           |-- AgentPool -- manages concurrent agent runs
           |     +-- AgentEngine -- manifest-driven bead pipeline
           |           +-- BeadRegistry -- maps bead types to plugins
           |           +-- StandardBeadPlugin -- claude -p execution
           |           +-- GitCloneBeadPlugin -- repository cloning
           +-- Reporter -- generates markdown inbox reports from results
              |
              v
         Inbox (.nightshift/inbox/*.md) <-- user reads in the morning
```

**Pipeline execution** (per agent run):

1. Load manifest from `agents/<name>/manifest.yaml`
2. Resolve variables (built-ins > config overrides > manifest defaults)
3. Execute beads in order: render prompt template, invoke `claude -p`, validate JSON output against schema
4. On retry-configured beads: re-execute from the `retryFrom` bead on failure (up to `maxAttempts`)
5. Return `AgentRunResult` with per-bead outcomes and final output

**Poll loop** (runs every `daemon.poll_interval_ms`, default 30s):

1. Write heartbeat to `.nightshift/daemon.json`
2. Evaluate cron schedules -- create tasks for due agents (dedup via state)
3. Collect completed agent results -- write inbox reports -- close tasks
4. Poll for ready tasks (beads `bd ready` or file queue scan)
5. For each ready task (up to `max_concurrent - active`): claim and dispatch to agent pool

## Project Structure

```
night-shift/
+-- bin/nightshift.ts                  # CLI entry point
+-- agents/
|   +-- code-agent/                    # Built-in example agent
|       +-- manifest.yaml              # Pipeline definition (6 beads)
|       +-- prompts/                   # Bead prompt templates
+-- src/
|   +-- cli/
|   |   +-- index.ts                   # Commander program with all commands
|   |   +-- commands/
|   |   |   +-- init.ts                # nightshift init [--force]
|   |   |   +-- submit.ts             # nightshift submit --agent <name> [prompt]
|   |   |   +-- run.ts                # nightshift run --agent <name> [--var ...]
|   |   |   +-- agent.ts              # nightshift agent {init|validate|list|show}
|   |   |   +-- schedule.ts           # nightshift schedule
|   |   |   +-- status.ts             # nightshift status
|   |   |   +-- inbox.ts              # nightshift inbox [-n --read]
|   |   |   +-- start.ts              # nightshift start
|   |   |   +-- stop.ts               # nightshift stop [--force]
|   |   |   +-- config.ts             # nightshift config show|validate
|   |   +-- formatters.ts             # Table rendering, colored status, duration formatting
|   +-- daemon/
|   |   +-- index.ts                   # Daemon entry point + signal handlers
|   |   +-- orchestrator.ts           # Main poll loop
|   |   +-- scheduler.ts              # Cron evaluation + dedup state
|   |   +-- agent-pool.ts             # Concurrency limiter + dispatch
|   |   +-- health.ts                 # PID file, heartbeat, stale detection
|   +-- core/
|   |   +-- types.ts                   # All TypeScript interfaces
|   |   +-- config.ts                  # Zod schema + YAML loader + defaults
|   |   +-- paths.ts                   # .nightshift/ path resolution
|   |   +-- logger.ts                  # Structured JSON logger (file + stdout)
|   |   +-- errors.ts                  # NightShiftError, ManifestError, etc.
|   +-- agent/
|   |   +-- engine.ts                  # AgentEngine -- manifest-driven pipeline executor
|   |   +-- engine-types.ts           # AgentRunResult, BeadOutcome, PipelineStatus
|   |   +-- manifest-loader.ts        # loadManifest(), extractLastJsonBlock, validateBeadOutput
|   |   +-- manifest-schema.ts        # ManifestSchema, BeadSchema (Zod)
|   |   +-- manifest-types.ts         # LoadedManifest, ResolvedBead type definitions
|   |   +-- template.ts               # Template variable system (render, validate, builtins)
|   |   +-- bead-runner.ts            # Single bead execution (env isolation, tool restriction)
|   |   +-- bead-plugin.ts            # BeadPlugin interface
|   |   +-- bead-registry.ts          # BeadRegistry -- maps type strings to plugin factories
|   |   +-- scaffold.ts               # Agent scaffolding (nightshift agent init)
|   |   +-- agent-types.ts            # validateAgentName, agent type definitions
|   |   +-- plugins/
|   |   |   +-- standard-bead-plugin.ts    # claude -p execution
|   |   |   +-- git-clone-bead-plugin.ts   # Repository cloning
|   |   +-- prompt-loader.ts           # Template loader with injection mitigation
|   |   +-- git-harness.ts            # Git clone lifecycle with cleanup
|   |   +-- run-logger.ts             # JSONL run log appender
|   |   +-- temp-dir-manager.ts       # Temporary directory lifecycle
|   +-- beads/
|   |   +-- client.ts                  # Wrapper around bd CLI
|   |   +-- types.ts                   # BeadEntry types
|   |   +-- mapper.ts                  # NightShiftTask <-> bead mapping
|   +-- notifications/
|   |   +-- ntfy-client.ts            # Fire-and-forget Ntfy push notifications
|   +-- inbox/
|   |   +-- reporter.ts               # Markdown report generation with YAML frontmatter
|   +-- utils/
|       +-- process.ts                 # spawnWithTimeout, parseTimeout
|       +-- fs.ts                      # Atomic writes, JSON read/write
|       +-- template.ts               # Legacy {{date}}, {{name}} substitution
+-- tests/
|   +-- unit/                          # Config, manifest, template, engine, etc.
|   +-- integration/                   # CLI flow tests
+-- docs/
|   +-- agents.md                      # Full agent system reference
+-- nightshift.yaml                    # Created by `nightshift init`
+-- .nightshift/                       # Created by `nightshift init`
    +-- inbox/                         # Completed task reports (markdown)
    +-- queue/                         # File-based task queue (when beads disabled)
    +-- logs/                          # Daemon logs + agent run logs (JSONL)
    +-- daemon.json                    # Daemon heartbeat state
    +-- daemon.pid                     # Daemon PID file
    +-- scheduler.json                 # Scheduler dedup state (last run times)
```

## CLI Reference

### `nightshift init [--force]`

Creates `.nightshift/` directory structure and default `nightshift.yaml`. Use `--force` to overwrite an existing config.

### `nightshift agent init <name> [--force]`

Scaffolds a new agent directory under `agents/<name>/` with a starter `manifest.yaml` and prompt files. Registers the agent in `nightshift.yaml`. Use `--force` to overwrite an existing agent.

### `nightshift agent validate <name|path>`

Validates an agent's manifest, prompt files, template variables, and output schemas. Env var availability is checked as a warning (not a hard error). Accepts an agent name (resolves to `agents/<name>`) or a directory path.

### `nightshift agent list [--json]`

Shows all agents with bead count, schedule, and last run outcome. Includes both configured and unregistered agents. Use `--json` for machine-readable output.

### `nightshift agent show <name>`

Displays detailed agent information: manifest summary, bead pipeline, schedule, and recent runs.

### `nightshift run --agent <name> [--var key=value...] [-n name] [-N]`

Run an agent in the foreground. Variable overrides can be passed with `--var`. Use `-N`/`--notify` to send push notifications.

### `nightshift submit --agent <name> [prompt] [-t timeout] [-n name]`

Queue a task for the daemon to execute. The `--agent` flag is required. An optional prompt can be provided as a positional argument.

### `nightshift start`

Fork the daemon as a detached background process. Validates config and agent manifests before starting. Refuses to start if a daemon is already running.

### `nightshift stop [--force]`

Send SIGTERM to the daemon for graceful shutdown (drains active tasks). Use `--force` to send SIGKILL for immediate termination.

### `nightshift status`

Display daemon state (running/stopped, PID, uptime, heartbeat age, active tasks, total executed) and queue depth.

### `nightshift schedule`

Show all scheduled agents with their cron expression and next run time.

### `nightshift inbox [-n <count>] [--read <file>]`

List the most recent inbox reports (default 10). Use `--read <filename>` to display a specific report.

### `nightshift config show|validate`

- `show`: Print the resolved config (after defaults are applied) as YAML
- `validate`: Check that `nightshift.yaml` is valid against the schema

## Configuration

`nightshift.yaml` is created by `nightshift init`. All fields have defaults:

```yaml
workspace: ./workspace            # Working directory for agent file output
max_concurrent: 2                 # Max parallel agent runs
default_timeout: "30m"            # Default task timeout

beads:
  enabled: true                   # Use beads for task tracking (falls back to file queue)

daemon:
  poll_interval_ms: 30000         # How often the daemon checks for work
  heartbeat_interval_ms: 10000    # How often the daemon writes heartbeat state
  log_retention_days: 30          # Days to keep daemon log files

agents_dir: ./agents              # Path to agents directory

agents:
  - name: code-agent
    variables:
      repo_url: "git@gitlab.com:team/project.git"

schedule:
  - agent: code-agent
    cron: "0 2 * * 1-5"          # 2 AM on weekdays
    variables:
      category: "refactoring"
  - agent: code-agent
    cron: "0 2 * * 6"
    variables:
      category: "tests"

one_off_defaults:
  timeout: "30m"                  # Default timeout for submitted tasks
  max_budget_usd: 5.00            # Default budget for submitted tasks

# Push notifications (optional)
# ntfy:
#   topic: "https://ntfy.sh/my-nightshift"
#   token: "tk_..."
#   base_url: "https://ntfy.sh"
```

### Timeout Format

Durations accept: `ms` (milliseconds), `s` (seconds), `m` (minutes), `h` (hours).
Examples: `"30m"`, `"2h"`, `"90s"`, `"5000ms"`.

## Inbox Reports

Each completed task produces a markdown file in `.nightshift/inbox/`:

**Filename**: `{date}_{task-name}_{short-id}.md`

```markdown
---
task_id: ns-a3f2b1c4
task_name: code-agent-ns-a3f2b1c4
origin: scheduled
status: completed
started_at: 2026-02-20T02:00:05Z
completed_at: 2026-02-20T02:12:34Z
duration_seconds: 749
---

# code-agent-ns-a3f2b1c4

**Status**: Completed | **Duration**: 12m 29s

## Result

[Agent's output summary]

## Original Prompt

> Run the code improvement agent
```

The YAML frontmatter is machine-parseable (used by `nightshift inbox`). The body is human-readable.

## Beads Integration

When `beads.enabled: true` (default), tasks are tracked as beads via the `bd` CLI:

- All night-shift tasks carry the label `nightshift`
- One-off tasks: label `nightshift:one-off`
- Scheduled tasks: label `nightshift:scheduled:<agent-name>`
- Failed tasks: additional label `nightshift:failed`
- Atomic claiming via `bd update <id> --claim` prevents double-execution
- Task metadata (timeout, agent name) is encoded in the bead description

When `beads.enabled: false`, tasks are stored as JSON files in `.nightshift/queue/` and claimed by updating the file status. This fallback requires no external tools.

## Daemon Lifecycle

- **Start**: `nightshift start` forks the daemon via `child_process.fork({ detached: true })`
- **Health**: PID file at `.nightshift/daemon.pid`, heartbeat JSON at `.nightshift/daemon.json` updated every 10s
- **Stale detection**: a daemon with no heartbeat for 60s is considered dead
- **Stop**: `nightshift stop` sends SIGTERM -- daemon sets status to `stopping` -- drains active tasks -- writes final reports -- removes PID file -- exits
- **Force stop**: `nightshift stop --force` sends SIGKILL
- **Crash recovery**: on startup, the orchestrator checks for stale state and cleans up

## Development

```bash
npm run dev -- <command>       # run CLI via tsx (no build step)
npm run typecheck              # type check without emitting
npm test                       # run all tests (384 across 30 files)
npm run test:watch             # run tests in watch mode
npm run build                  # compile to dist/
```

### Tech Stack

| Dependency | Purpose |
|-----------|---------|
| `commander` + `@commander-js/extra-typings` | CLI framework with TypeScript inference |
| `croner` | Cron expression parsing and next-run evaluation |
| `yaml` | YAML config parsing and serialization |
| `zod` | Config and manifest schema validation |
| `chalk` | Terminal colors and formatting |
| `date-fns` | Date formatting for reports and templates |
| `vitest` | Test framework |
| `tsx` | TypeScript execution for development |

### Key Design Decisions

- **Manifest-driven pipelines**: agents are fully declarative YAML -- no code required to create a new agent.
- **Poll-based, not event-driven**: beads is a CLI tool, not a service. Polling at 30s intervals is the simplest reliable approach.
- **Spawn, not exec**: all child processes use `child_process.spawn` with argument arrays. No shell interpolation, no injection risk.
- **Atomic file writes**: reports and state files are written to a `.tmp` file first, then renamed. No partial reads.
- **Graceful shutdown**: SIGTERM triggers drain of active tasks. Reports are always written before exit.
- **No database**: beads handles persistence when available; otherwise plain JSON files. No setup required.
- **ESM throughout**: the project uses ES modules (`"type": "module"` in package.json, `.js` extensions in imports).

## What's Not Implemented Yet

- **Log rotation**: `log_retention_days` is defined in config but cleanup is not wired up
- **Crash recovery for in-progress tasks**: reopening in-progress beads on startup is not implemented in the orchestrator
- **`inbox` config field**: the top-level `inbox` field in config is unused; reports always go to `.nightshift/inbox/`
- **Task dependencies**: beads supports dependency graphs (`bd dep add`), but no CLI command exposes this
- **Per-task MCP config via CLI**: bead-level `mcpConfig` works in manifests, but there is no `--mcp-config` CLI flag on `nightshift submit` to override it at runtime
- **Hot-reload of config**: changes to `nightshift.yaml` require a daemon restart

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, conventions, and PR guidelines.

## License

[MIT](LICENSE)
