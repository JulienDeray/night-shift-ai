# Architecture Patterns

**Domain:** Poll-based autonomous agent daemon — notification hooks + code improvement agent
**Researched:** 2026-02-23
**Confidence:** HIGH (based on direct codebase analysis + verified Ntfy/glab docs)

---

## Context: Existing Architecture

Night-shift is a poll-based daemon. The `Orchestrator` runs a `tick()` loop every 30s:

```
tick()
  1. evaluateSchedules()    — Scheduler creates tasks for due cron entries
  2. collectCompleted()     — AgentPool drains finished processes
  3. handleCompleted()      — writeReport() + update beads/queue status
  4. getReadyTasks()        — poll beads or file queue
  5. claimTask() + pool.dispatch() — spawn claude -p subprocess
```

All state is file-based or beads-based. No in-process event bus. No plugin system. Two natural hook points exist: **task dispatch** and **task completion** (inside `handleCompleted`).

---

## Recommended Architecture

### System Topology (after this milestone)

```
nightshift.yaml
  └─ ntfy: { topic, base_url }
  └─ code_agent: { repo, confluence_page_id, schedule, categories }

Orchestrator (poll loop, 30s)
  ├─ Scheduler         — creates tasks when cron is due
  ├─ AgentPool         — spawns claude -p subprocesses
  ├─ NtfyClient        — fire-and-forget HTTP POST to ntfy.sh
  └─ handleCompleted() — notification hook point

code-improvement agent (runs as a recurring NightShiftTask)
  Prompt → claude -p
    ├─ git clone (temp dir)
    ├─ analyze codebase (Read tools)
    ├─ create branch + make change
    ├─ git commit + push
    ├─ glab mr create
    ├─ update Confluence page (MCP)
    └─ append to local log file
  Result text → MR URL or "no improvement found"
  Cleanup → rm -rf temp dir (in prompt instructions)
```

---

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `NtfyClient` | Send HTTP POST to ntfy.sh; fire-and-forget with logged errors | Orchestrator (called from dispatch hook and handleCompleted) |
| `Orchestrator` (extended) | Call NtfyClient on task start and task end | NtfyClient, AgentPool, Scheduler |
| Config (`ntfy` block) | Hold topic name, optional base_url and auth token | loadConfig() → Orchestrator |
| Config (`code_agent` block) | Hold repo URL, Confluence page ID, category schedule, MR defaults | loadConfig() → recurring task prompt builder |
| Code Improvement Agent (prompt) | Clone repo, analyze, branch, commit, push, MR, log, clean up | claude -p with glab + git + Confluence MCP + Read/Write tools |
| Local improvement log | Append-only markdown file tracking past MRs | Written by agent (Write tool) |
| Confluence page | Running log visible to team | Updated by agent (Confluence MCP) |

---

### Data Flow

#### Notification Flow (task start)

```
Orchestrator.tick()
  → pool.dispatch(task)
      [new] → ntfyClient.send({
                title: task.name,
                message: "Starting: " + task.name,
                tags: ["gear", task.origin],
                priority: "default"
              })
      → AgentRunner spawns claude -p
```

#### Notification Flow (task end)

```
Orchestrator.handleCompleted(taskResult)
  → writeReport()
  [new] → ntfyClient.send({
            title: task.name,
            message: result.isError ? "Failed" : extractSummary(result),
            tags: result.isError ? ["x", "red_circle"] : ["white_check_mark"],
            click: mrUrl (if extracted from result),
            priority: result.isError ? "high" : "default"
          })
  → beads.close() / queue cleanup
```

The `extractSummary()` helper parses the agent result text looking for MR URL patterns (`https://gitlab.com/.../-/merge_requests/...`) to surface as the click URL. Falls back to first 200 chars of result if no URL found.

#### Code Improvement Agent Workflow (inside claude -p)

