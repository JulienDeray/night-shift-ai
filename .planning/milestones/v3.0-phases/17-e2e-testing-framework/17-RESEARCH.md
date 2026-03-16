# Phase 17: E2E Testing Framework - Research

**Researched:** 2026-03-13
**Domain:** Vitest E2E process-level testing, Node.js subprocess management, HTTP mock servers
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Daemon lifecycle testing**
- Fork a real daemon process (same as `nightshift start` does) — tests interact via CLI commands and file-system state
- Detect daemon readiness by polling `daemon.json` for a fresh heartbeat timestamp
- Stop the daemon via CLI `nightshift stop` command — tests the real graceful shutdown path (SIGTERM → orchestrator.stop())
- Include crash recovery tests: SIGKILL the daemon, verify stale PID detection, confirm subsequent `nightshift start` recovers

**External mock strategy**
- **Claude CLI**: PATH shim script — create a mock `claude` shell script, prepend its directory to PATH in the test environment. The shim reads `MOCK_CLAUDE_RESPONSE_FILE` env var to load a canned JSON response file, allowing per-test configuration (success, failure, timeout simulation)
- **ntfy**: Start a localhost HTTP server in the test that records requests. Override ntfy URL in the test nightshift.yaml to point to localhost. Verify actual HTTP payloads sent
- **glab**: Not needed — glab is only invoked inside Claude sessions, and the mock claude shim short-circuits the entire agent execution. glab never runs in E2E tests

**Agent execution scope**
- Full pipeline depth: start daemon → submit agent → daemon picks up task → real manifest/prompt rendering → hits mock claude shim → generates inbox report → verify report content
- Multiple purpose-built test agents (NOT minimal stubs):
  - **Happy-path agent**: 1 step, succeeds — basic end-to-end verification
  - **Multi-step failure agent**: 2+ steps, first step fails — tests error handling and step failure reporting
  - **Retry/fallback agent**: Tests `retryFrom` (retry current step) and fallback to previous step after max retry attempts — exercises the engine's full retry logic
- Timeout testing: Use very short timeouts (1-2 seconds) in test manifests. Mock claude shim sleeps longer than the timeout to trigger timeout handling. Keeps tests fast
- Each test agent lives as a full agent directory with manifest.yaml and prompt files in the fixture directory

**Test organization**
- New `tests/e2e/` directory — separate from unit/ and integration/
- Separate vitest config: `vitest.e2e.config.ts` with longer timeout (60-120s)
- New npm script: `npm run test:e2e`
- `npm test` continues to run only unit + integration (fast)
- Fixture agents inside `tests/e2e/fixtures/` — co-located, self-contained
- Mock scripts (claude shim, response JSON files) also in fixtures
- Separate CI job in GitHub Actions — runs after unit+integration, doesn't block the fast tests

### Claude's Discretion
- Exact localhost HTTP server implementation for ntfy mock (http.createServer or similar)
- Mock claude shim script implementation details (bash script parsing env vars)
- How to structure the daemon helper utilities (start/waitForReady/stop/kill functions)
- Exact vitest.e2e.config.ts settings (timeout value, setup files, etc.)
- Poll interval and max wait time for daemon readiness detection
- Whether to add a shared test helper module for common E2E patterns

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-01 | E2E test harness that starts and stops a real daemon process | Daemon lifecycle helpers: start via `tsx bin/nightshift.ts start`, readiness via daemon.json poll, stop via CLI stop command |
| TEST-02 | Happy path test: daemon start -> agent submit -> execution -> output verification -> daemon stop | Full pipeline: PATH shim intercepts claude, inbox report written to `.nightshift/inbox/`, verified by reading file content |
| TEST-03 | CLI command tests: status, submit, cancel, schedule, inbox with expected output | Existing `run()` helper pattern in integration tests directly reusable; daemon running state enables richer status assertions |
| TEST-04 | Error scenario tests: agent failures, timeouts, invalid manifests | Failure agent (status:FAILED output), timeout agent (shim sleeps > manifest timeout), invalid manifest (missing prompt file) |
| TEST-05 | External service mocking: Claude CLI, GitLab, ntfy — no real calls during tests | Claude: PATH shim; ntfy: http.createServer localhost; glab: not needed (shim short-circuits) |
</phase_requirements>

