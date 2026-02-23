# Codebase Structure

**Analysis Date:** 2026-02-23

## Directory Layout

```
night-shift/
├── bin/
│   └── nightshift.ts                  # CLI entry point (shebang, calls program.parse())
│
├── src/
│   ├── cli/
│   │   ├── index.ts                   # Commander program setup + command registration
│   │   ├── commands/
│   │   │   ├── init.ts                # nightshift init [--force]
│   │   │   ├── submit.ts              # nightshift submit "<prompt>" [options]
│   │   │   ├── schedule.ts            # nightshift schedule
│   │   │   ├── status.ts              # nightshift status
│   │   │   ├── inbox.ts               # nightshift inbox [-n] [--read <file>]
│   │   │   ├── start.ts               # nightshift start
│   │   │   ├── stop.ts                # nightshift stop [--force]
│   │   │   └── config.ts              # nightshift config show|validate
│   │   └── formatters.ts              # Table rendering, colors, cost/duration formatting
│   │
│   ├── daemon/
│   │   ├── index.ts                   # Daemon entry point + signal handlers
│   │   ├── orchestrator.ts            # Main poll loop orchestrator
│   │   ├── scheduler.ts               # Cron evaluation + recurring task creation
│   │   ├── agent-pool.ts              # Concurrency limiter + task dispatch
│   │   ├── agent-runner.ts            # Single claude -p lifecycle manager
│   │   └── health.ts                  # PID/heartbeat/stale detection
│   │
│   ├── core/
│   │   ├── types.ts                   # NightShiftTask, NightShiftConfig, DaemonState, etc.
│   │   ├── config.ts                  # Zod schemas + YAML loader + defaults
│   │   ├── paths.ts                   # Path resolution for .nightshift/ structure
│   │   ├── logger.ts                  # Structured JSON logger with level filtering
│   │   └── errors.ts                  # Custom error hierarchy (NightShiftError base)
│   │
│   ├── beads/
│   │   ├── client.ts                  # Wrapper around bd CLI (spawn-based)
│   │   ├── types.ts                   # BeadEntry, CreateOptions, UpdateOptions
│   │   └── mapper.ts                  # Task ↔ Bead conversion functions
│   │
│   ├── inbox/
│   │   └── reporter.ts                # Markdown report generation + YAML frontmatter
│   │
│   └── utils/
│       ├── process.ts                 # spawnWithTimeout, parseTimeout
│       ├── fs.ts                      # atomicWrite, readJsonFile, writeJsonFile
│       └── template.ts                # {{variable}} substitution engine
│
├── tests/
│   ├── unit/
│   │   ├── config.test.ts             # Config loading/validation/defaults
│   │   ├── process.test.ts            # parseTimeout, spawnWithTimeout
│   │   ├── scheduler.test.ts          # Cron evaluation, dedup logic
│   │   ├── reporter.test.ts           # Report generation, frontmatter
│   │   ├── mapper.test.ts             # Task ↔ Bead mapping
│   │   ├── template.test.ts           # Template variable substitution
│   │   ├── health.test.ts             # PID files, stale detection
│   │   ├── agent-runner.test.ts       # Subprocess lifecycle, timeout
│   │   ├── agent-pool.test.ts         # Concurrency limits, dispatch
│   │   └── orchestrator.test.ts       # Poll loop, state transitions
│   │
│   └── integration/
│       └── cli.test.ts                # Full CLI init + config flow
│
├── nightshift.yaml                    # Config file (created by init)
├── .nightshift/                       # Runtime directory (created by init)
│   ├── inbox/                         # Completed task reports (.md with YAML frontmatter)
│   ├── queue/                         # File-based task queue (when beads disabled)
│   ├── logs/                          # Daemon logs (one file per day, JSON format)
│   ├── daemon.json                    # Daemon state (PID, status, heartbeat, counters)
│   ├── daemon.pid                     # PID file (single line with process ID)
│   └── scheduler.json                 # Scheduler state (last run times per recurring task)
│
├── dist/                              # TypeScript build output (not committed)
├── node_modules/                      # Dependencies (not committed)
├── package.json                       # Project metadata + dependencies
├── tsconfig.json                      # TypeScript compiler options
├── vitest.config.ts                   # Vitest test runner config
└── README.md                          # Project documentation
```

## Directory Purposes

**`bin/`:**
- Purpose: Executable entry points
- Contains: Single file with shebang for CLI invocation
- Key files: `bin/nightshift.ts`

**`src/cli/`:**
- Purpose: Command-line interface implementation
- Contains: Command definitions, formatters for output
- Key files: `index.ts` (registers commands), `commands/*.ts` (individual commands), `formatters.ts`

**`src/daemon/`:**
- Purpose: Background process that executes tasks autonomously
- Contains: Poll loop, scheduling, agent lifecycle management, health monitoring
- Key files: `index.ts` (entry), `orchestrator.ts` (main loop), `agent-pool.ts` (concurrency)

**`src/core/`:**
- Purpose: Shared infrastructure: types, configuration, logging, error handling
- Contains: Type definitions, config schema + loader, path resolution, logger, errors
- Key files: `types.ts`, `config.ts`, `logger.ts`

**`src/beads/`:**
- Purpose: Integration with external beads task tracking system (optional)
- Contains: CLI wrapper, type definitions, conversion functions
- Key files: `client.ts`, `mapper.ts`

**`src/inbox/`:**
- Purpose: Report generation for completed tasks
- Contains: Markdown generation with YAML frontmatter
- Key files: `reporter.ts`

**`src/utils/`:**
- Purpose: Reusable utility functions
- Contains: Process spawning with timeout, atomic file I/O, template rendering
- Key files: `process.ts`, `fs.ts`, `template.ts`