```
Prompt instructs agent to:

1. CLONE
   git clone <repo_url> <tmpdir>
   (tmpdir = /tmp/night-shift-agent-<randomHex>)

2. ANALYZE
   Read category from prompt context (today's mapped category)
   Read relevant files (tests, src, docs depending on category)
   Identify ONE small, focused improvement

3. IF nothing meaningful found:
   Exit with "no improvement found" message
   (skip all remaining steps)

4. BRANCH
   git -C <tmpdir> checkout -b ns/<category>/<slug>-<date>

5. COMMIT
   Make the change (Write tool)
   git -C <tmpdir> add -A
   git -C <tmpdir> commit -m "<conventional commit message>"

6. PUSH
   git -C <tmpdir> push origin ns/<category>/<slug>-<date>

7. MR
   glab mr create \
     --repo <repo> \
     --source-branch ns/<category>/<slug>-<date> \
     --target-branch main \
     --title "<title>" \
     --description "<description>" \
     --label "night-shift,<category>" \
     --yes

8. LOG
   Append to <local_log_path>:
     "| <date> | <category> | <title> | <mr_url> |"
   Update Confluence page <page_id> via MCP:
     Prepend new row to running table

9. CLEANUP
   rm -rf <tmpdir>

10. OUTPUT
    Return result text containing MR URL
```

The agent receives category from the prompt (daemon builds it from `code_agent.categories` schedule mapped to day-of-week). The agent does NOT choose the category — the daemon chooses based on config.

---

### Config Schema Extensions

**Ntfy block** (new, optional — daemon skips notifications if absent):

```yaml
ntfy:
  topic: "night-shift-x7k2p9"     # required; treat as secret
  base_url: "https://ntfy.sh"      # optional, default: https://ntfy.sh
  token: ""                         # optional; Bearer auth for private servers
```

**Code agent block** (new, optional — no recurring task generated if absent):

```yaml
code_agent:
  repo: "git@gitlab.com:org/repo.git"   # required
  target_branch: "main"                  # optional, default: main
  confluence_page_id: "123456"           # required; pre-created page
  local_log: "./logs/improvements.md"    # optional, default: .nightshift/improvements.md
  schedule: "0 2 * * *"                  # cron schedule; optional if using recurring[] directly
  max_budget_usd: 3.00                   # optional
  timeout: "45m"                         # optional, default: 30m
  categories:
    monday: tests
    tuesday: refactoring
    wednesday: docs
    thursday: tests
    friday: refactoring
    saturday: docs
    sunday: tests
```

These two blocks are optional. Night-shift continues to work without them. The code_agent block, when present, generates a recurring task entry programmatically (or the user can define it manually in `recurring[]` with the appropriate prompt template).

---

## Patterns to Follow

### Pattern 1: Fire-and-Forget Notification Client

**What:** NtfyClient is a thin wrapper around `fetch`. It never throws. All errors are logged and swallowed. The daemon's correctness does not depend on notification delivery.

**When:** Any side-effect that should not block or fail the main workflow.

**Example:**

```typescript
// src/notifications/ntfy-client.ts
export class NtfyClient {
  constructor(
    private readonly topic: string,
    private readonly baseUrl: string = "https://ntfy.sh",
    private readonly token?: string,
  ) {}

  async send(notification: NtfyNotification): Promise<void> {
    const headers: Record<string, string> = {
      "Title": notification.title,
      "Content-Type": "text/plain",
    };
    if (notification.tags?.length) {
      headers["Tags"] = notification.tags.join(",");
    }
    if (notification.priority) {
      headers["Priority"] = notification.priority;
    }
    if (notification.click) {
      headers["Click"] = notification.click;
    }
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    try {
      const res = await fetch(`${this.baseUrl}/${this.topic}`, {
        method: "POST",
        body: notification.message,
        headers,
      });
      if (!res.ok) {
        this.logger.warn("Ntfy send failed", { status: res.status });
      }
    } catch (err) {
      this.logger.warn("Ntfy send error (ignored)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
```

**Key:** Inject logger. Never rethrow. Await inside try/catch.

### Pattern 2: Notification Hook Points in Orchestrator

**What:** Two call sites in Orchestrator. Notifications do not block the tick cycle.

**When:** Task dispatched (start) and task result handled (end).

**Example diff to Orchestrator:**

