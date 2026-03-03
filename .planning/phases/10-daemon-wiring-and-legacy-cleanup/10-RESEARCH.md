# Phase 10: Daemon Wiring and Legacy Cleanup - Research

**Researched:** 2026-03-03
**Domain:** TypeScript daemon dispatch refactoring — replace AgentRunner with AgentEngine, implement scheduler, delete legacy code
**Confidence:** HIGH — all findings are from direct codebase inspection

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Dispatch routing:**
- Agent-only dispatch: every task must specify an `agentName`. Tasks without `agentName` are rejected (no generic `AgentRunner` fallback)
- `AgentPool.dispatch()` creates/uses `AgentEngine` to run manifest-driven agents. The pool owns the engine lifecycle
- `AgentRunner` is deleted entirely — all `claude -p` invocations go through `StandardBeadPlugin` inside the engine
- `agentName` stays optional on `NightShiftTask` type-wise (plain submits still queue, but dispatch rejects if no agent specified)

**Result bridging:**
- Orchestrator and AgentPool adopt `AgentRunResult` natively — no adapter layer
- `AgentExecutionResult` is deleted from `core/types.ts`
- `TaskResult` wraps `AgentRunResult` instead of `AgentExecutionResult`
- Notifications use the final bead output summary (e.g., MR URL for code-agent, truncated output string for others)
- Inbox reports show rich per-bead data: per-bead timing, status, and the final output

**Category fallback wiring:**
- Category fallback logic lives in the Orchestrator (not in the engine)
- Orchestrator calls `AgentEngine` per category. If result is `NO_IMPROVEMENT`, orchestrator dispatches a new task for the next fallback category
- Each fallback category attempt is a separate task in the pool, with its own inbox report and notification
- Fallback category order is per-agent in `nightshift.yaml` (e.g., `fallback_categories: [tests, refactoring, docs, security, performance]`). Agents without it skip fallback
- `Scheduler.evaluateSchedules()` is unwired from the Phase 7 `[]` stub — reads `config.schedule` entries, resolves cron, creates `NightShiftTask` with `agentName` and schedule-level variables

**Legacy cleanup:**
- Delete `code-agent.ts` and `code-agent-runner.ts` from `src/agent/`
- Delete `AgentRunner` from `src/daemon/agent-runner.ts`
- Delete `AgentExecutionResult` from `core/types.ts`
- Delete all code-agent-specific types: `CodeAgentConfig`, `CategoryScheduleConfig`, `PipelineContext`, `CodeAgentRunResult` from `src/agent/types.ts`
- JSONL run logger (`appendRunLog`) survives — moved to orchestrator as a post-run hook for every agent run (agent-agnostic)
- `nightshift run` CLI command is rewritten to use `AgentEngine` directly: `nightshift run --agent code-agent` runs in foreground, no daemon needed

### Claude's Discretion
- How AgentPool instantiates/caches AgentEngine instances (one per agent name, or fresh per run)
- Exact fallback task creation logic in orchestrator (naming, variable merging)
- How `nightshift submit` validates that `--agent` is provided (CLI-level error or pool-level rejection)
- JSONL log entry format adaptation for generic agents
- Cleanup of any remaining dead imports and unused utilities after deletion

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WIRE-01 | `AgentPool.dispatch()` routes tasks with `agentName` to `AgentEngine` instead of hardcoded `runCodeAgent` | AgentPool.dispatch() currently uses AgentRunner unconditionally; AgentEngine.run() is the drop-in replacement that takes agentDir, agentsRoot, taskId, configOverrides |
| WIRE-02 | Legacy `code-agent.ts` and `code-agent-runner.ts` are removed after migration is validated | Both files exist in `src/agent/`; their types (CodeAgentConfig, etc.) are in `src/agent/types.ts`; AgentRunner lives in `src/daemon/agent-runner.ts`; all have test coverage that needs updating |
</phase_requirements>

