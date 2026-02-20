# Night-Shift User Stories & Acceptance Criteria

This document captures every user story inferred from the codebase, along with acceptance criteria and their test coverage status.

---

## US-1: Initialize project

**As a** user, **I want to** initialize night-shift in my project directory **so that** I can start queuing tasks.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 1.1 | `nightshift init` creates `.nightshift/` with `inbox/`, `queue/`, `logs/` subdirectories | `integration/init-and-config.test.ts` - "creates directory structure and config" |
| 1.2 | `nightshift init` creates `nightshift.yaml` with sensible defaults | `integration/init-and-config.test.ts` - "creates directory structure and config" |
| 1.3 | `nightshift init` creates `./workspace/` directory | `integration/init-and-config.test.ts` - "creates directory structure and config" |
| 1.4 | `nightshift init` refuses to overwrite existing config without `--force` | `integration/init-and-config.test.ts` - "refuses to overwrite without --force" |
| 1.5 | `nightshift init --force` overwrites existing config with fresh defaults | `integration/init-and-config.test.ts` - "--force overwrites existing config" |
| 1.6 | `nightshift init` prints next steps guidance | `integration/init-and-config.test.ts` - "prints next steps guidance" |

---

## US-2: Configure the system

**As a** user, **I want to** configure night-shift via a YAML file **so that** I can customize behavior to my needs.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 2.1 | Config loads and applies default values for all optional fields | `unit/config.test.ts` - "loads default config from YAML" + "applies defaults" |
| 2.2 | Config supports recurring task definitions with name, schedule, prompt, tools, timeout, budget | `unit/config.test.ts` - "loads config with recurring tasks" |
| 2.3 | Missing config file produces a clear error | `unit/config.test.ts` - "throws on missing config file" |
| 2.4 | Invalid YAML syntax produces a clear error | `unit/config.test.ts` - "throws on invalid YAML" |
| 2.5 | Invalid config values (e.g. negative maxConcurrent) produce a clear error | `unit/config.test.ts` - "throws on invalid config values" |
| 2.6 | `nightshift config validate` reports valid config | `integration/init-and-config.test.ts` - "validate succeeds on valid config" |
| 2.7 | `nightshift config validate` reports invalid config with non-zero exit code | `integration/init-and-config.test.ts` - "validate fails on invalid config" |
| 2.8 | `nightshift config show` displays resolved config in YAML | `integration/init-and-config.test.ts` - "config show displays resolved config" |

---

## US-3: Submit a one-off task

**As a** user, **I want to** submit a one-off task via the CLI **so that** it gets queued for the daemon to execute.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 3.1 | `nightshift submit "<prompt>"` creates a task file in the queue | `integration/submit.test.ts` - "creates a task file in the queue directory" |
| 3.2 | Task gets a unique ID matching `ns-[0-9a-f]{8}` | `integration/submit.test.ts` - "generates a unique ID starting with ns-" |
| 3.3 | Task defaults to config's `one_off_defaults` for timeout and budget | `integration/submit.test.ts` - "applies default timeout and budget from config" |
| 3.4 | `--timeout` flag overrides the default timeout | `integration/submit.test.ts` - "accepts --timeout flag" |
| 3.5 | `--budget` flag overrides the default budget | `integration/submit.test.ts` - "accepts --budget flag" |
| 3.6 | `--model` flag sets the model | `integration/submit.test.ts` - "accepts --model flag" |
| 3.7 | `--name` flag sets a custom task name | `integration/submit.test.ts` - "accepts --name flag" |
| 3.8 | `--tools` flag sets allowed tools (variadic) | `integration/submit.test.ts` - "accepts --tools flag with multiple tools" |
| 3.9 | Auto-generates name as `one-off-ns-*` when `--name` not provided | `integration/submit.test.ts` - "auto-generates name when --name not provided" |
| 3.10 | Task records a `createdAt` timestamp | `integration/submit.test.ts` - "sets createdAt timestamp" |
| 3.11 | Task origin is set to "one-off" | `integration/submit.test.ts` - "creates a task file in the queue directory" |
| 3.12 | Task status is set to "pending" | `integration/submit.test.ts` - "creates a task file in the queue directory" |
| 3.13 | Submit fails gracefully without config file | `integration/submit.test.ts` - "fails gracefully without config" |
| 3.14 | Submit prints confirmation with task ID | `integration/submit.test.ts` - "prints confirmation with task ID and prompt summary" |