```typescript
// In tick(), after pool.dispatch(task):
void this.ntfy?.send({
  title: task.name,
  message: `Starting task: ${task.name}`,
  tags: ["gear"],
  priority: "default",
});

// In handleCompleted(), after writeReport():
void this.ntfy?.send({
  title: task.name,
  message: result.isError
    ? `Failed: ${result.result.slice(0, 200)}`
    : result.result.slice(0, 300),
  tags: result.isError ? ["x"] : ["white_check_mark"],
  priority: result.isError ? "high" : "default",
  click: extractMrUrl(result.result),
});
```

Note `void` prefix — intentionally not awaited at the call site. NtfyClient.send() internally awaits and swallows errors.

### Pattern 3: Opt-In Per Recurring Task

**What:** A `notify` boolean on `RecurringTaskConfig` controls whether a task emits notifications. Defaults to the global ntfy config's presence — if ntfy is configured, all recurring tasks notify by default. Tasks can override with `notify: false`.

**When:** Some tasks may be noisy or low-priority (e.g., scheduled every 5 minutes).

**Config:**

```yaml
recurring:
  - name: "code-improvement"
    schedule: "0 2 * * *"
    notify: true   # explicit opt-in (or default if ntfy configured)
```

### Pattern 4: Agent Clone-Analyze-Branch-Commit-Push-MR-Clean Workflow

**What:** The entire git workflow runs inside the claude -p process. The daemon is unaware of git operations. The agent receives a structured prompt with all required context.

**When:** Code improvement agent task.

**Prompt structure (system prompt injected by daemon):**

```
You are a code improvement agent running as part of night-shift.

Context:
- Repository: git@gitlab.com:org/repo.git
- Today's category: TESTS (Monday)
- Confluence page ID: 123456
- Local log file: /path/to/improvements.md
- Date: 2026-02-23

Workflow (follow exactly):
1. Clone to a temp directory: /tmp/ns-agent-<random>
2. Analyze the codebase for the category: look for missing test coverage, ...
3. If nothing meaningful found: output "NO_IMPROVEMENT" and stop.
4. Create branch: ns/tests/<slug>-2026-02-23
5. Make ONE focused change
6. git add -A && git commit -m "test: <message>"
7. git push origin <branch>
8. glab mr create --repo org/repo --source-branch <branch> \
     --target-branch main --title "<title>" \
     --description "<description>" --label "night-shift,tests" --yes
9. Capture the MR URL from glab output
10. Append to local log: | 2026-02-23 | tests | <title> | <mr_url> |
11. Update Confluence page 123456 via MCP (prepend row to table)
12. rm -rf /tmp/ns-agent-<random>
13. Output: "MR created: <mr_url>" or "NO_IMPROVEMENT"
```

### Pattern 5: MR URL Extraction from Agent Result

**What:** A regex scan of agent result text to extract the GitLab MR URL for the notification click action.

**When:** handleCompleted() for code-improvement tasks.

**Example:**