---

## Summary

Phase 10 is a pure internal refactoring — no new features, no API changes visible to end users. The codebase has fully built the `AgentEngine` + `BeadRegistry` + plugins system (Phases 6-9) and migrated the code-agent to a manifest-driven directory (`agents/code-agent/`). What remains is connecting the daemon dispatch path to this new infrastructure and deleting the legacy hardwired code path.

The central change is in `AgentPool.dispatch()`. Currently it instantiates `AgentRunner` for every task unconditionally. After this phase, it instantiates `AgentEngine` (with a `BeadRegistry` containing `StandardBeadPlugin` and `GitCloneBeadPlugin`) for every task that has an `agentName`, and rejects tasks that have none. The `TaskResult` type must change from wrapping `AgentExecutionResult` to wrapping `AgentRunResult<unknown>`.

The second major change is `Scheduler.evaluateSchedules()`, which was left as a `return []` stub in Phase 7. The `config.schedule` array (of `ScheduleEntry` entries, each with `agent`, `cron`, `variables`, `enabled`, `notify`) is already fully parsed and validated by `loadConfig()`. The scheduler just needs to iterate these entries, use `croner`'s `Cron.msToNext()` to evaluate whether a schedule is due, and emit `NightShiftTask` objects with `agentName` set.

The test surface is significant: `agent-pool.test.ts`, `agent-runner.test.ts`, `orchestrator.test.ts`, `scheduler.test.ts`, and `run-logger.test.ts` all test code that is being deleted or fundamentally changed. New tests are needed for the AgentEngine-based dispatch path. Many existing tests import `CodeAgentConfig`, `AgentExecutionResult`, or `AgentRunner` directly — these must be updated or replaced.

**Primary recommendation:** Implement in two sequential plans: (1) AgentPool + TaskResult + Orchestrator + Reporter wiring, and (2) Scheduler wiring + CLI rewrite + legacy deletion + test cleanup. This order avoids deleting code that is still imported.

---

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `croner` | 10.0.1 | Cron expression evaluation — `new Cron(expr).msToNext()` | Already used in `config.ts` for cron validation at startup |
| `zod` | 4.3.x | Schema validation for config additions | Already used throughout |
| `vitest` | 3.1.x | Unit test runner | Already used throughout |

### New Fields Needed
| Schema | New Field | Type | Purpose |
|--------|-----------|------|---------|
| `AgentDeclaration` (core/types.ts) | `fallback_categories` | `string[]` optional | Per-agent fallback order in nightshift.yaml |
| `NightShiftTask` | `agentName` | already exists, optional | Already has field from Phase 5 |

**No new npm packages required.** All dependencies are already installed.

### Croner API used in Scheduler
```typescript
import { Cron } from "croner";

// Check if a cron schedule is due (returns ms until next run, null if never)
const job = new Cron(entry.cron);
const msToNext = job.msToNext();
// msToNext === null → never fires
// msToNext (from a past reference date) indicates whether it fired in the window

// Get the previous scheduled run time before now
const prevRun = job.previousRuns(1)[0]; // returns Date | undefined
```

The Scheduler pattern already exists for `recurring` tasks (v1.0 code in `scheduler.ts`) — the new logic should mirror it: compare `lastRuns[scheduleKey]` with the previous cron occurrence.

---

## Architecture Patterns