---

## US-4: View recurring task schedule

**As a** user, **I want to** see my recurring tasks and their next run times **so that** I can verify my cron schedules are correct.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 4.1 | `nightshift schedule` displays a table with Name, Schedule, Next Run, Timeout, Budget | `integration/schedule.test.ts` - "displays recurring tasks in a table" |
| 4.2 | Shows "No recurring tasks configured" when the list is empty | `integration/schedule.test.ts` - "shows 'No recurring tasks'" |
| 4.3 | Uses config's defaultTimeout when task has no explicit timeout | `integration/schedule.test.ts` - "uses default timeout" |

---

## US-5: Start the daemon

**As a** user, **I want to** start the daemon as a background process **so that** it polls for and executes tasks autonomously.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 5.1 | `nightshift start` validates config before starting | **NOT TESTABLE** (requires daemon fork) |
| 5.2 | `nightshift start` refuses to start if daemon is already running | **NOT TESTABLE** (requires daemon fork) |
| 5.3 | `nightshift start` forks a detached background process | **NOT TESTABLE** (requires daemon fork) |
| 5.4 | `nightshift start` prints the daemon PID on success | **NOT TESTABLE** (requires daemon fork) |
| 5.5 | Daemon writes a PID file on startup | `unit/health.test.ts` - "writes and reads PID file" |
| 5.6 | Daemon writes heartbeat periodically | `unit/health.test.ts` - "writes and reads daemon state" |

---

## US-6: Stop the daemon

**As a** user, **I want to** stop the daemon **so that** I can halt task execution.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 6.1 | `nightshift stop` sends SIGTERM for graceful shutdown | **NOT TESTABLE** (requires running daemon) |
| 6.2 | `nightshift stop --force` sends SIGKILL for immediate termination | **NOT TESTABLE** (requires running daemon) |
| 6.3 | Graceful shutdown drains active tasks before exiting | `unit/agent-pool.test.ts` - "drain waits for all running tasks" |
| 6.4 | Reports "Daemon is not running" when no daemon is active | **NOT TESTABLE** (requires running daemon) |
| 6.5 | Cleans up stale PID file when daemon process is gone | `unit/health.test.ts` - "cleanupStaleState removes PID file" |

---

## US-7: View daemon and queue status

**As a** user, **I want to** see the daemon status and queue depth **so that** I know if tasks are being processed.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 7.1 | Shows daemon status (running/stopped) and info when running | `integration/status.test.ts` - "shows daemon info when state file exists" |
| 7.2 | Shows queue depth (pending/ready tasks count) | `integration/status.test.ts` - "shows queue depth for file-based queue" |
| 7.3 | Shows "stopped" when daemon is not running | `integration/status.test.ts` - "shows 'stopped' when no daemon is running" |

---

## US-8: Scheduler evaluates recurring tasks

**As a** daemon, **I want to** evaluate cron schedules on each poll tick **so that** recurring tasks are created at the right time.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 8.1 | Creates a task when a cron schedule is due | `unit/scheduler.test.ts` - "creates tasks for due recurring schedules" |
| 8.2 | Does not create duplicate tasks within the same cron window | `unit/scheduler.test.ts` - "does not duplicate tasks that already ran" |
| 8.3 | Skips tasks with no recent trigger (first run, far-future schedule) | `unit/scheduler.test.ts` - "skips tasks with no previous run and no recent trigger" |
| 8.4 | Created tasks have origin "recurring" and correct recurringName | `unit/scheduler.test.ts` - "creates tasks for due recurring schedules" |
| 8.5 | Persists scheduler state (lastRuns) to disk after creating tasks | `unit/scheduler.test.ts` - "persists scheduler state to disk" |
| 8.6 | Restores scheduler state from disk on startup | `unit/scheduler.test.ts` - "restores scheduler state from disk on startup" |
| 8.7 | Uses task-specific timeout when defined, falls back to defaultTimeout | `unit/scheduler.test.ts` - "uses task-specific timeout, falls back to defaultTimeout" |
| 8.8 | Carries over allowedTools, maxBudgetUsd, model, output from recurring config | `unit/scheduler.test.ts` - "carries over allowedTools, maxBudgetUsd, model, output" |
| 8.9 | When a task has run before and a new cron trigger fires, creates a new task | `unit/scheduler.test.ts` - "creates a new task after enough time has passed" |
| 8.10 | Task file is written to queue when beads disabled | `unit/scheduler.test.ts` - "writes task file to queue when beads disabled" |