---

## Summary

Phase 17 builds a full E2E test harness on top of the project's existing vitest + subprocess-based integration test foundation. The codebase already has a solid pattern: `spawnWithTimeout` wraps CLI subprocess calls, tests create real temp directories, and assertions check actual file-system state. The E2E layer extends this pattern by additionally managing a live daemon process lifecycle within each test suite.

The key technical challenge is daemon readiness detection. The daemon spawns as a detached process (via `spawn` with `detached: true`), writes a PID file, then begins writing periodic heartbeats to `daemon.json`. Tests must poll this file rather than relying on spawn return because the daemon init is async — manifest validation, directory setup, and the first heartbeat all happen after the process starts. A polling loop (e.g., 200ms interval, 30s max wait) checking that `daemon.json` exists with a `lastHeartbeat` within the last few seconds is the correct readiness signal.

The mock `claude` shim is the execution boundary. Since `step-runner.ts` calls `spawn("claude", ...)` with a sanitized `env` that preserves `PATH`, prepending a directory containing a mock `claude` script to the PATH env passed to the daemon is sufficient — no production code changes required. The shim receives the full prompt as `--p` argument, reads `MOCK_CLAUDE_RESPONSE_FILE` to load a canned response, and writes the Claude CLI JSON envelope format (`{ session_id, result, is_error, duration_ms, total_cost_usd, num_turns }`) to stdout with exit code 0.

**Primary recommendation:** Build the E2E suite as a thin orchestration layer on proven patterns — real subprocesses, real file system, real daemon process — with the mock boundary at PATH (for claude) and localhost HTTP (for ntfy). Keep test agents minimal but structurally complete (real manifest.yaml + real prompt files).

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^3.1.0 (already in devDeps) | Test runner, assertions | Already used for unit + integration tests |
| node:child_process | built-in | Spawn daemon process | Already used via `spawnWithTimeout` |
| node:http | built-in | Localhost ntfy mock server | No dependency needed |
| node:fs/promises | built-in | Temp dirs, file assertions | Already used in all existing tests |

### No New Dependencies Required
The E2E suite needs zero new npm packages. All required capabilities are available from Node.js built-ins and the existing vitest setup.

**Installation:**
```bash
# No new packages — use existing stack
```

---

## Architecture Patterns

### Recommended Project Structure
```
tests/
├── e2e/
│   ├── fixtures/
│   │   ├── agents/
│   │   │   ├── happy-path-agent/
│   │   │   │   ├── manifest.yaml
│   │   │   │   └── prompts/
│   │   │   │       └── run.md
│   │   │   ├── multi-step-failure-agent/
│   │   │   │   ├── manifest.yaml
│   │   │   │   └── prompts/
│   │   │   │       ├── step1.md
│   │   │   │       └── step2.md
│   │   │   └── retry-agent/
│   │   │       ├── manifest.yaml
│   │   │       └── prompts/
│   │   │           ├── work.md
│   │   │           └── review.md
│   │   └── mock-claude/
│   │       ├── claude            # shell script shim (chmod +x)
│   │       └── responses/
│   │           ├── success.json
│   │           ├── failure.json
│   │           └── slow.sh       # or sleep handled inside shim
│   ├── helpers/
│   │   ├── daemon.ts             # startDaemon, waitForReady, stopDaemon, killDaemon
│   │   ├── ntfy-server.ts        # createNtfyMockServer, getRecordedRequests
│   │   └── config.ts             # writeE2EConfig, writeAgentsDir
│   ├── lifecycle.test.ts         # TEST-01: daemon start/stop/crash recovery
│   ├── happy-path.test.ts        # TEST-02: full pipeline end-to-end
│   ├── cli-commands.test.ts      # TEST-03: status, submit, cancel, schedule, inbox
│   └── error-scenarios.test.ts   # TEST-04 + TEST-05: failures, timeouts, invalid manifests
vitest.e2e.config.ts
```