### Recommended File Changes
```
src/
├── daemon/
│   ├── agent-pool.ts        # PRIMARY CHANGE: replace AgentRunner with AgentEngine
│   ├── orchestrator.ts      # CHANGE: AgentRunResult bridging, fallback dispatch, JSONL hook
│   ├── scheduler.ts         # CHANGE: unwire [] stub, implement schedule→task creation
│   └── agent-runner.ts      # DELETE
├── agent/
│   ├── code-agent.ts        # DELETE
│   ├── code-agent-runner.ts # DELETE
│   ├── types.ts             # DELETE all code-agent-specific types (keep AnalysisResult if still used)
│   └── run-logger.ts        # CHANGE: genericize RunLogEntry fields
├── core/
│   └── types.ts             # CHANGE: delete AgentExecutionResult, update TaskResult
├── cli/commands/
│   ├── run.ts               # CHANGE: rewrite to use AgentEngine directly
│   └── submit.ts            # CHANGE: require --agent flag
└── inbox/
    └── reporter.ts          # CHANGE: accept AgentRunResult instead of AgentExecutionResult
```

### Pattern 1: AgentPool Dispatch with AgentEngine

**What:** Replace `new AgentRunner(opts).run(task)` with `new AgentEngine(registry, logger).run(agentDir, agentsRoot, taskId, configOverrides)`

**When to use:** Every task dispatch in the pool

```typescript
// Source: src/daemon/agent-pool.ts (new implementation)
import { AgentEngine } from "../agent/engine.js";
import { BeadRegistry } from "../agent/bead-registry.js";
import { StandardBeadPlugin } from "../agent/plugins/standard-bead-plugin.js";
import { GitCloneBeadPlugin } from "../agent/plugins/git-clone-bead-plugin.js";
import type { AgentRunResult } from "../agent/engine-types.js";

export interface TaskResult {
  task: NightShiftTask;
  result: AgentRunResult;           // was: AgentExecutionResult
  startedAt: Date;
  completedAt: Date;
}

dispatch(task: NightShiftTask): void {
  if (!task.agentName) {
    this.logger.warn(`Task ${task.id} rejected: no agentName specified`);
    // Push an immediate error TaskResult to completedQueue
    const errorResult: AgentRunResult = {
      runId: task.id,
      agentName: "unknown",
      status: "FATAL",
      finalOutput: null,
      perBead: [],
      totalDurationMs: 0,
      error: "Task rejected: agentName is required",
    };
    this.completedQueue.push({ task, result: errorResult, startedAt: new Date(), completedAt: new Date() });
    return;
  }

  const registry = new BeadRegistry();
  registry.register("standard", (bead, manifest) => new StandardBeadPlugin(bead, manifest, this.logger));
  registry.register("git-clone", (bead, manifest) => new GitCloneBeadPlugin(bead, manifest, this.logger));

  const engine = new AgentEngine(registry, this.logger);
  const agentsRoot = path.resolve(this.configDir, this.agentsDir);
  const agentDir = path.join(agentsRoot, task.agentName);

  const startedAt = new Date();
  const promise = engine.run(agentDir, agentsRoot, task.id, task.variables ?? {}).then(
    (result) => {
      const completedAt = new Date();
      const taskResult: TaskResult = { task, result, startedAt, completedAt };
      this.running.delete(task.id);
      this.completedQueue.push(taskResult);
      return taskResult;
    },
    // ... error handler
  );
  this.running.set(task.id, { task, startedAt, promise });
}
```

**Key insight:** `AgentEngine.run()` never throws — it catches all errors internally and returns a `AgentRunResult` with `status: "FATAL"` or `status: "TRANSIENT"`. The rejection handler in the pool is only for unexpected failures (e.g., out-of-memory).

### Pattern 2: TaskResult Uses AgentRunResult

**What:** `TaskResult.result` type changes from `AgentExecutionResult` to `AgentRunResult`

**Downstream impacts:**
- `Orchestrator.handleCompleted()` — uses `result.isError`, `result.totalCostUsd`, `result.numTurns`, `result.result` → replace with `result.status`, `result.totalDurationMs` (no cost in AgentRunResult), `result.perBead`, `result.finalOutput`
- `Orchestrator.notifyTaskEnd()` — uses `result.isError`, `result.result`, `result.totalCostUsd` → must derive summary from `AgentRunResult`
- `reporter.ts` `writeReport()` and `generateReport()` — accept `AgentExecutionResult` → must accept `AgentRunResult`
- `orchestrator.test.ts` `makeResult()` helper — returns `AgentExecutionResult` → must return `AgentRunResult`