**`tests/`:**
- Purpose: Automated test suites
- Contains: Unit tests (config, process, logging, scheduling, execution), integration tests (CLI flows)
- Key files: Various .test.ts files organized by component

**`.nightshift/`:**
- Purpose: Runtime state and results directory (created by `nightshift init`)
- Contains: Task queue (if beads disabled), completed reports, logs, PID/state files
- Key files: `daemon.pid`, `daemon.json`, `scheduler.json`

## Key File Locations

**Entry Points:**
- CLI: `bin/nightshift.ts` - executes `program.parse()`
- Daemon: `src/daemon/index.ts` - creates Orchestrator and starts poll loop

**Configuration:**
- Schema + loader: `src/core/config.ts` - Zod schema with snake_case ↔ camelCase mapping
- Generated config: `nightshift.yaml` (in project root) - user-editable task and daemon settings
- Config validation: `src/cli/commands/config.ts` - exposes validate/show commands

**Core Logic:**
- Task types: `src/core/types.ts` - NightShiftTask, RecurringTaskConfig, DaemonState
- Daemon loop: `src/daemon/orchestrator.ts` - poll cycle, scheduling, dispatch, collection
- Process spawning: `src/utils/process.ts` - spawnWithTimeout with timeout enforcement
- Agent execution: `src/daemon/agent-runner.ts` - builds claude args, captures output, parses JSON

**Testing:**
- Config tests: `tests/unit/config.test.ts`
- Process tests: `tests/unit/process.test.ts`
- Scheduler tests: `tests/unit/scheduler.test.ts`
- CLI integration: `tests/integration/cli.test.ts`

## Naming Conventions

**Files:**
- Daemon/module files: `{component}.ts` (e.g., `scheduler.ts`, `health.ts`)
- Test files: `{component}.test.ts` (e.g., `config.test.ts`)
- Commands: `{command-name}.ts` in `src/cli/commands/` (e.g., `submit.ts`, `status.ts`)

**Directories:**
- Features grouped by layer: `cli/`, `daemon/`, `core/`, `beads/`, `inbox/`, `utils/`
- Commands in subdirectory: `cli/commands/`
- Tests parallel source structure: `tests/unit/`, `tests/integration/`

**Functions:**
- Command handlers: Suffixed with "Command" (e.g., `submitCommand`, `initCommand`)
- Public exports: Lowercase with hyphens in variable names (e.g., `parseTimeout`, `spawnWithTimeout`)
- Internal helpers: Private or prefixed with underscore if following single-letter conventions

**Variables:**
- Task-related: `task`, `taskId`, `taskName`, `taskResult`
- Process-related: `child`, `process`, `result`, `exitCode`, `stdout`, `stderr`
- Config-related: `config`, `configPath`, `defaults`
- State-related: `state`, `lastHeartbeat`, `activeTasks`

**Types:**
- Interfaces: PascalCase (e.g., `NightShiftTask`, `AgentRunnerOptions`, `DaemonState`)
- Type aliases: PascalCase (e.g., `TaskOrigin`, `TaskStatus`, `LogLevel`)
- Enums: Avoided in favor of literal types (e.g., `type TaskStatus = "pending" | "ready"`)

## Where to Add New Code

**New Feature (e.g., task priority, retries):**
- Primary code: `src/daemon/orchestrator.ts` (poll loop) + `src/core/types.ts` (add to NightShiftTask)
- Tests: `tests/unit/orchestrator.test.ts`
- Config: `src/core/config.ts` (add to schema if user-configurable)

**New Command (e.g., `nightshift kill <task-id>`):**
- Implementation: Create `src/cli/commands/kill.ts` following pattern of existing commands
- Registration: Add import + `program.addCommand(killCommand)` in `src/cli/index.ts`
- Tests: Add to `tests/integration/cli.test.ts` for end-to-end flow

**New Component/Module:**
- Implementation: Create directory under `src/` (e.g., `src/metrics/`) with `index.ts` or component file
- Dependencies: Import only from `core/`, `utils/`, or other components (respect layer boundaries)
- Tests: Create parallel `tests/unit/{component}.test.ts` file

**Utilities:**
- Shared helpers: `src/utils/` (process, fs, template patterns already established)
- Core abstractions: `src/core/` if used across layers (types, config, paths, logger)
- Component-specific: Keep in component directory if only used there

**Tests:**
- Unit tests: Focus on individual functions with mocked dependencies
- Integration tests: Test command-line flows end-to-end
- Patterns: Use vitest, chai assertions, mock spawn for subprocess tests
- Location: `tests/unit/` or `tests/integration/` mirroring src structure

## Special Directories

**`.nightshift/`:**
- Purpose: Runtime state and results
- Generated: Yes, created by `nightshift init` or dynamically at runtime
- Committed: No, listed in `.gitignore`
- Subdirectories:
  - `inbox/`: Markdown reports with YAML frontmatter (user reads these)
  - `queue/`: JSON task files (only used if beads disabled)
  - `logs/`: Daemon JSON logs (one file per day, not rotated yet)
  - Root files: `daemon.pid` (process ID), `daemon.json` (heartbeat state), `scheduler.json` (cron dedup)

**`dist/`:**
- Purpose: TypeScript build output
- Generated: Yes, created by `npm run build` (tsc)
- Committed: No, .gitignore excludes
- Contents: JavaScript + source maps + declaration files

**`tests/`:**
- Purpose: Test suites
- Generated: No, manually maintained
- Committed: Yes, part of repository
- Structure: Unit tests in `unit/`, integration tests in `integration/`

---

*Structure analysis: 2026-02-23*