### Pattern 1: Daemon Lifecycle Helpers
**What:** Module that encapsulates daemon start/wait/stop/kill in reusable async functions.
**When to use:** All E2E tests that need a running daemon — use in `beforeEach`/`afterEach` hooks.
**Example:**
```typescript
// tests/e2e/helpers/daemon.ts
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { readDaemonState } from "../../../src/daemon/health.js";

export interface DaemonHandle {
  pid: number | undefined;
  cwd: string;
}

/**
 * Starts the nightshift daemon in the given cwd, with a prepended mock claude PATH.
 * Returns after the daemon has written its first heartbeat (ready signal).
 */
export async function startDaemon(cwd: string, mockClaudeDir: string): Promise<DaemonHandle> {
  const bin = path.resolve("bin/nightshift.ts");
  const child = spawn("npx", ["tsx", bin, "start"], {
    cwd,
    env: {
      ...process.env,
      PATH: `${mockClaudeDir}:${process.env.PATH}`,
    },
    stdio: "ignore",
  });

  // Wait for daemon to detach (start command exits after confirming PID is alive)
  await new Promise<void>((resolve, reject) => {
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`nightshift start exited with code ${code}`));
    });
    child.on("error", reject);
  });

  // Poll daemon.json for a fresh heartbeat — daemon is ready when this appears
  await waitForDaemonReady(cwd);

  const state = await readDaemonState(cwd);
  return { pid: state?.pid, cwd };
}

const POLL_INTERVAL_MS = 200;
const MAX_WAIT_MS = 30_000;

export async function waitForDaemonReady(cwd: string): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  const daemonJsonPath = path.join(cwd, ".nightshift", "daemon.json");

  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(daemonJsonPath, "utf-8");
      const state = JSON.parse(raw);
      const age = Date.now() - new Date(state.lastHeartbeat).getTime();
      if (state.status === "running" && age < 5000) return;
    } catch {
      // file not yet written — keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Daemon did not become ready within ${MAX_WAIT_MS}ms`);
}

export async function stopDaemon(cwd: string): Promise<void> {
  const bin = path.resolve("bin/nightshift.ts");
  const { spawnWithTimeout } = await import("../../../src/utils/process.js");
  const { result } = spawnWithTimeout("npx", ["tsx", bin, "stop"], {
    timeoutMs: 15_000,
    cwd,
  });
  await result;
}

export async function killDaemon(cwd: string): Promise<void> {
  const state = await readDaemonState(cwd);
  if (state?.pid) {
    try { process.kill(state.pid, "SIGKILL"); } catch { /* already dead */ }
  }
}
```

### Pattern 2: Claude PATH Shim
**What:** A shell script placed in a temp `bin/` directory that is prepended to PATH for the daemon process. The shim reads `MOCK_CLAUDE_RESPONSE_FILE` to return a canned JSON response.
**When to use:** All E2E tests — the daemon never calls the real `claude` binary.
**Example:**
```bash
#!/usr/bin/env bash
# tests/e2e/fixtures/mock-claude/claude
# Mock claude CLI shim for E2E tests.
# Reads MOCK_CLAUDE_RESPONSE_FILE for the JSON response to emit.
# Reads MOCK_CLAUDE_SLEEP_MS to simulate slow responses (for timeout tests).

if [ -n "$MOCK_CLAUDE_SLEEP_MS" ]; then
  sleep_secs=$(echo "scale=3; $MOCK_CLAUDE_SLEEP_MS/1000" | bc)
  sleep "$sleep_secs"
fi

if [ -z "$MOCK_CLAUDE_RESPONSE_FILE" ]; then
  echo '{"session_id":"mock","result":"```json\n{\"result\":\"ok\"}\n```","is_error":false,"duration_ms":100,"total_cost_usd":0,"num_turns":1}'
  exit 0
fi