---

## US-9: Daemon orchestrates task execution

**As a** daemon, **I want to** poll for ready tasks, claim them, and dispatch to agents **so that** tasks are executed autonomously.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 9.1 | Reads pending tasks from file-based queue | `unit/orchestrator.test.ts` - "reads pending tasks from queue directory" |
| 9.2 | Skips non-pending tasks (running, completed) | `unit/orchestrator.test.ts` - "skips non-pending tasks" |
| 9.3 | Handles empty queue gracefully | `unit/orchestrator.test.ts` - "handles empty queue directory" |
| 9.4 | Ignores non-JSON files in queue directory | `unit/orchestrator.test.ts` - "ignores non-json files in queue" |
| 9.5 | Claims a task by updating its status to "running" | `unit/orchestrator.test.ts` - "updates task status from pending to running" |
| 9.6 | Claimed task is no longer returned as pending | `unit/orchestrator.test.ts` - "claimed task is no longer picked up as pending" |
| 9.7 | Removes task file from queue after completion | `unit/orchestrator.test.ts` - "removes task file from queue after completion" |
| 9.8 | Respects maxConcurrent limit (does not dispatch when pool is full) | `unit/agent-pool.test.ts` - "does not dispatch when pool is full" |
| 9.9 | Accumulates totalExecuted and totalCostUsd after completion | `unit/orchestrator.test.ts` - "tracks cost accumulation" |

---

## US-10: Agent executes a task

**As a** daemon, **I want to** execute a task via `claude -p` **so that** the AI agent performs the requested work.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 10.1 | Always passes required flags: -p, --output-format json, --dangerously-skip-permissions, --no-session-persistence | `unit/agent-runner.test.ts` - "passes basic required arguments" |
| 10.2 | Includes --allowedTools when task specifies tools | `unit/agent-runner.test.ts` - "includes --allowedTools when specified" |
| 10.3 | Includes --max-budget-usd when task specifies budget | `unit/agent-runner.test.ts` - "includes --max-budget-usd when specified" |
| 10.4 | Includes --model when task specifies model | `unit/agent-runner.test.ts` - "includes --model when specified" |
| 10.5 | Includes --mcp-config when task specifies MCP config | `unit/agent-runner.test.ts` - "includes --mcp-config when specified" |
| 10.6 | Appends system prompt with task name and workspace path | `unit/agent-runner.test.ts` - "includes --append-system-prompt" |
| 10.7 | Omits optional flags when not specified | `unit/agent-runner.test.ts` - "omits optional flags when fields are absent" |
| 10.8 | Parses valid JSON output from claude | `unit/agent-runner.test.ts` - "parses valid claude JSON output" |
| 10.9 | Throws AgentExecutionError on malformed JSON | `unit/agent-runner.test.ts` - "throws AgentExecutionError on malformed JSON" |
| 10.10 | Throws AgentExecutionError on empty output | `unit/agent-runner.test.ts` - "throws AgentExecutionError on empty output" |
| 10.11 | Returns error result with isError=true on timeout | `unit/agent-runner.test.ts` - "returns error result on timeout" |
| 10.12 | Throws on non-zero exit code with stderr details | `unit/agent-runner.test.ts` - "throws on non-zero exit code" + "includes stderr" |
| 10.13 | kill() sends SIGTERM to the running process | `unit/agent-runner.test.ts` - "sends SIGTERM to the running process" |

---

## US-11: Agent pool manages concurrency

