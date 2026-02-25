# Phase 4: Git Harness and Logging - Research

**Researched:** 2026-02-25
**Domain:** Git clone/cleanup lifecycle, JSONL local logging, Confluence page append-only updates via MCP Atlassian, log bead integration
**Confidence:** HIGH

## Summary

Phase 4 completes the night-shift code agent by wiring together four pieces that the previous phases left unimplemented: (1) the git harness that clones the target repo to a temp directory and deletes it unconditionally in a `finally` block, (2) the branch/commit/push/MR mechanics already delegated to the MR prompt bead in Phase 3, (3) a local JSONL run log appended once per run, and (4) a new fifth "log" bead that updates a pre-existing Confluence page with a new table row. The Phase 3 pipeline already exists as `runCodeAgentPipeline` in `src/agent/code-agent-runner.ts` and returns a `CodeAgentRunResult`. Phase 4 wraps it in a harness function that owns the git clone, temp-dir lifecycle, and post-run logging.

The git harness is purely Node.js `child_process.spawn` calls (already wired via `spawnWithTimeout`) — `git clone --depth 1` into an `fs.mkdtemp` directory, followed by `rm -rf` in a `finally` block regardless of pipeline outcome. The local JSONL log is a plain `fs.appendFile` call — one JSON object per line, no library needed. The Confluence update is the most complex piece: the log bead receives `--mcp-config` pointing at the locally configured Atlassian MCP server, calls `mcp__atlassian__getConfluencePage` to fetch the current body, inserts a new row at the top of the existing Markdown table, then calls `mcp__atlassian__updateConfluencePage` to push the updated body. The log bead is the only bead that receives the MCP config; all other beads retain their current minimal tool allowlist.

The biggest risk noted in `STATE.md` is the Confluence append pattern: macro-stripping may occur on some Confluence instances (the workaround is plain Markdown table format with no macros). The git credential concern (`GIT_CONFIG_NOSYSTEM=1` blocking system-level credential configs) needs validation on the actual machine where night-shift runs. Both risks are flagged as LOW-confidence concerns that require runtime validation, not pre-implementation changes.

**Primary recommendation:** Create a `src/agent/git-harness.ts` module (clone + cleanup), a `src/agent/run-logger.ts` module (JSONL append), add a fifth "log" bead prompt at `src/agent/prompts/log.md` (Confluence update via MCP), wire them together in a new top-level `runCodeAgent(config)` function, and extend `PipelineContext` with a `log` prompt path. No new npm dependencies.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Local run log**
- JSONL format: one JSON object per line in `.nightshift/logs/code-agent-runs.jsonl`
- Required fields only: date, category, mr_url (or null), cost_usd, duration_seconds, summary
- No rotation — one entry per day, file grows indefinitely (~365 lines/year)
- Written by the Node.js harness (not by an agent bead)

**Confluence page layout**
- Table format with one row per run
- Newest-first ordering: new rows inserted at the top of the table
- Columns mirror the local log: Date | Category | MR Link | Cost | Duration | Summary
- Append-only: fetch current page body, insert row at top of table, push updated body

**Confluence update mechanism**
- New 5th "log" bead in the pipeline: analyze → implement → verify → mr → log
- The log bead uses the locally configured MCP Atlassian tools (no custom Confluence API client)
- Runs after MR bead regardless of outcome (records NO_IMPROVEMENT runs too)

