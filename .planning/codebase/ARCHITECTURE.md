# Architecture

**Analysis Date:** 2026-02-23

## Pattern Overview

**Overall:** Event-driven poll-based daemon architecture with process isolation

**Key Characteristics:**
- CLI front-end for task submission and status monitoring (Commander-based)
- Long-running daemon that executes a poll loop to discover and dispatch work
- Agent pool manages concurrent `claude -p` processes with resource limits
- Beads integration for persistent task tracking with fallback to file-based queue
- Report generation with YAML frontmatter for machine-readable metadata
- ESM throughout with no external database dependencies

## Layers

**CLI Layer:**
- Purpose: Command-line interface for user interaction with the system
- Location: `src/cli/`
- Contains: Command definitions (submit, start, stop, status, inbox, schedule, init, config)
- Depends on: Core config/paths/errors, daemon health, formatters
- Used by: Users submitting tasks, checking status, reading results

**Daemon Layer:**
- Purpose: Main event loop that orchestrates task scheduling, dispatching, and result collection
- Location: `src/daemon/`
- Contains: Orchestrator (poll loop coordinator), Scheduler (cron evaluation), AgentPool (concurrency management), AgentRunner (subprocess lifecycle), Health (process monitoring)
- Depends on: Core types/config/paths/logger, beads client, inbox reporter, utils
- Used by: Started as background process via `nightshift start`

**Beads Integration Layer:**
- Purpose: Interface with external beads CLI for persistent task tracking (optional)
- Location: `src/beads/`
- Contains: BeadsClient (spawns `bd` commands), BeadEntry types, mapping functions (task ↔ bead conversion)
- Depends on: Core types, utils/process
- Used by: Orchestrator for task persistence; falls back to file queue if disabled

**Core Infrastructure Layer:**
- Purpose: Shared types, configuration, path resolution, logging, error handling
- Location: `src/core/`
- Contains: Types (NightShiftTask, NightShiftConfig, DaemonState), Config loader with Zod schema, Paths resolver, Logger with JSON output, Error hierarchy
- Depends on: yaml, zod libraries
- Used by: All other layers

**Inbox/Reporting Layer:**
- Purpose: Generate markdown reports with YAML frontmatter for completed tasks
- Location: `src/inbox/`
- Contains: Reporter (generates YAML frontmatter + markdown body, handles custom output paths)
- Depends on: Core types/paths, utils/fs, date-fns for formatting
- Used by: Orchestrator after task completion

**Utilities Layer:**
- Purpose: Low-level helpers for process spawning, file I/O, template rendering
- Location: `src/utils/`
- Contains: Process utilities (spawn with timeout), filesystem utils (atomic writes), template engine (variable substitution)
- Depends on: Core errors
- Used by: AgentRunner, reporter, config loader, scheduler

## Data Flow

**Task Submission Flow:**

1. User runs `nightshift submit "<prompt>" [options]`
2. CLI loads config, generates task ID (`ns-{hex}`)
3. If beads enabled: creates bead via `bd create` with task metadata in description
4. If beads disabled: writes task JSON to `.nightshift/queue/{id}.json`
5. CLI returns immediately with task ID

**Daemon Poll Loop (runs every 30s by default):**

1. Write heartbeat to `.nightshift/daemon.json`
2. Scheduler evaluates cron expressions for recurring tasks
   - Checks `scheduler.json` for last run times
   - Creates new tasks for due recurring jobs
   - Stores task in beads or file queue
3. Collect completed task results
   - Poll for finished processes in agent pool
   - Generate markdown report with YAML frontmatter
   - Store in `.nightshift/inbox/` and optional custom output path
   - Update beads status or file queue status
4. Poll for ready tasks
   - If beads enabled: run `bd ready --labels nightshift`
   - If beads disabled: scan `.nightshift/queue/` for pending tasks
   - Map bead/file to NightShiftTask type
5. For each ready task (up to available slots in pool)
   - Claim task atomically (beads: `bd update --claim`; file: update status)
   - Dispatch to agent pool

**Agent Execution Flow:**

1. AgentPool.dispatch() creates new AgentRunner instance
2. AgentRunner builds CLI args for `claude -p`:
   - Prompt from task
   - JSON output format
   - Tool restrictions (--allowedTools)
   - Budget cap (--max-budget-usd)
   - Model override if specified
   - System prompt with task context
   - Working directory set to config workspace
3. spawnWithTimeout spawns child process with timeout monitoring
4. Collect stdout/stderr in buffers
5. On completion or timeout: parse JSON output from Claude
6. Return AgentExecutionResult with cost, duration, result text
7. Mark task complete in pool; add to completedQueue

**Result Collection and Report Writing:**

1. Orchestrator drains completedQueue from pool
2. For each TaskResult:
   - generateReport() creates markdown with YAML frontmatter
   - Atomic write to `.nightshift/inbox/{date}_{name}_{id}.md`
   - If task has custom `output` path: render template variables and write there
   - Update beads status to "closed" or file queue status to "completed"
   - Increment daemon state counters (totalExecuted, totalCostUsd)

**State Management:**

