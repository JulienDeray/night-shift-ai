# Night-Shift

[![CI](https://github.com/julienderay/night-shift/.github/workflows/ci.yml/badge.svg)](https://github.com/julienderay/night-shift/.github/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

Local-first framework for queuing tasks to be executed autonomously by AI agents during off-hours.

## Why

Night-shift turns day to day tasks into fire-and-forget jobs that execute while you sleep.

The system is **local-first** by design. No cloud infrastructure, no servers, no accounts. A background daemon on your machine polls for ready tasks, spawns `claude -p` processes with your existing MCP server connections (Jira, Confluence, filesystem, etc.), and writes results as markdown files you can read in the morning.

Night-shift requires the [Claude CLI](https://claude.ai/download) — all agent execution goes through `claude -p`.

Task tracking uses [beads](https://github.com/steveyegge/beads) for dependency graphs and atomic claiming, but falls back to a simple file-based queue when beads is unavailable.

## Prerequisites

- **Node.js >= 20**
- **[Claude CLI](https://claude.ai/download)** — the agent runtime (`claude -p`)
- **[beads](https://github.com/steveyegge/beads)** (optional) — enables dependency graphs and atomic task claiming; falls back to a file-based queue without it

## Quick Start

```bash
# Install from source
git clone https://github.com/julienderay/night-shift.git
cd night-shift
npm install
npm run build
npm link                     # registers the `nightshift` binary on your PATH

# Initialize
nightshift init              # creates .nightshift/ and nightshift.yaml

# Submit a one-off task
nightshift submit "Summarize the latest MRs in our repo"

# Start the daemon (runs in background)
nightshift start

# Check on things
nightshift status            # daemon state + queue depth
nightshift inbox             # browse completed reports

# Stop when done
nightshift stop
```

Edit `nightshift.yaml` to configure recurring tasks, budgets, timeouts, and tool restrictions.

## Using Night-Shift from an LLM Agent

Night-shift is designed to be driven from the command line, which makes it straightforward to use from any LLM agent that can execute bash commands (including Claude Code itself).

### Installation

```bash
git clone https://github.com/julienderay/night-shift.git /path/to/night-shift
cd /path/to/night-shift && npm install && npm run build && npm link
nightshift init
```

After `npm link`, the `nightshift` binary is available on `PATH`.

### Submitting tasks

```bash
# Basic task
nightshift submit "Review the open MRs in the repo and summarize findings"

# With options
nightshift submit "Prepare standup notes from Jira" \
  --timeout 15m \
  --budget 2.00 \
  --model sonnet \
  --name "standup-prep" \
  --tools "mcp__jira__*" "Read"
```

The command returns immediately. The daemon picks up the task on its next poll cycle.

### Start / stop the daemon

```bash
nightshift start             # fork background daemon
nightshift stop              # graceful shutdown (drains active tasks)
nightshift stop --force      # immediate shutdown (SIGKILL)
```

### Checking status

```bash
nightshift status            # daemon state, active tasks, total executed, cost
nightshift schedule          # list recurring tasks with next run times
```

### Reading results

```bash
nightshift inbox             # list recent reports (default: last 10)
nightshift inbox -n 5        # list last 5 reports
nightshift inbox --read <filename>  # display a specific report
```

Reports are markdown files in `.nightshift/inbox/` with YAML frontmatter containing task metadata (cost, duration, status).

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

# Start daemon
nightshift start

# Submit work
nightshift submit "Audit the codebase for TODO comments and categorize them" --timeout 20m --budget 3.00

# Check progress
nightshift status

# Read results when done
nightshift inbox
nightshift inbox --read 2026-02-20_audit-todos_ns-a1b2c3d4.md

# Stop daemon
nightshift stop
```

### Key facts for LLM agents

- **All commands are non-interactive** — no prompts, no confirmations, safe for scripted use.
- **The daemon must be running** for tasks to execute. Start it with `nightshift start` before submitting tasks.
- **Tasks execute asynchronously** — `nightshift submit` queues the task and returns immediately. Poll `nightshift status` or `nightshift inbox` to check completion.
- **Each task spawns a `claude -p` process** with `--dangerously-skip-permissions`. Safety is enforced via `--allowedTools` per task.
- **MCP servers are inherited** from the user's existing Claude CLI config — no additional setup needed.
- **Results are markdown files** in `.nightshift/inbox/`, parseable via the YAML frontmatter.
- **Exit codes**: all commands exit `0` on success, non-zero on error.

## Architecture

```
User ──► CLI (nightshift submit/schedule/inbox/...)
              │
              ▼
         Config (nightshift.yaml)  ◄── recurring tasks + settings
              │
              ▼
         Daemon (background process)
           ├── Scheduler ── evaluates cron → creates tasks for due recurring jobs
           ├── Orchestrator ── main poll loop: schedule → poll → dispatch → collect
           ├── AgentPool ── manages concurrent claude -p processes
           │     └── AgentRunner ── single claude -p lifecycle (spawn, timeout, collect)
           └── Reporter ── generates markdown inbox reports from results
              │
              ▼
         Inbox (.nightshift/inbox/*.md) ◄── user reads in the morning
```

**Poll loop** (runs every `daemon.poll_interval_ms`, default 30s):

1. Write heartbeat to `.nightshift/daemon.json`
2. Evaluate cron schedules → create tasks for due recurring jobs (dedup via state)
3. Collect completed agent results → write inbox reports → close tasks
4. Poll for ready tasks (beads `bd ready` or file queue scan)
5. For each ready task (up to `max_concurrent - active`): claim → dispatch to agent pool

**Agent execution**: each task spawns `claude -p` with JSON output, budget caps, tool restrictions, and a timeout. The agent inherits your MCP config automatically.

## Project Structure

```
night-shift/
├── bin/nightshift.ts                  # CLI entry point
├── src/
│   ├── cli/
│   │   ├── index.ts                   # Commander program with all commands
│   │   ├── commands/
│   │   │   ├── init.ts                # nightshift init [--force]
│   │   │   ├── submit.ts             # nightshift submit "<prompt>" [-t -b -m -n --tools]
│   │   │   ├── schedule.ts           # nightshift schedule
│   │   │   ├── status.ts             # nightshift status
│   │   │   ├── inbox.ts              # nightshift inbox [-n --read]
│   │   │   ├── start.ts              # nightshift start
│   │   │   ├── stop.ts               # nightshift stop [--force]
│   │   │   └── config.ts             # nightshift config show|validate
│   │   └── formatters.ts             # Table rendering, colored status, cost/duration formatting
│   ├── daemon/
│   │   ├── index.ts                   # Daemon entry point + signal handlers
│   │   ├── orchestrator.ts           # Main poll loop
│   │   ├── scheduler.ts              # Cron evaluation + dedup state
│   │   ├── agent-pool.ts             # Concurrency limiter
│   │   ├── agent-runner.ts           # Single claude -p lifecycle
│   │   └── health.ts                 # PID file, heartbeat, stale detection
│   ├── core/
│   │   ├── types.ts                   # All TypeScript interfaces
│   │   ├── config.ts                  # Zod schema + YAML loader + defaults
│   │   ├── paths.ts                   # .nightshift/ path resolution
│   │   ├── logger.ts                  # Structured JSON logger (file + stdout)
│   │   └── errors.ts                  # NightShiftError, ConfigError, DaemonError, etc.
│   ├── beads/
│   │   ├── client.ts                  # Wrapper around bd CLI (spawn-based, no shell)
│   │   ├── types.ts                   # BeadEntry, create/update options
│   │   └── mapper.ts                 # NightShiftTask ↔ bead mapping
│   ├── inbox/
│   │   └── reporter.ts               # Markdown report generation with YAML frontmatter
│   └── utils/
│       ├── process.ts                 # spawnWithTimeout, parseTimeout
│       ├── fs.ts                      # Atomic writes, JSON read/write
│       └── template.ts               # {{date}}, {{name}} substitution
├── tests/
│   ├── unit/                          # config, process, template, reporter, mapper, scheduler, health
│   └── integration/                   # CLI init + config flow
├── nightshift.yaml                    # Created by `nightshift init`
└── .nightshift/                       # Created by `nightshift init`
    ├── inbox/                         # Completed task reports (markdown)
    ├── queue/                         # File-based task queue (when beads disabled)
    ├── logs/                          # Daemon logs (JSON, one file per day)
    ├── daemon.json                    # Daemon heartbeat state
    ├── daemon.pid                     # Daemon PID file
    └── scheduler.json                 # Scheduler dedup state (last run times)
```

## CLI Reference

### `nightshift init [--force]`

Creates `.nightshift/` directory structure and default `nightshift.yaml`. Use `--force` to overwrite an existing config.

### `nightshift submit <prompt> [options]`

Queue a one-off task for the daemon to execute.

| Flag | Description |
|------|-------------|
| `-t, --timeout <timeout>` | Task timeout (e.g. `30m`, `1h`) |
| `-b, --budget <usd>` | Max budget in USD |
| `-m, --model <model>` | Model to use (`sonnet`, `opus`) |
| `-n, --name <name>` | Task name (auto-generated if omitted) |
| `--tools <tools...>` | Allowed tools for the agent |

### `nightshift start`

Fork the daemon as a detached background process. Validates config before starting. Refuses to start if a daemon is already running.

### `nightshift stop [--force]`

Send SIGTERM to the daemon for graceful shutdown (drains active tasks). Use `--force` to send SIGKILL for immediate termination.

### `nightshift status`

Display daemon state (running/stopped, PID, uptime, heartbeat age, active tasks, total executed, total cost) and queue depth.

### `nightshift schedule`

Show all recurring tasks from config with their cron schedule, next run time, timeout, and budget.

### `nightshift inbox [-n <count>] [--read <file>]`

List the most recent inbox reports (default 10). Use `--read <filename>` to display a specific report.

### `nightshift config show|validate`

- `show`: Print the resolved config (after defaults are applied) as YAML
- `validate`: Check that `nightshift.yaml` is valid against the schema

## Configuration

`nightshift.yaml` is created by `nightshift init`. All fields have defaults:

```yaml
workspace: ./workspace            # Working directory for agent file output
inbox: ./inbox                    # (unused, reports go to .nightshift/inbox/)
max_concurrent: 2                 # Max parallel claude -p processes
default_timeout: "30m"            # Default task timeout

beads:
  enabled: true                   # Use beads for task tracking (falls back to file queue)

daemon:
  poll_interval_ms: 30000         # How often the daemon checks for work
  heartbeat_interval_ms: 10000    # How often the daemon writes heartbeat state
  log_retention_days: 30          # Days to keep daemon log files

recurring:                        # Recurring tasks evaluated by cron schedule
  - name: "daily-standup-prep"
    schedule: "0 6 * * 1-5"      # Cron expression (croner syntax)
    prompt: |
      Check Jira for my team's recent updates and prepare
      standup notes for today's meeting.
    allowed_tools:                # Tool restrictions for this task
      - "mcp__jira__*"
      - "Read"
      - "Write"
    output: "inbox/standup-prep-{{date}}.md"   # Optional custom output path
    timeout: "15m"                # Override default timeout
    max_budget_usd: 2.00          # Cost cap for this task
    # model: "sonnet"             # Optional model override
    # mcp_config: "./custom.json" # Optional per-task MCP config

one_off_defaults:
  timeout: "30m"                  # Default timeout for submitted tasks
  max_budget_usd: 5.00            # Default budget for submitted tasks
  # model: "sonnet"               # Default model for submitted tasks
```

### Timeout Format

Durations accept: `ms` (milliseconds), `s` (seconds), `m` (minutes), `h` (hours).
Examples: `"30m"`, `"2h"`, `"90s"`, `"5000ms"`.

### Template Variables

Output paths support `{{variable}}` substitution:

| Variable     | Example          |
|-------------|------------------|
| `{{date}}`  | `2026-02-19`     |
| `{{datetime}}` | `2026-02-19_03-00-05` |
| `{{time}}`  | `03-00-05`       |
| `{{year}}`  | `2026`           |
| `{{month}}` | `02`             |
| `{{day}}`   | `19`             |
| `{{name}}`  | task name        |

## Agent Execution

Each task runs as a spawned child process:

```bash
claude -p "<prompt>" \
  --output-format json \
  --dangerously-skip-permissions \
  --no-session-persistence \
  --allowedTools "Tool1" "Tool2" \
  --max-budget-usd 5.00 \
  --model sonnet \
  --append-system-prompt "You are executing a night-shift task autonomously. ..."
```

- `--dangerously-skip-permissions`: required for non-interactive execution. Safety comes from `--allowedTools` per task.
- `--output-format json`: structured output with `session_id`, `duration_ms`, `total_cost_usd`, `result`, `is_error`, `num_turns`.
- `--no-session-persistence`: automated runs don't pollute the user's session history.
- MCP servers are inherited from the user's existing Claude Code config.

## Inbox Reports

Each completed task produces a markdown file in `.nightshift/inbox/`:

**Filename**: `{date}_{task-name}_{short-id}.md`

```markdown
---
task_id: ns-a3f2b1c4
task_name: daily-standup-prep
origin: recurring
status: completed
started_at: 2026-02-20T03:00:05Z
completed_at: 2026-02-20T03:02:34Z
duration_seconds: 149
cost_usd: 0.42
num_turns: 8
---

# daily-standup-prep

**Status**: Completed | **Duration**: 2m 29s | **Cost**: $0.42

## Result

[Agent's output summary]

## Original Prompt

> Check Jira for my team's recent updates...
```

The YAML frontmatter is machine-parseable (used by `nightshift inbox`). The body is human-readable.

## Beads Integration

When `beads.enabled: true` (default), tasks are tracked as beads via the `bd` CLI:

- All night-shift tasks carry the label `nightshift`
- One-off tasks: label `nightshift:one-off`
- Recurring tasks: label `nightshift:recurring:<name>`
- Failed tasks: additional label `nightshift:failed`
- Atomic claiming via `bd update <id> --claim` prevents double-execution
- Task metadata (timeout, budget, tools, prompt) is encoded in the bead description

When `beads.enabled: false`, tasks are stored as JSON files in `.nightshift/queue/` and claimed by updating the file status. This fallback requires no external tools.

## Daemon Lifecycle

- **Start**: `nightshift start` forks the daemon via `child_process.fork({ detached: true })`
- **Health**: PID file at `.nightshift/daemon.pid`, heartbeat JSON at `.nightshift/daemon.json` updated every 10s
- **Stale detection**: a daemon with no heartbeat for 60s is considered dead
- **Stop**: `nightshift stop` sends SIGTERM → daemon sets status to `stopping` → drains active tasks → writes final reports → removes PID file → exits
- **Force stop**: `nightshift stop --force` sends SIGKILL
- **Crash recovery**: on startup, the orchestrator checks for stale state and cleans up

## Development

```bash
npm run dev -- <command>       # run CLI via tsx (no build step)
npm run typecheck              # type check without emitting
npm test                       # run all tests
npm run test:watch             # run tests in watch mode
npm run build                  # compile to dist/
```

### Tech Stack

| Dependency | Purpose |
|-----------|---------|
| `commander` + `@commander-js/extra-typings` | CLI framework with TypeScript inference |
| `croner` | Cron expression parsing and next-run evaluation |
| `yaml` | YAML config parsing and serialization |
| `zod` | Config schema validation with defaults |
| `chalk` | Terminal colors and formatting |
| `date-fns` | Date formatting for reports and templates |
| `vitest` | Test framework |
| `tsx` | TypeScript execution for development |

### Tests

134 tests across 15 test files:

- **Unit**: config loading/validation, timeout parsing, process spawning, template rendering, report generation, beads mapper, scheduler cron evaluation, daemon health checks
- **Integration**: full CLI flow for `init`, `config validate`, `config show`

### Key Design Decisions

- **Poll-based, not event-driven**: beads is a CLI tool, not a service. Polling at 30s intervals is the simplest reliable approach.
- **Spawn, not exec**: all child processes use `child_process.spawn` with argument arrays. No shell interpolation, no injection risk.
- **Atomic file writes**: reports and state files are written to a `.tmp` file first, then renamed. No partial reads.
- **Graceful shutdown**: SIGTERM triggers drain of active tasks. Reports are always written before exit.
- **No database**: beads handles persistence when available; otherwise plain JSON files. No setup required.
- **ESM throughout**: the project uses ES modules (`"type": "module"` in package.json, `.js` extensions in imports).

## What's Not Implemented Yet

- **Log rotation**: `log_retention_days` is defined in config but cleanup is not wired up
- **Crash recovery for in-progress tasks**: the plan mentions reopening in-progress beads on startup, but this isn't implemented in the orchestrator
- **`inbox` config field**: the top-level `inbox` field in config is unused; reports always go to `.nightshift/inbox/`
- **Task dependencies**: beads supports dependency graphs (`bd dep add`), but no CLI command exposes this
- **Per-task MCP config**: the `mcp_config` field is plumbed through types and agent-runner args, but no CLI flag for `submit`
- **Model flag in recurring tasks**: plumbed through but not exposed in schedule display

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, conventions, and PR guidelines.

## License

[MIT](LICENSE)