### Claude's Discretion
- Branch naming convention and commit message format
- MR title/body template content
- Clone depth (shallow vs full)
- Error recovery strategy for partial failures (e.g., push succeeds but MR creation fails)
- Log bead prompt content and MCP tool usage details
- Temp directory location and cleanup implementation

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGENT-01 | Agent clones target GitLab repo to a fresh temp directory on each run | `fs.mkdtemp` + `git clone --depth 1` via `spawnWithTimeout`; temp dir created before pipeline, path passed as `repoDir` in `PipelineContext` |
| AGENT-02 | Temp directory is unconditionally cleaned up in a finally block (even on crash/timeout) | `try/finally` wrapping the entire harness call; `fs.rm(dir, { recursive: true, force: true })` in finally; handoff dir also cleaned in same finally |
| AGENT-03 | Agent creates a feature branch, commits the improvement, and pushes to remote | Already delegated to the MR bead prompt (`src/agent/prompts/mr.md`); harness just ensures clean clone state entering the bead |
| AGENT-04 | Agent creates a merge request via `glab mr create` with descriptive title and body | Already delegated to the MR bead prompt; confirmed `glab mr create` flags: `-t` title, `-d` description, `-l` labels, `--reviewer`, `-b` target-branch, `-y` non-interactive, `--yes` |
| LOG-01 | Local log file appended per run with date, category, MR URL (or null), cost, duration, and agent summary | `fs.appendFile` with a JSON object + newline to `.nightshift/logs/code-agent-runs.jsonl`; written by the TypeScript harness after `runCodeAgentPipeline` returns |
| LOG-02 | Agent updates a pre-existing Confluence page with a new row per run (append-only, fetch current body first) | 5th "log" bead with `--mcp-config` pointing at Atlassian MCP; calls `mcp__atlassian__getConfluencePage` → modify → `mcp__atlassian__updateConfluencePage`; runs regardless of pipeline outcome |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs/promises` (mkdtemp, rm, appendFile) | Built-in | Temp dir creation, unconditional cleanup, JSONL append | Already used throughout the codebase; zero new dependencies |
| `spawnWithTimeout` (internal) | Existing | `git clone` and cleanup via shell | Already used by `bead-runner.ts` and `code-agent-runner.ts`; safe argument passing |
| `mcp__atlassian__getConfluencePage` | MCP tool | Fetch current Confluence page body | Locally configured MCP Atlassian server; used by the log bead via `--mcp-config` |
| `mcp__atlassian__updateConfluencePage` | MCP tool | Push updated page body with new table row | Same MCP server; append-only pattern |
| Claude Code CLI (`claude`) | Existing install | Log bead invocation with `--mcp-config` | Already used by all 4 beads; adding `--mcp-config` flag is the only new argument |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:os` (`os.tmpdir()`) | Built-in | Base directory for temp clone and handoff dirs | `fs.mkdtemp(path.join(os.tmpdir(), 'night-shift-'))` — ephemeral, OS-managed location |
| `node:path` | Built-in | Resolve `.nightshift/logs/code-agent-runs.jsonl` from config base dir | Already used throughout |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain `fs.rm` for cleanup | Shell `rm -rf` via `spawnWithTimeout` | Both work; `fs.rm` with `{ recursive, force }` is pure Node, no shell needed — prefer it |
| MCP tool via log bead | Direct HTTP calls to Confluence REST API | MCP Atlassian is already configured locally; custom HTTP client would require auth token management and a new dependency |
| JSONL append in harness | Bead writing its own log | Locked decision: harness owns the local log, not a bead — simpler, no agent needed for structured data |
| `--depth 1` (shallow clone) | Full clone | Shallow is faster (~seconds vs minutes for large repos); MR bead reads `git log --oneline -10` which works with shallow clones; only risk is if history depth needed — depth 1 suffices since the agent works on tip of default branch |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── agent/
│   ├── git-harness.ts          # cloneRepo(), cleanupDir() — AGENT-01, AGENT-02
│   ├── run-logger.ts           # appendRunLog() — LOG-01
│   ├── code-agent-runner.ts    # runCodeAgentPipeline() — existing 4-bead pipeline
│   ├── code-agent.ts           # NEW: top-level runCodeAgent() wiring harness + pipeline + logging
│   ├── bead-runner.ts          # existing
│   ├── prompt-loader.ts        # existing
│   ├── types.ts                # extended with LogBeadOptions
│   └── prompts/
│       ├── analyze.md          # existing
│       ├── implement.md        # existing
│       ├── verify.md           # existing
│       ├── mr.md               # existing
│       └── log.md              # NEW: log bead — Confluence table update
tests/unit/
│   ├── git-harness.test.ts     # clone + cleanup lifecycle, temp dir isolation
│   ├── run-logger.test.ts      # JSONL format, field validation, append-only behavior
│   └── code-agent-runner.test.ts  # existing — no changes needed
```

### Pattern 1: Git Clone + Unconditional Cleanup (AGENT-01, AGENT-02)

**What:** Create a temp dir with `fs.mkdtemp`, run `git clone --depth 1` into it via `spawnWithTimeout`, then delete the dir unconditionally in `finally`.

**When to use:** Every run of `runCodeAgent`. The `finally` block must wrap the entire pipeline call, not just the git operations.

**Example:**

```typescript
// src/agent/git-harness.ts

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnWithTimeout } from "../utils/process.js";