cat "$MOCK_CLAUDE_RESPONSE_FILE"
```

**Critical details:**
- Script must be `chmod +x` — vitest fixture setup must ensure this
- The JSON output must match the `ClaudeJsonOutput` shape in `step-runner.ts`: `{ session_id, result, is_error, duration_ms, total_cost_usd, num_turns }`
- The `result` field must contain the actual step output — typically a markdown string with a JSON code block matching the step's `outputSchema`
- `buildStepEnv()` in `step-runner.ts` passes only `HOME, PATH, USER, LANG, SHELL, TERM` to claude — so `MOCK_CLAUDE_RESPONSE_FILE` must be set via `env` in the daemon spawn, not inherited from test process environment

**Important:** Since `buildStepEnv` constructs a minimal allowlist env, `MOCK_CLAUDE_RESPONSE_FILE` will be passed only if the test nightshift.yaml declares it as an env var on the step OR if it is included in the step env. The cleanest approach: include `MOCK_CLAUDE_RESPONSE_FILE` in the daemon's process env (via PATH-prepend), and ensure `buildStepEnv` allows it through. Since `buildStepEnv` only allows specific keys, the shim should instead read from a well-known file path passed via a path known to the shim at fixture construction time — OR the test can set the response file path in a fixture location that the shim reads by default.

**Revised approach:** Set a fixed temp file path as the response file location, write response content there per-test, and hard-code the path in the shim (or read it from a env var that IS in the allowed list — checking `buildStepEnv`, it allows `HOME`, so using `$HOME/.mock-claude-response` would work but is fragile). The cleanest solution: the shim reads a known fixture path. Each test writes the appropriate response JSON to that path before the daemon processes a task. Since the response file location is fixed at fixture setup time, tests can update it between task submissions.

**Alternative cleaner approach:** Override `MOCK_CLAUDE_RESPONSE_FILE` by setting it as an explicit step env var in each test agent's manifest:
```yaml
steps:
  - name: run
    prompt: prompts/run.md
    env:
      - name: MOCK_CLAUDE_RESPONSE_FILE
        value: /tmp/ns-e2e-response.json
```
This passes through `buildStepEnv` explicitly. The test writes to `/tmp/ns-e2e-response.json` before submitting the task.

### Pattern 3: ntfy Mock Server
**What:** A Node.js `http.createServer` listener that records all POST requests.
**When to use:** Tests that verify ntfy notifications are (or aren't) sent.
**Example:**
```typescript
// tests/e2e/helpers/ntfy-server.ts
import http from "node:http";

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

export interface NtfyMockServer {
  port: number;
  getRequests: () => RecordedRequest[];
  close: () => Promise<void>;
}