**Cost tracking:** `AgentRunResult` does NOT have `totalCostUsd`. The daemon currently accumulates `result.totalCostUsd` into `state.totalCostUsd`. After migration, cost can be derived by summing per-bead durations, or `totalCostUsd` can be dropped from daemon state. Per locked decisions, cost is not a required field in `AgentRunResult` — the daemon state cost tracking becomes best-effort or 0.

**Notification body:** Per locked decisions, use final bead output summary. For code-agent, the final bead output (from the `mr` bead) contains the MR URL. For other agents, truncate `result.finalOutput` as a string.

### Pattern 3: Scheduler Evaluates config.schedule

**What:** Replace `return []` stub with cron-based schedule evaluation

**Config structure already in place:**
```typescript
// src/core/types.ts — already exists
interface ScheduleEntry {
  agent: string;       // kebab-case agent name
  cron: string;        // croner-compatible expression
  variables?: Record<string, string>;
  enabled: boolean;
  notify?: boolean;
}
```

```typescript
// src/daemon/scheduler.ts (new implementation)
import { Cron } from "croner";
import crypto from "node:crypto";

async evaluateSchedules(): Promise<NightShiftTask[]> {
  const now = new Date();
  const tasks: NightShiftTask[] = [];

  for (const entry of this.config.schedule) {
    if (!entry.enabled) continue;

    const key = `${entry.agent}:${entry.cron}`;
    const lastRun = this.state.lastRuns[key];

    const cron = new Cron(entry.cron);
    // Get the most recent scheduled time before now
    const prevRuns = cron.previousRuns(1, now);
    if (prevRuns.length === 0) continue;
    const prevRun = prevRuns[0];

    // Skip if already ran after the most recent scheduled time
    if (lastRun && new Date(lastRun) >= prevRun) continue;

    const taskId = `ns-${crypto.randomBytes(4).toString("hex")}`;

    // Merge agent-level and schedule-level variables
    const agentDecl = this.config.agents.find((a) => a.name === entry.agent);
    const mergedVars = { ...(agentDecl?.variables ?? {}), ...(entry.variables ?? {}) };

    const task: NightShiftTask = {
      id: taskId,
      name: `${entry.agent}-${taskId}`,
      origin: "recurring",
      prompt: "",              // AgentEngine ignores task.prompt — uses manifest beads
      status: "pending",
      timeout: this.config.defaultTimeout,
      createdAt: now.toISOString(),
      agentName: entry.agent,
      notify: entry.notify ?? agentDecl?.notify,
      variables: Object.keys(mergedVars).length > 0 ? mergedVars : undefined,
    };

    tasks.push(task);
    this.state.lastRuns[key] = now.toISOString();
  }

  if (tasks.length > 0) {
    await this.saveState();
  }

  return tasks;
}
```

**Important:** The scheduler state key changes from `name` (v1.0 recurring task name) to `${agent}:${cron}` to uniquely identify each schedule entry. The existing `lastRuns` file stores old v1.0 keys — the scheduler will simply ignore them (no collision, no migration needed since the key format is different).

**Important:** `NightShiftTask` needs a `variables` field added (it currently doesn't have one — the task carries `agentName` and the pool resolves the agent directory, but per-task variable overrides are needed for the engine's `configOverrides` parameter).

### Pattern 4: nightshift run Command Uses AgentEngine

**What:** Replace `new AgentRunner(opts).run(task)` with `AgentEngine.run(agentDir, agentsRoot, taskId, vars)` in foreground CLI mode