export interface CloneResult {
  repoDir: string;
  handoffDir: string;
}

/**
 * Clones the target repo to a fresh temp directory.
 * Returns both the repo dir and a sibling handoff dir for JSON handoff files.
 *
 * AGENT-01: Fresh clone per run.
 * Clone depth: 1 (shallow) — faster, sufficient for tip-of-branch work.
 *
 * GIT_CONFIG_NOSYSTEM=1 is set to prevent system-level git configs
 * (e.g., credential helpers that open interactive prompts) from interfering.
 * SSH key-based auth via the host's ssh-agent is unaffected.
 */
export async function cloneRepo(
  repoUrl: string,
  gitlabToken: string | undefined,
): Promise<CloneResult> {
  const runId = Date.now().toString(36);
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), `night-shift-repo-${runId}-`));
  const handoffDir = await fs.mkdtemp(path.join(os.tmpdir(), `night-shift-handoff-${runId}-`));

  // Build env: GIT_CONFIG_NOSYSTEM prevents interactive credential prompts
  const cloneEnv: NodeJS.ProcessEnv = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK, // preserve ssh-agent
    GIT_CONFIG_NOSYSTEM: "1",
    ...(gitlabToken ? { GITLAB_TOKEN: gitlabToken } : {}),
  };

  const { result } = spawnWithTimeout(
    "git",
    ["clone", "--depth", "1", repoUrl, repoDir],
    { env: cloneEnv },
  );

  const cloneResult = await result;
  if (cloneResult.exitCode !== 0) {
    // Cleanup handoff dir immediately on clone failure; repoDir may be partially created
    await cleanupDir(repoDir);
    await cleanupDir(handoffDir);
    throw new Error(`git clone failed (exit ${cloneResult.exitCode}): ${cloneResult.stderr}`);
  }

  return { repoDir, handoffDir };
}

/**
 * Removes a directory unconditionally.
 *
 * AGENT-02: Called in finally blocks — must not throw.
 * fs.rm with { recursive: true, force: true } does not throw if the dir doesn't exist.
 */
export async function cleanupDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Swallow errors — cleanup must not propagate and mask the original error
  }
}
```

### Pattern 2: JSONL Local Run Log (LOG-01)

**What:** After `runCodeAgentPipeline` returns, the harness appends one JSON line to `.nightshift/logs/code-agent-runs.jsonl`. Written by TypeScript, never by a bead.

**When to use:** After every run, including NO_IMPROVEMENT runs. Written in the `finally` block or after cleanup so the log entry always appears.

**Example:**

```typescript
// src/agent/run-logger.ts

import fs from "node:fs/promises";
import path from "node:path";
import { getLogsDir, ensureDir } from "../core/paths.js";

export interface RunLogEntry {
  date: string;           // ISO 8601 — new Date().toISOString()
  category: string;       // e.g. "tests" or "refactoring (fallback from tests)"
  mr_url: string | null;  // MR URL or null when NO_IMPROVEMENT
  cost_usd: number;       // totalCostUsd from CodeAgentRunResult
  duration_seconds: number; // totalDurationMs / 1000
  summary: string;        // brief description of outcome
}

/**
 * Appends a single JSON line to the JSONL run log.
 *
 * LOG-01: One entry per run. File grows indefinitely (no rotation).
 * Location: .nightshift/logs/code-agent-runs.jsonl (resolved from process.cwd())
 */