export async function createNtfyMockServer(): Promise<NtfyMockServer> {
  const requests: RecordedRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { parsed = body; }
      requests.push({ method: req.method ?? "?", path: req.url ?? "/", body: parsed });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "mock-id" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  return {
    port,
    getRequests: () => [...requests],
    close: () => new Promise((resolve, reject) =>
      server.close((err) => err ? reject(err) : resolve())
    ),
  };
}
```

### Pattern 4: E2E Config Writer
**What:** Helper that writes the nightshift.yaml for each test, pointing to the local agent fixtures and mock ntfy server.
**When to use:** In `beforeEach` for any test that needs a fully configured workspace.
**Example:**
```typescript
export async function writeE2EConfig(
  tmpDir: string,
  options: { ntfyPort?: number; pollIntervalMs?: number } = {}
): Promise<void> {
  const ntfyBlock = options.ntfyPort ? `
ntfy:
  topic: test-topic
  baseUrl: http://127.0.0.1:${options.ntfyPort}
` : "";

  const config = `workspace: ./workspace
inbox: ./inbox
max_concurrent: 2
default_timeout: "30m"

daemon:
  poll_interval_ms: ${options.pollIntervalMs ?? 500}
  heartbeat_interval_ms: 1000
  log_retention_days: 30

agents_dir: ./agents
agents:
  - name: happy-path-agent
schedule: []

one_off_defaults:
  timeout: "30m"
${ntfyBlock}`;
  await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), config);
}
```

**Key insight:** Set `poll_interval_ms` very low (500ms) in E2E test config so the daemon picks up tasks quickly without long waits. The default 30s poll interval would make tests take minutes.

### Pattern 5: Task Completion Polling
**What:** Poll the inbox directory for a report file after submitting a task, with a timeout.
**When to use:** Any test that needs to verify task execution completed.
**Example:**
```typescript
export async function waitForInboxReport(
  cwd: string,
  taskNamePattern: RegExp,
  timeoutMs = 30_000,
): Promise<string> {
  const inboxDir = path.join(cwd, ".nightshift", "inbox");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const files = await fs.readdir(inboxDir);
      const match = files.find((f) => taskNamePattern.test(f));
      if (match) {
        return fs.readFile(path.join(inboxDir, match), "utf-8");
      }
    } catch { /* inbox dir may not exist yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No inbox report matching ${taskNamePattern} within ${timeoutMs}ms`);
}
```

### Pattern 6: vitest.e2e.config.ts
**What:** Separate vitest config that only includes `tests/e2e/**/*.test.ts` with extended timeouts.
**Example:**
```typescript
// vitest.e2e.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 120_000,   // 2 minutes per test — daemon lifecycle tests are slow
    hookTimeout: 30_000,    // 30s for beforeEach/afterEach
    pool: "forks",          // process isolation — daemon state doesn't bleed between tests
    poolOptions: {
      forks: {
        singleFork: true,   // run e2e tests serially — daemon ports/PIDs must not conflict
      },
    },
    reporters: ["verbose"],
  },
});
```

**Critical:** Run E2E tests serially (`singleFork: true`) to avoid multiple daemons competing for the same temp dir or port. Each test suite creates its own temp dir, so parallelism within a suite is fine, but cross-file parallelism risks flaky failures.

### Anti-Patterns to Avoid
- **Parallelizing E2E tests across files:** Multiple daemon processes writing to the same system dirs will conflict. Use `singleFork: true`.
- **Using fixed ports for ntfy mock:** Use port 0 (OS-assigned) to avoid conflicts when tests run concurrently or repeatedly.
- **Not setting poll_interval_ms low:** Default 30s poll interval means a 30s wait per task pickup. Set it to 500ms in test config.
- **Hard-coding daemon.json state path from process.cwd():** The daemon reads config from `process.cwd()`, which is set to `tmpDir` via the spawn cwd. Helpers must pass the `tmpDir` base consistently when calling path utilities.
- **Not cleaning up daemon on test failure:** Use `afterEach` that calls `killDaemon` unconditionally — not just `stopDaemon` — as a safety net.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP mock server | Custom HTTP library | `node:http createServer` | Built-in, zero deps, records raw requests |
| Process timeout | Custom timer logic | `spawnWithTimeout` (already exists) | Handles SIGTERM + forced SIGKILL fallback |
| Temp directory cleanup | Manual rm -rf | `fs.rm(tmpDir, { recursive: true, force: true })` | Same pattern used in all existing tests |
| JSON output from shim | Custom JSON builder | Hardcode the `ClaudeJsonOutput` envelope shape | Fixed format, validated by `step-runner.ts` |

**Key insight:** The existing integration test patterns in `tests/integration/` are the reference implementation. The E2E layer adds daemon lifecycle management on top — it does not reinvent anything.

---

## Common Pitfalls

### Pitfall 1: MOCK_CLAUDE_RESPONSE_FILE Not Reaching the Shim
**What goes wrong:** `buildStepEnv` in `step-runner.ts` builds a whitelist env (`HOME, PATH, USER, LANG, SHELL, TERM`) — arbitrary env vars are stripped. The shim cannot read `MOCK_CLAUDE_RESPONSE_FILE` from the environment unless it is explicitly declared in the step's manifest `env` block.
**Why it happens:** Security feature — only declared env vars reach claude. Unanticipated for mocking.
**How to avoid:** Declare `MOCK_CLAUDE_RESPONSE_FILE` in each test agent's manifest as an explicit `env` entry (name/value syntax). Set the value to a path under the fixture directory (e.g., `tests/e2e/fixtures/mock-claude/responses/success.json`). Or pass a per-test path known at test-write time. Tests that need different responses must use different response file paths OR update the file between task submissions.
**Warning signs:** Shim executes but produces its default response regardless of test configuration.

### Pitfall 2: Daemon Not Ready When First Task is Submitted
**What goes wrong:** `waitForDaemonReady` returns but the daemon hasn't completed `validateAgentsAtStartup` yet — subsequent task submissions get picked up before the poll loop is truly running.
**Why it happens:** `daemon.json` heartbeat is written before `validateAgentsAtStartup` completes and before the poll loop starts.
**How to avoid:** Check `lastHeartbeat` age AND `status === "running"` in the readiness poll. Add a small additional wait (200ms) after readiness is confirmed before submitting the first task.
**Warning signs:** Tasks remain in "pending" state for the full timeout.

### Pitfall 3: Daemon Left Running After Test Failure
**What goes wrong:** A test that times out or throws in `beforeEach` leaves a daemon process running. The next test's `nightshift start` reports "already running" and fails.
**Why it happens:** `afterEach` only runs for tests that complete normally in some configurations; unhandled errors during `beforeEach` may skip `afterEach`.
**How to avoid:** In `afterEach`, call `killDaemon(tmpDir)` unconditionally as a safety net even if `stopDaemon` was already called. `killDaemon` is idempotent.
**Warning signs:** Second E2E test consistently fails with "Daemon already running".

### Pitfall 4: Inbox Report Not Found Due to Task Name Sanitization
**What goes wrong:** `writeReport` in `reporter.ts` uses `sanitize(task.name)` which replaces non-alphanumeric chars with `-`. The test's `taskNamePattern` regex doesn't match the sanitized name.
**Why it happens:** Task name submitted via CLI vs. auto-generated name (format: `{agentName}-{taskId}`).
**How to avoid:** Use partial patterns that match the agent name: `new RegExp(agentName)`. The inbox filename format is `{date}_{sanitizedName}_{shortId}.md`.
**Warning signs:** `waitForInboxReport` times out even though the report was written.

### Pitfall 5: Daemon spawn cwd vs. process.cwd()
**What goes wrong:** The daemon uses `process.cwd()` for all path resolution (config loading, queue dir, inbox dir). If the daemon is spawned with a different cwd than the test's tmpDir, paths diverge.
**Why it happens:** `start.ts` does `cwd: process.cwd()` when spawning the daemon — this is the cwd of the nightshift start CLI process, which is the tmpDir in tests.
**How to avoid:** Always run `nightshift start` with `cwd: tmpDir` in the spawn options — exactly as done in `start.ts`. The start command's cwd becomes the daemon's cwd.
**Warning signs:** "nightshift.yaml not found" errors in daemon logs.

### Pitfall 6: Shim Script Not Executable
**What goes wrong:** The fixture `claude` script exists but is not `chmod +x`, so PATH resolution finds it but cannot execute it.
**Why it happens:** Git does not preserve execute bits reliably on all platforms/configurations.
**How to avoid:** In test `beforeEach` (or a vitest `globalSetup`), run `chmod +x` on the shim script:
```typescript
await fs.chmod(claudeShimPath, 0o755);
```
**Warning signs:** `EACCES` error in daemon logs, tasks fail immediately.

### Pitfall 7: heartbeatIntervalMs Too Long for Test Readiness Detection
**What goes wrong:** With the default 10s heartbeat interval, `waitForDaemonReady` waits up to 10s before the first heartbeat appears, blowing test timeout budgets.
**Why it happens:** Default config is tuned for production, not tests.
**How to avoid:** Set `heartbeat_interval_ms: 1000` in test nightshift.yaml. The daemon writes a heartbeat immediately on start (before the interval timer fires), so this is mainly relevant for the "age < 5000" check in readiness detection.

---

## Code Examples

Verified patterns from existing codebase:

### Claude JSON Envelope Shape (from step-runner.ts)
```typescript
// The shim must emit this shape on stdout with exit code 0
interface ClaudeJsonOutput {
  session_id: string;
  duration_ms: number;
  total_cost_usd: number;
  result: string;      // contains the step's markdown output with JSON code block
  is_error: boolean;
  num_turns: number;
}