**As a** daemon, **I want to** limit concurrent agent executions **so that** system resources are not exhausted.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 11.1 | Pool reports canAccept()=true when under maxConcurrent | `unit/agent-pool.test.ts` - "returns true when pool is empty" + "returns true when under maxConcurrent" |
| 11.2 | Pool reports canAccept()=false when at maxConcurrent | `unit/agent-pool.test.ts` - "returns false when at maxConcurrent" |
| 11.3 | Pool rejects dispatch when full | `unit/agent-pool.test.ts` - "does not dispatch when pool is full" |
| 11.4 | collectCompleted() drains and returns the completedQueue | `unit/agent-pool.test.ts` - "returns completed tasks and drains the queue" |
| 11.5 | Failed agents produce a TaskResult with isError=true | `unit/agent-pool.test.ts` - "produces a TaskResult with isError=true when agent throws" |
| 11.6 | drain() waits for all running tasks to complete | `unit/agent-pool.test.ts` - "waits for all running tasks and returns results" |
| 11.7 | killAll() sends SIGTERM to all running agents | `unit/agent-pool.test.ts` - "sends kill signal to all running agents" |
| 11.8 | activeCount reflects the number of running tasks | `unit/agent-pool.test.ts` - "reflects the number of running tasks" |

---

## US-12: Generate inbox reports

**As a** user, **I want to** have markdown reports generated for completed tasks **so that** I can review results in the morning.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 12.1 | Report contains YAML frontmatter with task_id, task_name, origin, status, timestamps, duration, cost, num_turns | `unit/reporter.test.ts` - "generates valid markdown with frontmatter" |
| 12.2 | Report marks failed tasks with status "failed" | `unit/reporter.test.ts` - "marks failed tasks correctly" |
| 12.3 | Report formats long durations as "Xh Xm" | `unit/reporter.test.ts` - "formats long durations correctly" |
| 12.4 | toInboxEntry creates structured entry from task/result | `unit/reporter.test.ts` - "creates an inbox entry" |
| 12.5 | Report is written atomically to `.nightshift/inbox/` | `unit/reporter.test.ts` - "writes report file to inbox directory" |
| 12.6 | Report filename follows pattern `{date}_{name}_{shortid}.md` | `unit/reporter.test.ts` - "generates filename following pattern" |
| 12.7 | Custom output path with template variables is supported | `unit/reporter.test.ts` - "writes to custom output path" |
| 12.8 | Report includes the original prompt as a blockquote | `unit/reporter.test.ts` - "includes original prompt as blockquote for multi-line prompts" |
| 12.9 | Short durations (< 60s) are formatted as "Xs" | `unit/reporter.test.ts` - "formats short durations (< 60s) as seconds" |
| 12.10 | Medium durations (< 60m) are formatted as "Xm Xs" | `unit/reporter.test.ts` - "formats medium durations" |
| 12.11 | toInboxEntry truncates result summary to 500 chars | `unit/reporter.test.ts` - "truncates result summary to 500 chars" |
| 12.12 | toInboxEntry marks failed tasks with status "failed" | `unit/reporter.test.ts` - "marks failed tasks with status 'failed'" |

---

## US-13: Browse inbox

**As a** user, **I want to** browse completed task reports **so that** I can review what happened overnight.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 13.1 | `nightshift inbox` lists recent reports as a table (task, status, duration, cost, file) | `integration/inbox.test.ts` - "lists reports as a table" |
| 13.2 | Reports are sorted newest-first | `integration/inbox.test.ts` - "sorts reports newest first" |
| 13.3 | `-n` flag limits the number of reports shown | `integration/inbox.test.ts` - "limits results with -n flag" |
| 13.4 | `--read <file>` displays the full content of a specific report | `integration/inbox.test.ts` - "displays full report content with --read flag" |
| 13.5 | Shows "No inbox reports yet" when inbox is empty | `integration/inbox.test.ts` - "shows 'No inbox reports'" |
| 13.6 | Shows error when `--read` references a non-existent file | `integration/inbox.test.ts` - "shows error when --read references a non-existent file" |

---

## US-14: Daemon health detection