```typescript
// src/cli/commands/run.ts (rewritten)
export const runCommand = new Command("run")
  .description("Run an agent in the foreground")
  .option("-a, --agent <name>", "Agent name (required)")
  .option("-v, --var <key=value...>", "Variable overrides")
  .action(async (options) => {
    if (!options.agent) {
      console.error(error("--agent <name> is required"));
      process.exitCode = 1;
      return;
    }

    const config = await loadConfig();
    const agentsRoot = path.resolve(path.dirname(getConfigPath()), config.agentsDir);
    const agentDir = path.join(agentsRoot, options.agent);

    const registry = new BeadRegistry();
    // register plugins...
    const engine = new AgentEngine(registry, logger);

    const taskId = `ns-${crypto.randomBytes(4).toString("hex")}`;
    const result = await engine.run(agentDir, agentsRoot, taskId, parseVars(options.var));
    // print per-bead summary...
  });
```

### Pattern 5: JSONL Logger Generalized

**What:** `RunLogEntry` fields `category`, `mr_url` are code-agent specific. The new version uses generic fields.

```typescript
// src/agent/run-logger.ts (updated)
export interface RunLogEntry {
  date: string;
  agent_name: string;          // was: category (code-agent specific)
  final_output: unknown | null; // was: mr_url (code-agent specific)
  duration_seconds: number;
  summary: string;
}
```

**Called from:** `Orchestrator.handleCompleted()` as a post-run hook — not from code-agent.ts anymore.

### Anti-Patterns to Avoid
- **Keeping AgentRunner as fallback:** The dispatch must reject tasks without `agentName` immediately. Do not add a fallback path — it defeats the purpose of this phase.
- **Putting fallback logic in AgentEngine:** Per locked decisions, category fallback lives in Orchestrator, not in the engine.
- **Mixing AgentRunResult and AgentExecutionResult:** Pick one. After this phase, `AgentExecutionResult` is gone. Transitional code that adapts one to the other is dead code.
- **Keeping `recurring` field on NightShiftConfig:** The v1.0 `recurring` array (used only by old scheduler) is gone. The `schedule` array (already present since Phase 7) is the sole scheduling mechanism.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron evaluation | Custom cron parser or `setInterval` timer | `croner` Cron class | Already validated at startup in `config.ts`; `previousRuns(1, now)` gives last scheduled time |
| Agent process lifecycle | Custom process spawning in pool | `AgentEngine.run()` | Already handles temp dirs, manifest loading, bead pipeline, retry, cleanup |
| Plugin factory setup | Inline plugin instantiation | `BeadRegistry.register()` | Provides clean DI, used in `code-agent-manifest.test.ts` already |

---

## Common Pitfalls

### Pitfall 1: NightShiftTask Missing `variables` Field
**What goes wrong:** The scheduler creates tasks with `agentName` and variable overrides, but `NightShiftTask` type doesn't have a `variables` field. The pool's call to `engine.run(..., configOverrides)` has no source of overrides.
**Why it happens:** `NightShiftTask` was designed for the old AgentRunner path which didn't support variable injection.
**How to avoid:** Add `variables?: Record<string, string>` to `NightShiftTask` in `core/types.ts` before writing scheduler code.
**Warning signs:** TypeScript error when assigning `task.variables` in the scheduler.

### Pitfall 2: Stale Tests Import Deleted Types
**What goes wrong:** After deleting `AgentExecutionResult`, `AgentRunner`, `CodeAgentConfig`, `CodeAgentRunResult`, many test files break compilation.
**Why it happens:** Tests import these types by name. Deletion cascades to tests.
**How to avoid:** Before deleting any file, run `grep -r "AgentExecutionResult\|AgentRunner\|CodeAgentConfig\|CodeAgentRunResult\|code-agent-runner\|code-agent\.ts" tests/` to find all affected test files.
**Warning signs:** `vitest run` fails with TS import errors on test files.