```typescript
function extractMrUrl(resultText: string): string | undefined {
  const match = resultText.match(
    /https:\/\/gitlab\.com\/[^\s]+\/-\/merge_requests\/\d+/,
  );
  return match?.[0];
}
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Await Notification in Tick Path

**What:** `await ntfy.send(...)` blocking the orchestrator tick.

**Why bad:** Ntfy is an external HTTP call. Network latency or downtime blocks the entire daemon tick. Task dispatch stalls. If ntfy.sh is unreachable at 2am, the code-improvement task never starts.

**Instead:** `void ntfy.send(...)` — fire-and-forget with internal error handling inside NtfyClient.

### Anti-Pattern 2: Persistent Git Checkout in Workspace

**What:** Keeping a cloned repo in the night-shift workspace directory and pulling updates each run.

**Why bad:** Merge conflicts, dirty working trees, stale branches, half-applied changes from previous agent runs. Debugging what the agent did becomes hard because workspace state accumulates.

**Instead:** Fresh `git clone` into a system temp dir per run (`/tmp/ns-agent-<hex>`). Clean up unconditionally at the end of the prompt instructions. No state survives between runs.

### Anti-Pattern 3: Agent Creates the Confluence Page

**What:** Agent receives a space key and creates the page if it doesn't exist.

**Why bad:** Space/permission issues, page appears in wrong location, parent page wrong, title conflicts. Hard to fix after automation has already run.

**Instead:** Pre-create the Confluence page manually. Agent receives the page ID and only appends rows to an existing table. Simpler, safer, recoverable.

### Anti-Pattern 4: Daemon-Level Git Operations

**What:** Orchestrator or a new daemon component performs git clone/push/MR-create operations directly.

**Why bad:** Forces daemon to have git credentials, adds shell execution concerns, makes daemon responsible for workflow correctness. Defeats the purpose of using claude -p.

**Instead:** All git/glab operations happen inside the claude -p prompt. Daemon only knows: task started, task ended, result text (which contains the MR URL).

### Anti-Pattern 5: Category Rotation Inside the Agent

**What:** Agent decides which improvement category to work on based on its own analysis or memory.

**Why bad:** Unpredictable rotation, agent may always prefer the same category if that's where it finds easy wins, no external control over balance.

**Instead:** Daemon reads day-of-week from config map and injects the category into the prompt. Agent is told its category. Config controls the schedule.

### Anti-Pattern 6: Ntfy Topic in Config Without Secret Handling

**What:** Storing the ntfy topic directly in `nightshift.yaml` committed to git.

**Why bad:** The topic name is functionally a password. Anyone who knows it can send notifications to your device.

**Instead:** Support `NIGHT_SHIFT_NTFY_TOPIC` env var override. Document that the topic should be a long random string. Config file should be gitignored for personal configs. The token field (for authenticated servers) is especially sensitive.

---

## Build Order Implications

Dependencies between components:

```
1. NtfyClient (new, standalone)
   - No dependencies on existing code except Logger and NightShiftConfig
   - Build first; can be tested independently with a curl call

2. Config schema extension (ntfy + code_agent blocks)
   - Extend Zod schema in config.ts, types.ts
   - NtfyClient depends on NtfyConfig type
   - code_agent block feeds the recurring task prompt builder

3. Orchestrator notification hooks
   - Depends on NtfyClient
   - Two-line change at dispatch + handleCompleted
   - Optional (skips if NtfyConfig not present)

4. Recurring task prompt template for code improvement
   - Depends on config schema extension (code_agent block)
   - Daemon reads code_agent config, builds prompt with injected context
   - Or: user writes prompt manually in recurring[] using template variables

5. Agent workflow validation (integration test)
   - Clone → branch → commit → push → MR → log
   - Requires glab auth + target repo access
   - Test with a scratch repo before pointing at real repo
```

**Phase ordering recommendation:**

| Phase | What | Why First |
|-------|------|-----------|
| 1 | NtfyClient + config schema | Foundation; all other pieces reference it |
| 2 | Orchestrator hooks | Low risk; two call sites; immediately useful for all tasks |
| 3 | Code agent config block + prompt | Depends on config schema being stable |
| 4 | Code agent integration test | Last; requires external services (GitLab, glab) |

---

## Scalability Considerations

This is a personal/team tool. Scalability is not a primary concern. The relevant constraints are:

| Concern | Current scale | Notes |
|---------|--------------|-------|
| Ntfy rate limits | 1 notification per task start/end | ntfy.sh free tier: no hard limits documented for low volume; self-hosted removes concern |
| Git clone per run | One clone of one repo per night | Typically < 30s; temp dir cleaned up; no disk accumulation concern |
| Agent token budget | $3-5 per run | Controlled by `max_budget_usd` on the code_agent config |
| Concurrent tasks | Existing `max_concurrent` cap applies | Code improvement agent counts as one slot |

---

## Sources

- Existing codebase (`src/daemon/orchestrator.ts`, `src/daemon/agent-pool.ts`, `src/daemon/agent-runner.ts`, `src/daemon/scheduler.ts`) — HIGH confidence (direct read)
- Ntfy publish API: https://docs.ntfy.sh/publish/ — HIGH confidence (official docs)
- Ntfy JSON format: https://docs.ntfy.sh/publish/#publish-with-json — HIGH confidence (official docs)
- glab mr create flags: https://docs.gitlab.com/cli/mr/create/ — HIGH confidence (official docs)
- Node.js native fetch for ntfy: confirmed via official Node.js 18+ docs + ntfy examples — HIGH confidence
- `.planning/PROJECT.md` for feature scope and constraints — HIGH confidence (project document)