export async function appendRunLog(
  entry: RunLogEntry,
  base: string = process.cwd(),
): Promise<void> {
  const logsDir = getLogsDir(base);
  await ensureDir(logsDir);
  const logPath = path.join(logsDir, "code-agent-runs.jsonl");
  await fs.appendFile(logPath, JSON.stringify(entry) + "\n", "utf-8");
}
```

### Pattern 3: Log Bead for Confluence Update (LOG-02)

**What:** A fifth Claude bead invoked after the MR bead (or after NO_IMPROVEMENT). It receives `--mcp-config` pointing at the locally configured Atlassian MCP server. It fetches the Confluence page, prepends a new Markdown table row, and updates the page.

**When to use:** Unconditionally — the log bead runs regardless of pipeline outcome. Even NO_IMPROVEMENT runs get a Confluence row.

**Key MCP tools the log bead uses:**
- `mcp__atlassian__getConfluencePage(cloudId, pageId, contentFormat: "markdown")` — fetches current body
- `mcp__atlassian__updateConfluencePage(cloudId, pageId, body, contentFormat: "markdown")` — pushes updated body

**Critical detail:** `mcp__atlassian__updateConfluencePage` requires `cloudId` and `pageId`. The `cloudId` can be found via `mcp__atlassian__getAccessibleAtlassianResources`. The log bead prompt must instruct the agent to discover the cloudId if not provided directly.

**Log bead invocation difference from other beads:**

```typescript
// In bead-runner.ts or code-agent.ts — the log bead gets --mcp-config
const logBeadArgs = [
  "-p", prompt,
  "--output-format", "json",
  "--dangerously-skip-permissions",
  "--no-session-persistence",
  "--allowedTools", "mcp__atlassian__getConfluencePage",
                    "mcp__atlassian__updateConfluencePage",
                    "mcp__atlassian__getAccessibleAtlassianResources",
  "--mcp-config", mcpConfigPath,
  "--model", "claude-sonnet-4-6",
];
```

**Log bead prompt structure (log.md):**

```markdown
## Context

You are the log bead of the night-shift code agent.
A run just completed. Your job is to record this run in the Confluence page.

## Run Record

- Date: {{date}}
- Category: {{category}}
- MR URL: {{mr_url}}
- Cost: ${{cost_usd}}
- Duration: {{duration_seconds}}s
- Summary: {{summary}}

## Your Task

1. Use `mcp__atlassian__getAccessibleAtlassianResources` to find the cloudId for this
   Confluence instance (use the first result).
2. Use `mcp__atlassian__getConfluencePage` with pageId `{{confluence_page_id}}` and
   `contentFormat: "markdown"` to fetch the current page body.
3. Find the existing table (columns: Date | Category | MR Link | Cost | Duration | Summary).
   If no table exists yet, create one with a header row.
4. Insert a new row at the TOP of the table (newest-first) with the run data above.
   Format the MR URL as a markdown link `[View MR]({{mr_url}})`, or "—" if no MR URL.
5. Use `mcp__atlassian__updateConfluencePage` with the updated body to save.

Do not modify any other content on the page outside the table.
```

### Pattern 4: Top-Level Harness Function

**What:** A new `runCodeAgent` function in `src/agent/code-agent.ts` that owns the full lifecycle: clone → pipeline → log → cleanup.

**Structural invariant:** The `finally` block deletes both `repoDir` and `handoffDir`. The local JSONL log is written before cleanup (it uses `CodeAgentRunResult` which is already available). The Confluence log bead is also invoked before cleanup (it needs to run while `handoffDir` is still accessible for MCP config path, if needed).

```typescript
// src/agent/code-agent.ts