### Pitfall 3: scheduler.ts State Key Collision
**What goes wrong:** Old v1.0 state file has keys like `"every-minute"` (task name format). New scheduler uses `"code-agent:0 2 * * 1-5"` format. Tests that prepopulate old state with v1.0 keys will behave unexpectedly.
**Why it happens:** Scheduler test (`scheduler.test.ts`) is heavily coupled to v1.0 `recurring` task concept and will need significant rewriting.
**How to avoid:** Write new scheduler tests from scratch rather than adapting old ones. The old scheduler tests test `recurring` array behavior which is deleted.
**Warning signs:** `scheduler.test.ts` imports `CategoryScheduleConfig` or references `config.recurring`.

### Pitfall 4: AgentPool Needs configDir and agentsDir
**What goes wrong:** `AgentPool` currently stores `configDir` but doesn't have `agentsDir`. The new dispatch path needs `agentsDir` to construct `agentsRoot`.
**Why it happens:** `agentsDir` was not needed by AgentRunner (it just ran `claude -p` with a flat prompt).
**How to avoid:** Pass `agentsDir: config.agentsDir` to `AgentPool` constructor in `orchestrator.ts`. Add `agentsDir: string` to the AgentPool constructor options interface.
**Warning signs:** `path.resolve(this.configDir, ???)` — missing field.

### Pitfall 5: TaskResult.result.totalCostUsd No Longer Exists
**What goes wrong:** `Orchestrator` accumulates `this.state.totalCostUsd += result.totalCostUsd` on every completed task. `AgentRunResult` has no `totalCostUsd` field.
**Why it happens:** Cost is a claude-specific concept; the engine tracks duration, not cost.
**How to avoid:** Either remove `totalCostUsd` from `DaemonState` tracking (set to 0 always) or leave the field in state as 0 and remove the accumulation. Do not try to read `result.totalCostUsd` — it will be `undefined` and add NaN to the total.
**Warning signs:** `state.totalCostUsd` is `NaN` after first task.

### Pitfall 6: Reporter Expects AgentExecutionResult
**What goes wrong:** `reporter.ts` `generateReport()` and `writeReport()` accept `AgentExecutionResult` and read `.result`, `.numTurns`, `.totalCostUsd`, `.isError`. These fields don't exist on `AgentRunResult`.
**Why it happens:** Reporter was written for the old result type.
**How to avoid:** Update reporter to accept `AgentRunResult`. Map `status === "SUCCESS"` to success, `perBead` to per-bead details, `finalOutput` to result summary.
**Warning signs:** TypeScript errors in reporter.ts after changing TaskResult type.

### Pitfall 7: orchestrator.test.ts Uses v1.0 NightShiftConfig Shape
**What goes wrong:** `orchestrator.test.ts` `makeConfig()` returns a config with `recurring: []` — a field that doesn't exist on the current `NightShiftConfig` type (it was removed in Phase 7). The test still compiles because it uses `as any` casting or the type was never fully enforced. After deleting `AgentExecutionResult`, the `makeResult()` helper also breaks.
**Why it happens:** The test was partially updated in Phase 7 but not fully.
**How to avoid:** Fully rewrite the orchestrator test's config/result helpers to match current types.

---

## Code Examples

### AgentEngine Constructor (verified from src/agent/engine.ts)
```typescript
// Source: src/agent/engine.ts
export class AgentEngine {
  constructor(
    private readonly registry: BeadRegistry,
    private readonly logger: Logger,
  ) {}

  async run<T = unknown>(
    agentDir: string,        // absolute path to agent directory
    agentsRoot: string,      // absolute root for path containment
    taskId: string,          // unique task identifier
    configOverrides?: Record<string, string>,  // variable overrides from task
  ): Promise<AgentRunResult<T>> { ... }
}
```

### BeadRegistry Registration (verified from src/agent/bead-registry.ts)
```typescript
// Source: src/agent/bead-registry.ts
const registry = new BeadRegistry();
registry.register("standard", (bead, manifest) => new StandardBeadPlugin(bead, manifest, logger));
registry.register("git-clone", (bead, manifest) => new GitCloneBeadPlugin(bead, manifest, logger));
```

