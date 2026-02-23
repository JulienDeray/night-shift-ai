# External Integrations

**Analysis Date:** 2026-02-23

## APIs & External Services

**Claude API (Primary):**
- Service: Claude API via Claude CLI
- What it's used for: Agent execution engine - spawning autonomous `claude -p` processes
- SDK/Client: Claude CLI binary (not npm package)
- Auth: Inherited from user's Claude CLI configuration
- Integration point: `src/daemon/agent-runner.ts` spawns `claude -p` subprocess
- Call pattern: `claude -p "<prompt>" --output-format json --dangerously-skip-permissions ...`
- Output format: JSON with session_id, duration_ms, total_cost_usd, result, is_error, num_turns

**MCP (Model Context Protocol) Servers:**
- What it's used for: Tool integration for agents (e.g., Jira, Confluence, filesystem, custom tools)
- Discovery: Inherited automatically from user's Claude CLI config
- Per-task tool restrictions: Passed via `--allowedTools` flag to `claude -p`
- Tool naming: Pattern `mcp__<service>__*` (e.g., `mcp__jira__*`, `mcp__confluence__*`)
- Example tools: `Read`, `Write`, service-specific MCP tools

## Data Storage

**Databases:**
- None configured or required
- Task state stored locally in file system

**Local File Storage:**
- Queue storage: `.nightshift/queue/` (fallback, when beads disabled)
  - Format: JSON files with task metadata
  - Claimed by updating status field atomically

- Inbox storage: `.nightshift/inbox/`
  - Format: Markdown files with YAML frontmatter
  - Filename pattern: `{date}_{task-name}_{short-id}.md`
  - Contains: Task metadata (task_id, duration, cost, status), results, original prompt

- Daemon state: `.nightshift/daemon.json`
  - Updated every 10s (heartbeat interval)
  - Contains: pid, startedAt, lastHeartbeat, activeTasks, totalExecuted, totalCostUsd, status

- Scheduler state: `.nightshift/scheduler.json`
  - Tracks last execution time of recurring tasks (prevents duplicate runs)

- PID file: `.nightshift/daemon.pid`
  - Stale detection: daemon with no heartbeat for 60s considered dead

- Logs: `.nightshift/logs/`
  - Format: JSON (one file per day)
  - Structured logging with timestamps
  - Retention policy: Configurable `log_retention_days` (default: 30, not yet implemented)

- Configuration: `nightshift.yaml` (project root)
  - Format: YAML with defaults applied at load time

- Workspace: `./workspace/` (configurable)
  - Agent output directory - where autonomous tasks write results

**Caching:**
- None - all task results written directly to files
- Scheduler state provides implicit caching of last-run times

## Authentication & Identity

**Auth Provider:**
- Inherited from Claude CLI configuration
- Mechanism: User runs `claude` CLI which manages session tokens
- No explicit API key management in night-shift
- Session tokens: Not managed by night-shift (delegated to Claude CLI)
- Per-task scoping: Tool restrictions via `--allowedTools` parameter

**MCP Auth:**
- Each MCP server inherits auth from Claude CLI's MCP config
- No explicit credential passing from night-shift
- Tool access controlled declaratively per task

## Monitoring & Observability

**Error Tracking:**
- None (no external error tracking service)
- Errors logged to JSON logs in `.nightshift/logs/`
- Task failure metadata stored in daemon state and inbox reports

**Logs:**
- Approach: JSON structured logging to file
- Logger implementation: `src/core/logger.ts`
- Output: `.nightshift/logs/{YYYY-MM-DD}.json` (one file per day)
- Format: Structured JSON with timestamp, level, message, context fields
- Retention: Configurable (default 30 days, cleanup not yet implemented)
- Rotation: Daily (new file per date)

**Health Checks:**
- Daemon heartbeat: Written every 10s to `.nightshift/daemon.json`
- Stale detection: If heartbeat age > 60s, daemon considered dead
- PID file check: Validates daemon process is still running

## CI/CD & Deployment

**Hosting:**
- GitHub (public repository)
- No cloud hosting - framework designed for local execution

**CI Pipeline:**
- GitHub Actions (`.github/workflows/ci.yml`)
- Triggers: On push to main, on pull requests
- Matrix testing: Node.js 20 and 22
- Steps: checkout → setup Node → npm ci → typecheck → build → test
- No deployment step (npm package published manually)

**Package Distribution:**
- npm package registry
- Package name: `night-shift`
- Published artifacts: `dist/`, `bin/`, `LICENSE`, `README.md`
- Installation: `npm install night-shift` or `npm install -g night-shift`

## Environment Configuration

**Required env vars:**
- None required at application level
- All configuration via `nightshift.yaml`
- Claude CLI configuration inherited from user's environment

**Optional env vars:**
- Inherited from process.env in agent execution
- Passed through to spawned `claude -p` processes

**Secrets location:**
- No secrets stored by night-shift
- Claude API credentials: Managed by Claude CLI (in user's home directory)
- MCP server credentials: Managed by Claude CLI's MCP config
- Task-specific secrets: Can be passed via `allowed_tools` restrictions

## Webhooks & Callbacks

**Incoming:**
- None - framework is pull-based (daemon polls)
- No HTTP server or webhook listener

**Outgoing:**
- None - no external webhooks triggered
- Agent results written to local files only

## Fallback & Resilience

**Beads Integration:**
- Service: beads task tracking system (optional)
- Config flag: `beads.enabled` (default: true)
- When available:
  - Tasks tracked with labels: `nightshift`, `nightshift:one-off`, `nightshift:recurring:<name>`
  - Atomic task claiming via `bd update <id> --claim` (prevents double-execution)
  - Dependency graphs supported (via `bd dep add`)
  - Task metadata encoded in bead description
- When unavailable:
  - Graceful fallback to file-based queue in `.nightshift/queue/`
  - Same atomic guarantees via file status updates
  - No external dependency required

---

*Integration audit: 2026-02-23*