- **Daemon State** (`daemon.json`): PID, status (running/stopping/stopped), heartbeat time, active task count, cost tracking
- **Scheduler State** (`scheduler.json`): Last run times per recurring task for dedup
- **PID File** (`daemon.pid`): Contains daemon process ID for alive-check
- **Task State**: In beads (status + labels), in file queue (JSON status field), or in pool memory during execution

## Key Abstractions

**NightShiftTask:**
- Purpose: Unified task representation across submission, scheduling, execution, and reporting
- Examples: `src/core/types.ts` (interface), used throughout daemon, CLI, beads mapper
- Pattern: Contains id, name, prompt, timeout, budget, allowed tools, origin (one-off/recurring), status (pending/ready/running/completed/failed/timed-out)

**BeadsClient:**
- Purpose: Abstract the beads CLI into a stateless client with spawn-based calls
- Examples: `src/beads/client.ts`
- Pattern: Each operation (create, update, ready, get) spawns a new `bd` command with no persistent connection

**AgentRunner:**
- Purpose: Encapsulate single `claude -p` subprocess lifecycle
- Examples: `src/daemon/agent-runner.ts`
- Pattern: Builds arguments, spawns, monitors timeout, collects output, parses JSON

**Scheduler:**
- Purpose: Evaluate cron schedules and create recurring tasks
- Examples: `src/daemon/scheduler.ts`
- Pattern: Loads state, evaluates cron via croner library, dedup via lastRuns map, creates task via beads/file

**AgentPool:**
- Purpose: Manage concurrent task execution with configurable limit
- Examples: `src/daemon/agent-pool.ts`
- Pattern: Track running tasks in Map, completedQueue for drain, query activeCount/availableSlots

**Logger:**
- Purpose: Structured JSON logging with level filtering and dual output (file + stdout)
- Examples: `src/core/logger.ts`
- Pattern: Async append-based file writing, silent by default in daemon, verbose in CLI when --verbose

**Config:**
- Purpose: Load and validate nightshift.yaml with Zod schema + defaults
- Examples: `src/core/config.ts`
- Pattern: Snake_case YAML → camelCase TypeScript, recurse to map RecurringTaskConfig array

## Entry Points

**CLI Entry Point:**
- Location: `bin/nightshift.ts`
- Triggers: User runs `nightshift <command>`
- Responsibilities: Parses command-line arguments via Commander and dispatches to subcommand

**Daemon Entry Point:**
- Location: `src/daemon/index.ts`
- Triggers: Forked by `nightshift start` command (via child_process.spawn with detached: true)
- Responsibilities: Creates Orchestrator, sets up signal handlers (SIGTERM/SIGINT for graceful shutdown, uncaught exception/rejection handlers), calls orchestrator.start()

**Command Modules:**
- `src/cli/commands/init.ts`: Create `.nightshift/` dirs and default config
- `src/cli/commands/submit.ts`: Queue one-off task in beads or file queue
- `src/cli/commands/start.ts`: Fork daemon process
- `src/cli/commands/stop.ts`: Send SIGTERM or SIGKILL to daemon
- `src/cli/commands/status.ts`: Read daemon.json and display state
- `src/cli/commands/inbox.ts`: List and display markdown reports
- `src/cli/commands/schedule.ts`: Show recurring tasks with next-run times
- `src/cli/commands/config.ts`: Show resolved config or validate against schema

## Error Handling

**Strategy:** Hierarchical error types extending NightShiftError base class

**Patterns:**

- **ConfigError**: Thrown by config loader when yaml invalid or schema fails (Zod validation)
- **DaemonError**: Thrown by daemon/orchestrator for lifecycle issues
- **BeadsError**: Thrown by BeadsClient when `bd` command fails
- **AgentExecutionError**: Thrown by AgentRunner when claude process fails (non-zero exit or invalid JSON)
- **TimeoutError**: Thrown by spawnWithTimeout when task exceeds timeout
- **NightShiftError**: Base class for all custom errors

Error handling in daemon: uncaughtException and unhandledRejection handlers log and gracefully shut down. CLI commands wrap actions in try-catch and exit with code 1 on error. Orchestrator.stop() is always awaited even on error to ensure cleanup.

## Cross-Cutting Concerns

**Logging:** Structured JSON to `.nightshift/logs/daemon-{date}.log` (daemon) and stdout (CLI). Logger configured per context (daemon logger created with debug level and file output; CLI logger with info/debug depending on --verbose). No log rotation wired up yet.

**Validation:** Zod schema for config (with custom parsing of timeout strings, model names, array mappings). RecurringTaskConfig and NightShiftConfig schemas define required vs optional fields and provide defaults. Config validation exposed via `nightshift config validate`.

**Authentication:** Inherited from user's Claude CLI config (MCP servers in user's config are passed to `claude -p` via environment). No additional credentials stored by night-shift.

**Resource Limits:** AgentPool enforces maxConcurrent limit (default 2). Individual tasks have timeout (default 30m, overridable) and budget cap (optional, passed to claude --max-budget-usd). Scheduler prevents duplicate recurring task creation via lastRuns dedup state.

**Atomic Operations:** File writes use atomic pattern (write to .tmp, rename to final path) in atomicWrite(). Beads claiming via `bd update --claim` is atomic by beads CLI. Task status updates (beads close, file queue status field) prevent double-execution.

---

*Architecture analysis: 2026-02-23*