// Example success response for a step with outputSchema: { result: string }
const successResponse = JSON.stringify({
  session_id: "mock-session",
  result: '```json\n{"result":"mock output"}\n```',
  is_error: false,
  duration_ms: 100,
  total_cost_usd: 0,
  num_turns: 1,
});
```

### Failure Agent Response (semantic failure)
```typescript
// A step output with status: "FAILED" triggers engine's semantic failure path
// See engine.ts: if (parsed.status === "FAILED") → FATAL result
const failureResponse = JSON.stringify({
  session_id: "mock-session",
  result: '```json\n{"status":"FAILED","error":"mock failure reason"}\n```',
  is_error: false,
  duration_ms: 100,
  total_cost_usd: 0,
  num_turns: 1,
});
// outputSchema must include: { status: string, error: string }
```

### Timeout Agent Response
```bash
#!/usr/bin/env bash
# claude shim for timeout test — sleeps longer than the manifest timeout
# The manifest timeout is 1-2s. Sleep 10s so the daemon's timeout fires.
sleep 10
```

### Retry Agent Response (passed: false triggers retry)
```typescript
// Step output with passed: false triggers step.retry logic in engine.ts
const retryFailResponse = JSON.stringify({
  session_id: "mock-session",
  result: '```json\n{"passed":false,"error_details":"validation failed"}\n```',
  is_error: false,
  duration_ms: 100,
  total_cost_usd: 0,
  num_turns: 1,
});
// After maxAttempts retries, the engine continues to the next step normally
```

### Happy Path Agent Manifest
```yaml
# tests/e2e/fixtures/agents/happy-path-agent/manifest.yaml
name: happy-path-agent
description: Single-step agent for happy-path E2E verification
steps:
  - name: run
    prompt: prompts/run.md
    timeout: "30s"
    outputSchema:
      type: object
      properties:
        result:
          type: string
      required: [result]
    env:
      - name: MOCK_CLAUDE_RESPONSE_FILE
        value: "{{MOCK_RESPONSE_PATH}}"  # injected via task variables or fixed path