export async function runCodeAgent(
  config: CodeAgentConfig,
  configDir: string,
  options: {
    gitlabToken?: string;
    mcpConfigPath?: string;
    timeoutMs: number;
    logger: Logger;
  },
): Promise<CodeAgentRunResult> {
  const { repoDir, handoffDir } = await cloneRepo(config.repoUrl, options.gitlabToken);

  try {
    const ctx: PipelineContext = {
      config,
      configDir,
      repoDir,
      handoffDir,
      gitlabToken: options.gitlabToken,
      timeoutMs: options.timeoutMs,
      logger: options.logger,
    };

    const result = await runCodeAgentPipeline(ctx);

    // LOG-01: Write local JSONL entry
    await appendRunLog({
      date: new Date().toISOString(),
      category: result.categoryUsed,
      mr_url: result.mrUrl ?? null,
      cost_usd: result.totalCostUsd,
      duration_seconds: Math.round(result.totalDurationMs / 1000),
      summary: result.reason ?? result.summary ?? result.outcome,
    });

    // LOG-02: Confluence log bead (runs regardless of outcome)
    if (options.mcpConfigPath) {
      await runLogBead(ctx, result, options.mcpConfigPath);
    }

    return result;
  } finally {
    // AGENT-02: Unconditional cleanup — even on crash or timeout
    await cleanupDir(repoDir);
    await cleanupDir(handoffDir);
  }
}
```

### Pattern 5: Log Bead Integration in bead-runner / code-agent-runner

The log bead differs from the other 4 beads in one key way: it needs `--mcp-config` and different `--allowedTools`. Two options:

**Option A (recommended):** Add a `runLogBead` function in `src/agent/code-agent.ts` (or a new `src/agent/log-bead.ts`) that calls `runBead` with extended options including `mcpConfigPath`. Extend `buildBeadArgs` to accept an optional `mcpConfigPath` parameter.

**Option B:** Inline the log bead invocation directly in `runCodeAgent` using a local `spawnWithTimeout` call.

Option A is preferred because it stays consistent with the bead pattern and allows testing via the existing mock infrastructure.

### Anti-Patterns to Avoid

- **Cleanup in non-finally location:** Putting `cleanupDir` calls only in the success path means crashes leave temp dirs forever. Always `finally`.
- **Log bead before MR bead:** The Confluence entry must contain the MR URL, which is only available after the MR bead. Log bead must be last.
- **Throwing in finally:** The `cleanupDir` function must swallow its own errors — if it throws, the original pipeline error gets replaced by the cleanup error, masking the root cause.
- **JSONL written by an agent bead:** The local log is structured data that must be correct. Delegating it to an agent introduces hallucination risk. The harness owns this.
- **Overwriting Confluence page body entirely:** The update must prepend a row to the existing table, not replace the whole page. The log bead must fetch first, modify, then update.
- **Interactive git clone:** Without `GIT_CONFIG_NOSYSTEM=1`, some system-level git configs can trigger interactive credential prompts that block the process. Always set this env var for git clone.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Confluence REST API client | Custom `fetch`-based HTTP client with auth | `mcp__atlassian__*` MCP tools via log bead | MCP Atlassian is already locally configured; handles auth, versioning, and pagination |
| JSONL serialization | Custom format, CSV, SQLite | `JSON.stringify(entry) + "\n"` | One-liner; JSONL is universally readable; no library needed |
| Temp dir management | Manual `path.join(os.tmpdir(), uuid)` without cleanup | `fs.mkdtemp` + `fs.rm` in `finally` | `mkdtemp` is atomic and avoids collisions; `fs.rm({ force: true })` is idempotent |
| Git remote authentication | Injecting HTTPS credentials into clone URL | SSH URL from config + `SSH_AUTH_SOCK` preserved in env | SSH key auth is the locked decision; token in URL leaks to process list and logs |
| Confluence table parsing | Custom Markdown parser for existing table | String insertion at first `\|` row boundary | The page uses plain Markdown table; simple string manipulation suffices |

**Key insight:** This phase is primarily wiring and shell orchestration. The heavy lifting (bead execution, prompt rendering, error handling) is already built in Phase 3. Phase 4 adds a thin harness layer around the existing pipeline.

---

## Common Pitfalls

### Pitfall 1: Temp Dir Leaked on Process Kill

**What goes wrong:** If the process receives `SIGKILL` (not `SIGTERM`), Node.js `finally` blocks do not run and temp dirs persist on disk.

**Why it happens:** `SIGKILL` cannot be caught. `finally` only runs for graceful termination.

**How to avoid:** Accept this limitation — it is documented behavior. On `SIGTERM`, the existing `spawnWithTimeout` sends `SIGTERM` then `SIGKILL` after 10s. Night-shift's own process receives `SIGTERM` and can register a `process.on('SIGTERM')` handler that triggers cleanup. However, this is a v2 enhancement — for v1, the `finally` block on `SIGTERM` is sufficient.

**Warning signs:** Accumulation of `/tmp/night-shift-*` directories after force kills. Can be cleaned by the OS tmpdir cleanup on reboot.

### Pitfall 2: GIT_CONFIG_NOSYSTEM Breaks System Credential Helper

**What goes wrong:** Some machines rely on a system-level credential helper (e.g., macOS Keychain, GNOME keyring) configured in `/etc/gitconfig`. Setting `GIT_CONFIG_NOSYSTEM=1` disables it. If the repo uses HTTPS URLs with token auth via a system credential helper, clone will fail with auth error.

**Why it happens:** The locked decision is SSH URL (`git@gitlab.com:...`). SSH key auth via `SSH_AUTH_SOCK` is unaffected by `GIT_CONFIG_NOSYSTEM`. The concern only applies to HTTPS repos.

**How to avoid:** The config schema enforces SSH URLs via regex (`/^git@.../`), so HTTPS repos are rejected at config validation time. Preserve `SSH_AUTH_SOCK` in the clone env.

**Warning signs:** Clone fails with `Permission denied (publickey)` — this is an ssh-agent issue, not GIT_CONFIG_NOSYSTEM. Check `SSH_AUTH_SOCK` is set in the harness env.

**STATE.md note:** This needs integration testing on the actual host machine (flagged as a known concern).

### Pitfall 3: Confluence Page Body Destructive Update

**What goes wrong:** The log bead fetches the Confluence page body, constructs a new table, and replaces the entire page body with only the new table — destroying all existing content.

**Why it happens:** LLM agents tend to rewrite rather than surgically edit. Without explicit instruction, the model may construct a clean table from scratch.

**How to avoid:** The log bead prompt must explicitly state: "Do not modify any content outside the table. Preserve all existing page content." The prompt should instruct the agent to insert only one new row at the top of the existing table, then call `updateConfluencePage` with the full modified body.

**Warning signs:** Confluence page has only one row and no other content after the first run.

### Pitfall 4: Confluence Page Macro Stripping

**What goes wrong:** Confluence may strip certain macro syntax or HTML from the page body during storage. If the existing page uses macros, the round-trip (fetch → modify → update) may corrupt the macro markup.

**Why it happens:** Confluence's storage format vs. display format mismatch. The MCP Atlassian tool uses `contentFormat: "markdown"` which is a simplified representation.

**How to avoid:** The locked decision is "append-only plain wiki markup" — keep the table as plain Markdown with no macros. Verify against the user's Confluence instance before pointing at the real log page (flagged in `STATE.md`).

**Warning signs:** Table formatting looks broken after the first update, or other page content disappears.

### Pitfall 5: Log Bead Fails, JSONL Already Written

**What goes wrong:** The local JSONL log is written successfully, but the Confluence log bead fails. The run is recorded locally but not in Confluence.

**Why it happens:** The log bead relies on external infrastructure (MCP server, Confluence API). Network errors, auth expiry, or MCP server issues can cause it to fail.

**How to avoid:** The local JSONL log is the authoritative record. The Confluence update is best-effort — log the failure but do not propagate it. Wrap the `runLogBead` call in a try/catch that logs the error and continues.

**Warning signs:** Confluence page not updated but `.nightshift/logs/code-agent-runs.jsonl` has the entry — this is acceptable behavior.

### Pitfall 6: Pipeline Context Missing Log Prompt Path

**What goes wrong:** The existing `PipelineContext` and `CodeAgentConfig` don't have a `log` prompt path. The log bead prompt needs to be added to the config schema alongside `analyze`, `implement`, `verify`, `mr`.

**Why it happens:** Phase 3 defined 4 beads. Phase 4 adds a 5th. The config schema must be extended.

**How to avoid:** Add `log: z.string().default("./prompts/log.md")` to the `prompts` object in `CodeAgentSchema`. Add `log` to the `CodeAgentConfig.prompts` TypeScript interface. Extend `mapConfig` in `config.ts`.

**Warning signs:** TypeScript errors on `config.prompts.log` access at compile time.

---

## Code Examples

Verified patterns from the existing codebase and official Node.js docs:

### Temp Dir Creation and Cleanup

```typescript
// Source: Node.js docs + existing paths.ts pattern
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Creation — atomic, collision-safe
const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "night-shift-repo-"));