**As a** system, **I want to** detect daemon health and staleness **so that** users can see accurate status and recover from crashes.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 14.1 | PID file can be written, read, and removed | `unit/health.test.ts` - "writes and reads PID file" + "removes PID file" |
| 14.2 | Reading missing PID file returns null | `unit/health.test.ts` - "returns null for missing PID file" |
| 14.3 | Daemon state can be written and read | `unit/health.test.ts` - "writes and reads daemon state" |
| 14.4 | isDaemonRunning returns true for running daemon with fresh heartbeat | `unit/health.test.ts` - "detects running daemon" |
| 14.5 | isDaemonRunning returns false for stopped daemon | `unit/health.test.ts` - "detects stopped daemon" |
| 14.6 | isDaemonRunning returns false for stale daemon (old heartbeat) | `unit/health.test.ts` - "detects stale daemon" |
| 14.7 | isDaemonRunning returns false when PID does not exist | `unit/health.test.ts` - "isDaemonRunning returns false when PID does not exist" |
| 14.8 | cleanupStaleState removes PID file and marks state as stopped | `unit/health.test.ts` - "cleanupStaleState removes PID file and marks state as stopped" |

---

## US-15: Beads integration for task tracking

**As a** user, **I want to** use beads (bd CLI) for task tracking **so that** tasks are managed through an external workbench system.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 15.1 | toBeadLabels generates "nightshift" + "nightshift:one-off" for one-off tasks | `unit/mapper.test.ts` - "adds nightshift and one-off labels" |
| 15.2 | toBeadLabels generates "nightshift" + "nightshift:recurring:{name}" for recurring tasks | `unit/mapper.test.ts` - "adds recurring label with name" |
| 15.3 | toBeadDescription encodes metadata in delimited block + prompt | `unit/mapper.test.ts` - "encodes task metadata in description" |
| 15.4 | toBeadDescription omits optional fields when absent | `unit/mapper.test.ts` - "omits optional fields when absent" |
| 15.5 | fromBead reconstructs task from bead with labels | `unit/mapper.test.ts` - "reconstructs a task from a bead entry with labels" |
| 15.6 | fromBead handles bd ready output (labels missing) | `unit/mapper.test.ts` - "handles bd ready output" |
| 15.7 | fromBead detects recurring tasks from labels | `unit/mapper.test.ts` - "detects recurring tasks from labels" |
| 15.8 | fromBead detects recurring origin from metadata when labels missing | `unit/mapper.test.ts` - "detects recurring origin from metadata" |
| 15.9 | fromBead maps closed beads to completed status | `unit/mapper.test.ts` - "maps closed beads to completed status" |
| 15.10 | fromBead maps open beads to pending status | `unit/mapper.test.ts` - "maps open beads to pending status" |
| 15.11 | fromBead handles description without metadata block | `unit/mapper.test.ts` - "handles description without metadata block" |
| 15.12 | Roundtrip: toBeadDescription -> fromBead preserves all data | `unit/mapper.test.ts` - "roundtrips" |
| 15.13 | toBeadDescription includes output field when present | `unit/mapper.test.ts` - "includes output field when present" |
| 15.14 | Roundtrip preserves output field | `unit/mapper.test.ts` - "roundtrips output field" |

---

## US-16: Template variable substitution

**As a** user, **I want to** use template variables in output paths **so that** reports are organized by date/name.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 16.1 | `{{date}}` is replaced with YYYY-MM-DD | `unit/template.test.ts` - "replaces {{date}}" |
| 16.2 | Custom variables like `{{name}}` are replaced | `unit/template.test.ts` - "replaces custom variables" |
| 16.3 | Unknown placeholders are left intact | `unit/template.test.ts` - "keeps unknown placeholders intact" |
| 16.4 | Built-in variables (year, month, day) are replaced | `unit/template.test.ts` - "replaces all built-in variables" |
| 16.5 | `{{datetime}}` is replaced with date and time | `unit/template.test.ts` - "replaces {{datetime}} with date and time" |
| 16.6 | `{{time}}` is replaced with time only | `unit/template.test.ts` - "replaces {{time}} with time only" |
| 16.7 | Multiple variables in the same template are all replaced | `unit/template.test.ts` - "handles multiple variables in the same template" |

---

## US-17: Process management utilities