```

### Inbox Report Assertions (from reporter.ts frontmatter)
```typescript
// Inbox reports use YAML frontmatter
// Parse to verify key fields:
const report = await waitForInboxReport(tmpDir, /happy-path-agent/);
expect(report).toContain("status: completed");
expect(report).toContain("agent_name: happy-path-agent");
expect(report).toContain("step_count: 1");
// Check Result section for mock output
expect(report).toContain("mock output");
```

### Existing run() Helper (reuse from integration tests)
```typescript
// Established pattern — reuse in E2E tests
function run(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv } = { cwd: tmpDir }
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const bin = path.resolve("bin/nightshift.ts");
  const { result } = spawnWithTimeout("npx", ["tsx", bin, ...args], {
    timeoutMs: 15_000,
    cwd: options.cwd,
    env: options.env ?? process.env,
  });
  return result;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Integration tests call CLI directly, no daemon | E2E tests also manage daemon lifecycle | Phase 17 | Tests cover real async execution path |
| Unit tests mock `spawnWithTimeout` | E2E tests use real PATH shim for claude | Phase 17 | No production code changes needed for mocking |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.1.0 |
| Config file | `vitest.e2e.config.ts` — Wave 0 gap (must be created) |
| Quick run command | `npx vitest run --config vitest.e2e.config.ts --reporter=verbose tests/e2e/lifecycle.test.ts` |
| Full suite command | `npm run test:e2e` (script must be added to package.json in Wave 0) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | Daemon starts, heartbeat appears, stop command terminates it | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/lifecycle.test.ts` | ❌ Wave 0 |
| TEST-01 | SIGKILL daemon, stale PID detected, restart recovers | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/lifecycle.test.ts` | ❌ Wave 0 |
| TEST-02 | Full pipeline: start → submit → execution → inbox report | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/happy-path.test.ts` | ❌ Wave 0 |
| TEST-03 | `nightshift status` shows running daemon state | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/cli-commands.test.ts` | ❌ Wave 0 |
| TEST-03 | `nightshift submit` + `nightshift cancel` with live daemon | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/cli-commands.test.ts` | ❌ Wave 0 |
| TEST-03 | `nightshift inbox` lists reports after execution | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/cli-commands.test.ts` | ❌ Wave 0 |
| TEST-04 | Agent failure (status: FAILED) → report shows failed status | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/error-scenarios.test.ts` | ❌ Wave 0 |
| TEST-04 | Timeout agent → report shows timed-out status | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/error-scenarios.test.ts` | ❌ Wave 0 |
| TEST-04 | Invalid manifest → daemon startup validation rejects it | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/error-scenarios.test.ts` | ❌ Wave 0 |
| TEST-05 | No real `claude` binary called — PATH shim intercepts all invocations | e2e | Verified by watching shim invocation log | ❌ Wave 0 |
| TEST-05 | ntfy POST captured by localhost mock server | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/happy-path.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --config vitest.e2e.config.ts tests/e2e/lifecycle.test.ts` (smoke: daemon lifecycle only)
- **Per wave merge:** `npm run test:e2e` (full E2E suite)
- **Phase gate:** Full E2E suite green + `npm test` (unit+integration) green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.e2e.config.ts` — root-level vitest config for E2E suite
- [ ] `package.json` `test:e2e` script — `vitest run --config vitest.e2e.config.ts`
- [ ] `tests/e2e/helpers/daemon.ts` — daemon lifecycle helper (startDaemon, waitForReady, stopDaemon, killDaemon)
- [ ] `tests/e2e/helpers/ntfy-server.ts` — localhost HTTP mock server helper
- [ ] `tests/e2e/fixtures/mock-claude/claude` — shell script shim (chmod +x)
- [ ] `tests/e2e/fixtures/mock-claude/responses/success.json` — canned success response
- [ ] `tests/e2e/fixtures/mock-claude/responses/failure.json` — canned semantic failure response
- [ ] `tests/e2e/fixtures/agents/happy-path-agent/` — full agent directory with manifest.yaml + prompt
- [ ] `tests/e2e/fixtures/agents/multi-step-failure-agent/` — multi-step agent with failure step
- [ ] `tests/e2e/fixtures/agents/retry-agent/` — agent with retry config in manifest
- [ ] `tests/e2e/lifecycle.test.ts` — covers TEST-01
- [ ] `tests/e2e/happy-path.test.ts` — covers TEST-02, TEST-05
- [ ] `tests/e2e/cli-commands.test.ts` — covers TEST-03
- [ ] `tests/e2e/error-scenarios.test.ts` — covers TEST-04

---

## Open Questions

1. **MOCK_CLAUDE_RESPONSE_FILE env propagation**
   - What we know: `buildStepEnv` whitelist strips arbitrary env vars; only `HOME, PATH, USER, LANG, SHELL, TERM` pass through by default; step env in manifest can explicitly pass additional vars
   - What's unclear: Whether it's better to use manifest-declared env vars vs. a fixed file path vs. a per-test fixture directory convention
   - Recommendation: Use fixed per-agent response file paths declared in the manifest `env` block (name/value syntax). This keeps test agent manifests self-contained and makes per-test response switching explicit.

2. **Daemon start in E2E vs. `npx tsx nightshift.ts start`**
   - What we know: `start.ts` spawns the daemon using `dist/daemon/index.js` (compiled JS), not `tsx`. In test environments where `dist/` may not exist, this path fails.
   - What's unclear: Whether to build before running E2E tests, or to modify the start approach for tests.
   - Recommendation: Run `npm run build` before `npm run test:e2e` in CI. Alternatively, the E2E helper can spawn the daemon directly via `npx tsx src/daemon/index.ts` rather than going through the `start` command — this bypasses the compiled path issue. The CONTEXT.md says "Fork a real daemon process (same as `nightshift start` does)" — spawning it directly via tsx is equivalent and avoids the build dependency.

---

## Sources

### Primary (HIGH confidence)
- Codebase: `src/agent/step-runner.ts` — `buildStepEnv` whitelist, `ClaudeJsonOutput` shape, spawn("claude") invocation
- Codebase: `src/cli/commands/start.ts` — daemon spawn pattern, detached process, `cwd: process.cwd()`
- Codebase: `src/daemon/health.ts` — `daemon.json` state shape, `isDaemonRunning`, heartbeat staleness logic
- Codebase: `src/daemon/orchestrator.ts` — `pollIntervalMs` controls task pickup frequency, heartbeat write timing
- Codebase: `src/agent/engine.ts` — semantic failure detection (status:FAILED), retry logic (passed:false), timeout handling
- Codebase: `src/inbox/reporter.ts` — inbox filename pattern, frontmatter fields for assertion
- Codebase: `tests/integration/submit.test.ts` — `run()` helper, `writeConfig()`, temp dir lifecycle patterns
- Codebase: `vitest.config.ts` — existing vitest configuration baseline

### Secondary (MEDIUM confidence)
- Vitest docs: `pool: "forks"` with `singleFork: true` for serial test execution — standard for process-level E2E tests

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, entire stack is project-internal and node built-ins
- Architecture: HIGH — directly derived from reading production code and existing test patterns
- Pitfalls: HIGH — all pitfalls discovered by reading actual source code (buildStepEnv whitelist, daemon.json timing, etc.)

**Research date:** 2026-03-13
**Valid until:** Stable — no external dependencies; valid until codebase changes