// Cleanup — idempotent, non-throwing (force: true skips ENOENT errors)
await fs.rm(repoDir, { recursive: true, force: true });
```

### Git Clone via spawnWithTimeout

```typescript
// Source: src/agent/code-agent-runner.ts — resetRepo() pattern
const { result } = spawnWithTimeout(
  "git",
  ["clone", "--depth", "1", config.repoUrl, repoDir],
  {
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
      GIT_CONFIG_NOSYSTEM: "1",
    },
  },
);
const cloneResult = await result;
if (cloneResult.exitCode !== 0) {
  throw new Error(`git clone failed: ${cloneResult.stderr}`);
}
```

### JSONL Append

```typescript
// Source: Node.js fs/promises + existing patterns in paths.ts
import fs from "node:fs/promises";
import path from "node:path";

const logPath = path.join(logsDir, "code-agent-runs.jsonl");
const entry = {
  date: new Date().toISOString(),
  category: result.categoryUsed,
  mr_url: result.mrUrl ?? null,
  cost_usd: result.totalCostUsd,
  duration_seconds: Math.round(result.totalDurationMs / 1000),
  summary: result.reason ?? result.outcome,
};
await fs.appendFile(logPath, JSON.stringify(entry) + "\n", "utf-8");
```

### Log Bead Invocation (extends existing bead pattern)

```typescript
// Extends: src/agent/bead-runner.ts buildBeadArgs() pattern
// Key difference: --mcp-config flag + different --allowedTools
const logBeadArgs = [
  "-p", prompt,
  "--output-format", "json",
  "--dangerously-skip-permissions",
  "--no-session-persistence",
  "--allowedTools",
    "mcp__atlassian__getAccessibleAtlassianResources",
    "mcp__atlassian__getConfluencePage",
    "mcp__atlassian__updateConfluencePage",
  "--mcp-config", mcpConfigPath,
  "--model", "claude-sonnet-4-6",
];