### AgentRunResult Shape (verified from src/agent/engine-types.ts)
```typescript
// Source: src/agent/engine-types.ts
interface AgentRunResult<T = unknown> {
  runId: string;
  agentName: string;
  status: "SUCCESS" | "FATAL" | "TRANSIENT";
  finalOutput: T | null;
  perBead: BeadOutcome[];      // per-bead timing and status
  totalDurationMs: number;
  failedBeadIndex?: number;
  errorCategory?: "FATAL" | "TRANSIENT";
  suggestedDelayMs?: number;
  error?: string;
  beadOutputs?: Record<string, unknown>;
}

interface BeadOutcome {
  name: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  durationMs: number;
  error?: string;
}
```

### Croner previousRuns (verified from croner 10.0.1 in node_modules)
```typescript
// Source: croner v10.0.1
import { Cron } from "croner";

const job = new Cron("0 2 * * 1-5");  // 2 AM Mon-Fri
const prevRuns = job.previousRuns(1);  // [Date | undefined]
// prevRuns[0] is the last time this cron would have fired before now
// returns empty array if the schedule has never fired (e.g. future-only)
```

### config.schedule Structure (verified from src/core/config.ts)
```typescript
// Source: src/core/config.ts — ScheduleEntrySchema
{
  agent: "code-agent",          // kebab-case, validated against agents list
  cron: "0 2 * * 1-5",         // croner-compatible expression
  variables: { category: "tests" },  // optional overrides
  enabled: true,
  notify: true,                 // optional
}
```

### AgentDeclaration Config Shape (verified from src/core/config.ts)
```typescript
// Source: src/core/config.ts — AgentDeclarationSchema
{
  name: "code-agent",
  notify: true,                 // optional
  variables: { repo_url: "..." },  // agent-level defaults
}
```