**As a** system, **I want to** safely spawn and timeout child processes **so that** agents are reliably managed.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 17.1 | parseTimeout handles ms, s, m, h units | `unit/process.test.ts` - parses milliseconds/seconds/minutes/hours |
| 17.2 | parseTimeout throws on invalid format | `unit/process.test.ts` - "throws on invalid format" |
| 17.3 | spawnWithTimeout runs commands and captures stdout | `unit/process.test.ts` - "runs a simple command" |
| 17.4 | spawnWithTimeout captures stderr | `unit/process.test.ts` - "captures stderr" |
| 17.5 | spawnWithTimeout returns non-zero exit codes | `unit/process.test.ts` - "returns non-zero exit code" |
| 17.6 | spawnWithTimeout kills and flags timed-out processes | `unit/process.test.ts` - "times out long-running process" |

---

## US-18: Daemon graceful shutdown

**As a** daemon, **I want to** handle signals gracefully **so that** active tasks are drained and reports are written before exit.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 18.1 | SIGTERM/SIGINT triggers graceful shutdown | **NOT TESTABLE** (requires running daemon process with signal handling) |
| 18.2 | Graceful shutdown drains all active tasks from the pool | `unit/agent-pool.test.ts` - "drain waits for all running tasks" |
| 18.3 | Uncaught exceptions trigger shutdown and exit with code 1 | **NOT TESTABLE** (requires running daemon process) |

> **Note on US-5, US-6, US-18**: The daemon start/stop/signal-handling commands require forking a real daemon process and managing its lifecycle. These are intentionally excluded from automated tests as they involve process management that is inherently non-deterministic in CI. The underlying mechanisms (health checks, PID files, pool draining) are fully tested in isolation.

---

## US-19: Hot-reload recurring tasks

**As a** user, **I want** config changes to recurring tasks to be picked up automatically **so that** I don't need to restart the daemon when I edit `nightshift.yaml`.

### Acceptance Criteria

| # | Criterion | Test |
|---|-----------|------|
| 19.1 | Scheduler's `updateConfig` replaces recurring tasks for subsequent evaluations | `unit/scheduler.test.ts` - "updateConfig replaces recurring tasks for subsequent evaluations" |
| 19.2 | Orchestrator tick picks up new recurring tasks from modified config | `unit/orchestrator.test.ts` - "tick picks up new recurring tasks from modified config" |
| 19.3 | Orchestrator tick continues with previous config when config file is invalid | `unit/orchestrator.test.ts` - "tick continues with previous config when config file is invalid" |
| 19.4 | Only `recurring` and `defaultTimeout` are hot-reloaded; other settings remain fixed | By design (code inspection) |

---

## Coverage Summary

| Status | Count |
|--------|-------|
| Covered by automated tests | 100 |
| Not testable in unit/integration tests | 9 |
| **Total acceptance criteria** | **109** |

### Test Count

| Before | After |
|--------|-------|
| 87 tests across 11 files | **131 tests across 15 files** |

### New Test Files

- `tests/unit/agent-pool.test.ts` - 9 tests for concurrency management
- `tests/integration/schedule.test.ts` - 3 tests for schedule command
- `tests/integration/status.test.ts` - 3 tests for status command
- `tests/integration/inbox.test.ts` - 6 tests for inbox command

### Expanded Test Files

- `tests/unit/scheduler.test.ts` - 3 -> 9 tests (+6: state persistence, timeout fallback, config carry-over, re-trigger, file queue)
- `tests/unit/reporter.test.ts` - 4 -> 12 tests (+8: duration formatting, multi-line prompts, writeReport, filename pattern, custom output, truncation)
- `tests/unit/health.test.ts` - 7 -> 9 tests (+2: cleanupStaleState, dead PID detection)
- `tests/unit/template.test.ts` - 4 -> 7 tests (+3: datetime, time, multiple variables)
- `tests/unit/mapper.test.ts` - 12 -> 14 tests (+2: output field encoding, output roundtrip)
- `tests/integration/init-and-config.test.ts` - 6 -> 7 tests (+1: next steps guidance)
- `tests/integration/submit.test.ts` - 11 -> 12 tests (+1: confirmation output)