const { result: logResult } = spawnWithTimeout("claude", logBeadArgs, {
  timeoutMs: ctx.timeoutMs,
  env: { HOME: process.env.HOME, PATH: process.env.PATH },
});
await logResult;
```

### glab mr create — Confirmed Flags (glab 1.79.0)

```bash
# Non-interactive MR creation — agent uses these flags in the MR bead
glab mr create \
  -t "[night-shift/tests] Add missing unit tests for parser module" \
  -d "## Summary\n\n..." \
  -l "night-shift,tests" \
  --reviewer "jsmith" \
  -b main \
  --yes  # skip confirmation prompt
```

Confirmed flags (verified against `glab mr create --help` on installed glab 1.79.0):
- `-t` / `--title` — MR title
- `-d` / `--description` — MR body (multi-line via `$'...'` or heredoc in bash)
- `-l` / `--label` — comma-separated or repeated
- `--reviewer` — GitLab usernames
- `-b` / `--target-branch` — target branch (default branch)
- `-y` / `--yes` — skip interactive confirmation (critical for non-interactive use)

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single git operation in one bead | Separate harness owns clone/cleanup; MR bead handles branch/commit/push/MR | Phase 4 design | Cleanup guaranteed even if MR bead crashes; harness has full control over temp dir lifetime |
| No run history | JSONL local log + Confluence page row | Phase 4 | Auditable history without a database; two formats for different consumers (local scripts vs. team visibility) |
| 4-bead pipeline | 5-bead pipeline (adds log bead) | Phase 4 | Confluence update uses existing MCP infrastructure; no custom API client |
| `fs.unlink` for file cleanup | `fs.rm({ recursive: true, force: true })` | Node.js 14.14+ | Replaces deprecated `fs.rmdir({ recursive: true })`; `force: true` is idempotent |

**Deprecated/outdated:**
- `fs.rmdir({ recursive: true })`: Deprecated since Node.js 16 — use `fs.rm({ recursive: true })` instead. Project targets Node >= 20.

---

## Open Questions

1. **MCP config path for the log bead**
   - What we know: The log bead needs `--mcp-config` pointing at the locally configured Atlassian MCP server. The path to the MCP config JSON file is not currently in `CodeAgentConfig`.
   - What's unclear: Should `mcp_config_path` be a new field in `code_agent` config, or should the log bead use the MCP config that night-shift itself is configured with?
   - Recommendation: Add `log_mcp_config: z.string().optional()` to `CodeAgentSchema`. If absent, skip the Confluence log bead and log a warning. This is the same optional pattern as `ntfy`.

2. **cloudId discovery for Confluence**
   - What we know: `mcp__atlassian__updateConfluencePage` requires `cloudId` (UUID or site URL). The log bead can call `mcp__atlassian__getAccessibleAtlassianResources` to find it.
   - What's unclear: Some teams have multiple Atlassian clouds. If there are multiple, which one to use?
   - Recommendation: Instruct the log bead to use the first accessible cloud. If multiple exist, the user can add `confluence_cloud_id` to `nightshift.yaml` as an optional config field for disambiguation.

3. **Log bead timeout**
   - What we know: The log bead makes 2 MCP calls (get + update). It should be fast (<30s).
   - What's unclear: Should it share the same `timeoutMs` as the other beads, or have a shorter dedicated timeout?
   - Recommendation: Use a fixed 2-minute timeout (120000ms) for the log bead — it is lighter than analyze/implement beads, and a generous timeout handles network latency.

4. **Summary field in JSONL log**
   - What we know: `CodeAgentRunResult` has `reason` (for NO_IMPROVEMENT) and `summary` (optional). Neither is required to be a short description.
   - What's unclear: What should the `summary` field in the log entry contain for `MR_CREATED` runs?
   - Recommendation: For `MR_CREATED`, use the first 100 characters of `analysis.selected.description` if available. For `NO_IMPROVEMENT`, use `result.reason`. For `ABANDONED`, use `"Abandoned after retries"`. The harness can derive this from `CodeAgentRunResult` without reading handoff files.

---

## Sources

### Primary (HIGH confidence)
- `/Users/julienderay/code/night-shift/src/agent/code-agent-runner.ts` — existing `PipelineContext`, `runCodeAgentPipeline`, `resetRepo` patterns
- `/Users/julienderay/code/night-shift/src/agent/bead-runner.ts` — `buildBeadEnv`, `buildBeadArgs`, `runBead` patterns
- `/Users/julienderay/code/night-shift/src/core/config.ts` — existing `CodeAgentSchema`, `mapConfig` patterns
- `/Users/julienderay/code/night-shift/src/core/paths.ts` — `getLogsDir`, `ensureDir` — log file location
- `/Users/julienderay/code/night-shift/src/utils/process.ts` — `spawnWithTimeout` interface
- `glab mr create --help` (glab 1.79.0 installed) — confirmed flags: `-t`, `-d`, `-l`, `--reviewer`, `-b`, `-y`
- `mcp__atlassian__getConfluencePage` / `mcp__atlassian__updateConfluencePage` — confirmed available via ToolSearch
- Node.js `fs/promises` — `mkdtemp`, `rm({ recursive, force })`, `appendFile` — standard APIs, Node >= 14.14

### Secondary (MEDIUM confidence)
- `/Users/julienderay/code/night-shift/.planning/STATE.md` — `GIT_CONFIG_NOSYSTEM=1` concern and Confluence macro-stripping concern flagged as known risks
- `/Users/julienderay/code/night-shift/.planning/phases/04-git-harness-and-logging/04-CONTEXT.md` — all locked decisions and Claude's discretion areas
- Atlassian MCP tool signatures verified via ToolSearch — `cloudId` required for get/update

### Tertiary (LOW confidence)
- Confluence macro-stripping behavior on update — depends on user's Confluence instance version and configuration; requires runtime validation per STATE.md

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all tools verified in installed binaries and codebase
- Architecture: HIGH — directly derived from locked CONTEXT.md decisions + existing Phase 3 patterns
- Git harness: HIGH — standard Node.js + git patterns; `spawnWithTimeout` already used for git in bead-runner
- JSONL logging: HIGH — trivial `appendFile`; no parsing, no library
- Confluence log bead: MEDIUM — MCP Atlassian tools confirmed available; exact prompt content and cloudId discovery flow need runtime validation
- Pitfalls: HIGH for structural pitfalls (cleanup in finally, destructive update); MEDIUM for environmental pitfalls (GIT_CONFIG_NOSYSTEM, Confluence macro behavior)

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (stable domain — Node.js APIs and git flags are stable; glab flags may change on major version bump)