**New field needed for fallback_categories:**
```typescript
const AgentDeclarationSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "must be kebab-case"),
  notify: z.boolean().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  fallback_categories: z.array(z.string()).optional(),  // NEW
}).strict();
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| AgentRunner (claude -p direct) | AgentEngine + StandardBeadPlugin | Phase 10 (this phase) | All execution goes through bead pipeline |
| runCodeAgent() hardcoded | AgentEngine.run() generic | Phase 10 (this phase) | Any agent can be dispatched |
| `recurring:` array config | `schedule:` + `agents:` arrays | Phase 7 (done) | Scheduler must read `schedule` not `recurring` |
| AgentExecutionResult | AgentRunResult | Phase 10 (this phase) | Different shape — no direct isError/result/numTurns |
| Scheduler returns [] stub | Scheduler evaluates config.schedule | Phase 10 (this phase) | Actual cron scheduling |

**Deprecated/outdated (to delete in this phase):**
- `AgentRunner`: replaced by `StandardBeadPlugin` inside `AgentEngine`
- `AgentExecutionResult`: replaced by `AgentRunResult` from `engine-types.ts`
- `code-agent.ts`: its functionality is now in `agents/code-agent/` manifest pipeline
- `code-agent-runner.ts`: its functionality is now in `AgentEngine.run()`
- `src/agent/types.ts` code-agent types: `CodeAgentConfig`, `CategoryScheduleConfig`, `CodeAgentRunResult`, `PipelineContext`
- `agent-pool.ts` line 104-108: `_agentRunResultRef` and `_parseTimeoutRef` dead code stubs

---

## Files to Delete (Complete List)

| File | Reason | Test File Also Deleted/Rewritten |
|------|--------|----------------------------------|
| `src/daemon/agent-runner.ts` | Replaced by AgentEngine | `tests/unit/agent-runner.test.ts` — delete entirely |
| `src/agent/code-agent.ts` | Replaced by agents/code-agent/ manifest | `tests/unit/code-agent.test.ts` — delete entirely |
| `src/agent/code-agent-runner.ts` | Replaced by AgentEngine | `tests/unit/code-agent-runner.test.ts` — delete entirely |

**Types to delete from `src/agent/types.ts`:** `CodeAgentConfig`, `CategoryScheduleConfig`, `CodeAgentRunResult`, `AnalysisResult`, `AnalysisCandidate`, `BeadResult`

**Types to delete from `src/core/types.ts`:** `AgentExecutionResult`, `ClaudeJsonOutput`

**Fields to delete from `src/daemon/agent-pool.ts` after migration:** `_agentRunResultRef`, `_parseTimeoutRef` stubs (lines 103-108)

**Test files requiring rewriting (not deletion):**
- `tests/unit/agent-pool.test.ts` — mocks `AgentRunner` and `runCodeAgent`; must mock `AgentEngine` instead
- `tests/unit/orchestrator.test.ts` — uses `AgentExecutionResult` and v1.0 `makeConfig()`; needs updated helpers
- `tests/unit/scheduler.test.ts` — tests v1.0 `recurring` array behavior; must be completely rewritten for `schedule` array
- `tests/unit/run-logger.test.ts` — tests code-agent-specific fields; needs updated `RunLogEntry` fields
- `tests/unit/reporter.test.ts` — takes `AgentExecutionResult`; needs updated to `AgentRunResult`

---

## Open Questions

1. **`agentsDir` field in AgentPool constructor**
   - What we know: `AgentPool` receives `configDir` but not `agentsDir`; the pool needs both to construct `agentsRoot`
   - What's unclear: Whether to pass `agentsDir` as a new constructor option or derive it from `configDir` + a default
   - Recommendation: Add `agentsDir: string` to AgentPool constructor options, set it from `config.agentsDir` in `Orchestrator.start()`

2. **`NightShiftTask.variables` field**
   - What we know: The scheduler needs to attach per-run variable overrides to tasks; `AgentEngine.run()` accepts `configOverrides`; `NightShiftTask` currently has no `variables` field
   - What's unclear: Whether existing tests will break on this new field
   - Recommendation: Add `variables?: Record<string, string>` to `NightShiftTask` in `core/types.ts`; it's optional so existing task construction is unaffected

3. **Cost tracking in DaemonState**
   - What we know: `AgentRunResult` has no `totalCostUsd`; `DaemonState` tracks `totalCostUsd`
   - What's unclear: Whether to remove cost tracking entirely or keep it as 0
   - Recommendation: Keep `totalCostUsd` in `DaemonState` for backward compat with `status` command, but set it to 0 — the field is unused after migration

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `src/daemon/agent-pool.ts`, `src/daemon/orchestrator.ts`, `src/daemon/agent-runner.ts`, `src/daemon/scheduler.ts`
- Direct codebase inspection — `src/agent/engine.ts`, `src/agent/engine-types.ts`, `src/agent/bead-registry.ts`
- Direct codebase inspection — `src/core/types.ts`, `src/core/config.ts`
- Direct codebase inspection — `src/agent/code-agent.ts`, `src/agent/code-agent-runner.ts`, `src/agent/types.ts`
- Direct codebase inspection — `src/cli/commands/run.ts`, `src/cli/commands/submit.ts`
- Direct codebase inspection — `src/inbox/reporter.ts`, `src/agent/run-logger.ts`
- Direct inspection — all test files in `tests/unit/`
- Direct inspection — `node_modules/croner/dist/croner.cjs` (v10.0.1 API confirmation)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already in project, no new packages
- Architecture: HIGH — all patterns derived from existing code shapes in the codebase
- Pitfalls: HIGH — identified from direct inspection of existing code and test coupling

**Research date:** 2026-03-03
**Valid until:** Stable — this is a closed codebase with no external dependency churn risk
