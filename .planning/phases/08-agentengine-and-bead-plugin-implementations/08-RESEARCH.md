# Phase 8: AgentEngine and Bead Plugin Implementations - Research

**Researched:** 2026-02-27
**Domain:** TypeScript plugin architecture — generic pipeline engine, bead plugin wrappers, rollback, dry-run
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Pipeline failure handling**
- Abort with rollback on any bead failure — stop the pipeline and undo side-effects (delete cloned repos, clean temp files)
- Categorize errors as FATAL or TRANSIENT using a fixed engine-level enum (not plugin-extensible)
- Engine does NOT retry transient errors — returns categorized error to caller, caller decides retry strategy
- Engine includes retry metadata in the result: which bead failed, error category, suggested delay, and restart-from bead index (prepares for future pipeline loopback)
- Clean slate rollback: everything cleaned up, no artifacts preserved from successful beads before the failure
- Bead timeouts are classified as FATAL
- Rollback failures are logged as warnings; the original bead error is always the returned error
- Per-bead timeouts only (from manifest) — no global pipeline timeout

**Dry-run mode**
- Engine supports a dry-run mode that validates the pipeline without executing beads
- Dry-run checks: manifest valid, prompt files exist, plugins available, template variables all provided (every `{{variable}}` has a corresponding value in manifest or built-ins)
- Prepares for Phase 11's `agent validate` command

**Execution tracing & logging**
- Per-bead structured log events: bead name, type, start time, duration, status, truncated input/output (first N characters)
- Structured run summary emitted at pipeline completion (success or failure): total duration, per-bead status, final outcome, error if any
- Engine generates a unique run ID per pipeline execution; all log entries include it for correlation
- No mid-execution events or EventEmitter pattern — logs only

**Temporary resource cleanup**
- Single shared temp directory per run: `/tmp/nightshift-{runId}/` — all beads write there
- On success: temp directory deleted (including cloned repos)
- On failure + rollback: temp directory deleted (clean slate — no clone retained for debugging)
- On daemon start: scan and delete orphaned `nightshift-*` temp directories (from crashed runs)

**Engine result shape**
- Rich generic `AgentRunResult<T>` where T is the final bead's output type — engine is truly generic, no agent-specific outcome types
- Result includes: runId, agent name, overall status (SUCCESS/FATAL/TRANSIENT), per-bead outcomes (name, status, duration, error), total duration, restart-from index if applicable
- Final bead's typed output included in the result (e.g., MR URL for code-agent) — caller can use it directly
- Per-bead outcomes include status + timing only, no I/O content (that's in the logs)
- Final result returned after completion — no real-time event streaming

### Claude's Discretion
- Run ID format (UUID, timestamp-based, etc.)
- Truncation length for I/O in structured logs
- Exact temp directory path convention
- Orphan cleanup age threshold
- Internal pipeline context accumulation between beads

### Deferred Ideas (OUT OF SCOPE)
- Pipeline loopback / cycle-back (validation fails → re-run implementation with feedback) — future phase, but error categories and restart-from index prepare for it
- EventEmitter / real-time progress events — not needed now, could be added for CLI progress display later
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ENGN-01 | `AgentEngine` loads any agent directory and drives its bead pipeline from the manifest with no agent-specific logic | Engine architecture pattern, `loadManifest()` integration, `BeadRegistry` DI, generic `AgentRunResult<T>` shape |
| ENGN-02 | `StandardBeadPlugin` wraps existing `runBead()` (claude -p subprocess) as a bead plugin | Existing `runBead()` signature in `bead-runner.ts`, `BeadPlugin` interface, `AgentPipelineContext` → `runBead()` parameter mapping |
| ENGN-03 | `GitCloneBeadPlugin` wraps existing `cloneRepo()` as a harness-side bead plugin | Existing `cloneRepo()` signature in `git-harness.ts`, shared temp dir convention, rollback integration via `cleanupDir()` |
</phase_requirements>

---

## Summary

Phase 8 builds the `AgentEngine` class and two bead plugins. The engine is the first truly generic piece of the pluggable architecture: it takes any agent directory, loads its manifest via the already-built `loadManifest()`, iterates the bead array, calls `BeadRegistry.resolve()` for each bead type, and executes each plugin via `BeadPlugin.execute()`. No code-agent-specific logic is permitted anywhere in this layer.

The two plugins are deliberately thin: `StandardBeadPlugin.execute()` maps `AgentPipelineContext` fields to the existing `runBead()` parameter object and returns a `BeadOutput`. `GitCloneBeadPlugin.execute()` calls `cloneRepo()` and writes the clone path into the pipeline context so downstream beads find it in their `workDir`. Both functions already exist and are tested — the plugins add zero new subprocess or git logic.

The engine's failure/rollback, dry-run, and temp-dir lifecycle behaviors are all locked in CONTEXT.md. The biggest design task is the error categorization enum (`FATAL` / `TRANSIENT`), the `AgentRunResult<T>` generic shape, and the run-ID-scoped temp directory that every bead writes into. Testing must not invoke real `claude -p` or `git clone` — `runBead()` and `cloneRepo()` are mocked, and the agent directory is a real `fs.mkdtemp` fixture following the pattern established in `manifest-loader.test.ts`.

**Primary recommendation:** Build `AgentEngine` as a class that receives `BeadRegistry` and `Logger` via constructor DI (matching `BeadRegistry`'s DI pattern already in the codebase), implement the two plugins as classes in `src/agent/plugins/`, and keep the engine file under 250 lines by delegating all temp-dir management to a companion `TempDirManager` helper.

---

## Standard Stack

### Core (all already installed — no new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5.7.0 | Type safety for generics (`AgentRunResult<T>`) | Already in project, strict mode enforced |
| Node.js `fs/promises` | native | Temp dir creation, cleanup, orphan scan | Already used in `git-harness.ts` and `manifest-loader.ts` |
| `crypto` (built-in) | native | Run ID generation (`crypto.randomUUID()`) | Zero-dependency, cryptographically random, format left to Claude discretion |
| `date-fns` | ^4.1.0 | `format()` for `run_date` built-in variable | Already in project, used in `template.ts` |

### Supporting (already present)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ^3.1.0 | Unit testing with `vi.mock()` | All engine and plugin tests |
| `yaml` | ^2.8.0 | Manifest parsing (via `loadManifest`) | Indirectly — engine calls `loadManifest`, no direct YAML usage |
| `zod` | ^4.3.0 | Output schema validation (via `validateBeadOutput`) | Engine calls existing `validateBeadOutput()` — no new Zod schemas |

**Installation:** No new packages required. Phase 8 uses only existing dependencies.

---

## Architecture Patterns

### Recommended File Layout

```
src/agent/
├── engine.ts              # AgentEngine class (ENGN-01) — new
├── engine-types.ts        # AgentRunResult<T>, BeadErrorCategory, BeadOutcome — new
├── plugins/
│   ├── standard-bead-plugin.ts    # StandardBeadPlugin (ENGN-02) — new
│   └── git-clone-bead-plugin.ts   # GitCloneBeadPlugin (ENGN-03) — new
└── temp-dir-manager.ts    # TempDirManager helper — new (optional, but recommended)

tests/unit/
├── engine.test.ts                 # ENGN-01 unit tests
├── standard-bead-plugin.test.ts   # ENGN-02 unit tests
└── git-clone-bead-plugin.test.ts  # ENGN-03 unit tests
```

### Pattern 1: Generic Result Type with Final-Bead Output

The `AgentRunResult<T>` generic carries the final bead's typed output as `finalOutput: T | null`.

```typescript
// src/agent/engine-types.ts

export type BeadErrorCategory = "FATAL" | "TRANSIENT";

export type PipelineStatus = "SUCCESS" | "FATAL" | "TRANSIENT";

export interface BeadOutcome {
  name: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  durationMs: number;
  error?: string;
}

export interface AgentRunResult<T = unknown> {
  runId: string;
  agentName: string;
  status: PipelineStatus;
  finalOutput: T | null;           // typed output of the last bead on success
  perBead: BeadOutcome[];
  totalDurationMs: number;
  failedBeadIndex?: number;        // restart-from index for future loopback
  errorCategory?: BeadErrorCategory;
  suggestedDelayMs?: number;       // TRANSIENT hint for caller retry
  error?: string;
}
```

### Pattern 2: AgentEngine Class with Constructor DI

```typescript
// src/agent/engine.ts

export class AgentEngine {
  constructor(
    private readonly registry: BeadRegistry,
    private readonly logger: Logger,
  ) {}

  async run<T = unknown>(
    agentDir: string,
    agentsRoot: string,
    taskId: string,
    configOverrides: Record<string, string> = {},
  ): Promise<AgentRunResult<T>> { ... }

  async dryRun(
    agentDir: string,
    agentsRoot: string,
    configOverrides: Record<string, string> = {},
  ): Promise<void> { ... }
}
```

DI pattern is consistent with `BeadRegistry` (already a DI instance, not a singleton per Phase 6 decision).

### Pattern 3: StandardBeadPlugin — Mapping Context to runBead()

```typescript
// src/agent/plugins/standard-bead-plugin.ts
import { runBead } from "../bead-runner.js";
import { renderAgentTemplate } from "../template.js";
import { validateBeadOutput } from "../manifest-loader.js";
import { parseTimeout } from "../../utils/process.js";
import type { BeadPlugin, AgentPipelineContext, BeadOutput } from "../bead-plugin.js";

export class StandardBeadPlugin implements BeadPlugin {
  async execute(ctx: AgentPipelineContext): Promise<BeadOutput> {
    const prompt = renderAgentTemplate(
      await fs.readFile(path.join(ctx.agentDir, ctx.currentBead.prompt), "utf-8"),
      ctx.variables,
    );
    const timeoutMs = parseTimeout(ctx.currentBead.timeout);
    const env = Object.fromEntries(ctx.currentBead.env.map(e => [e.name, e.value]));

    const result = await runBead({
      beadName: ctx.currentBead.name as any,   // existing runBead has enum constraint — see pitfall below
      prompt,
      model: ctx.currentBead.model,
      cwd: ctx.workDir,
      timeoutMs,
      allowedTools: ctx.currentBead.allowedTools,
      // gitlabToken: from env if GITLAB_TOKEN present in resolved env
    });

    // Validate against output schema
    const parsed = validateBeadOutput(result.stdout, ctx.currentBead.compiledOutputSchema, ctx.currentBead.name);
    return { rawOutput: result.stdout };
  }
}
```

### Pattern 4: GitCloneBeadPlugin — Wrapping cloneRepo()

```typescript
// src/agent/plugins/git-clone-bead-plugin.ts
import { cloneRepo } from "../git-harness.js";
import type { BeadPlugin, AgentPipelineContext, BeadOutput } from "../bead-plugin.js";

export class GitCloneBeadPlugin implements BeadPlugin {
  async execute(ctx: AgentPipelineContext): Promise<BeadOutput> {
    // repoUrl comes from template variables
    const repoUrl = ctx.variables["repo_url"] as string;
    if (!repoUrl) throw new Error("GitCloneBeadPlugin requires 'repo_url' variable");

    const gitlabToken = ctx.currentBead.env.find(e => e.name === "GITLAB_TOKEN")?.value;

    // cloneRepo creates its own temp dirs — in Phase 8, we instead clone INTO the shared run temp dir
    // (This is the key deviation from current cloneRepo behavior — see Pitfall 2 below)
    const cloneResult = await cloneRepo(repoUrl, gitlabToken);

    // Expose clone path as rawOutput for engine to route into workDir
    return { rawOutput: JSON.stringify({ repoDir: cloneResult.repoDir }) };
  }
}
```

### Pattern 5: Temp Dir Lifecycle

The CONTEXT.md decision is a **single shared temp directory per run** at `/tmp/nightshift-{runId}/`. This is different from the current `cloneRepo()` which creates its own `mkdtemp` directories.

```typescript
// Engine creates shared temp dir BEFORE first bead executes:
const tmpDir = path.join(os.tmpdir(), `nightshift-${runId}`);
await fs.mkdir(tmpDir, { recursive: true });

// On success OR failure rollback — always delete:
async function cleanupRunDir(tmpDir: string, logger: Logger): Promise<void> {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch (err) {
    logger.warn("Temp dir cleanup failed (warning only)", { tmpDir, error: String(err) });
    // Never rethrow — cleanup failures must not mask original error
  }
}

// Orphan cleanup at daemon start — scan /tmp for nightshift-* dirs:
async function cleanupOrphanedRunDirs(logger: Logger): Promise<void> {
  const tmpDir = os.tmpdir();
  const entries = await fs.readdir(tmpDir);
  const orphans = entries.filter(e => e.startsWith("nightshift-"));
  // Filter by age (discretion: 1-hour threshold is reasonable for local tool)
  for (const orphan of orphans) {
    // check mtime, delete if old enough
  }
}
```

### Pattern 6: Error Categorization

```typescript
function categorizeError(err: unknown, timedOut: boolean): BeadErrorCategory {
  if (timedOut) return "FATAL";  // Locked decision: timeouts are FATAL
  if (err instanceof BeadOutputMissingError) return "TRANSIENT";
  if (err instanceof BeadContractViolationError) return "TRANSIENT";
  if (err instanceof ManifestSecurityError) return "FATAL";
  if (err instanceof ManifestError) return "FATAL";
  if (err instanceof RegistryError) return "FATAL";
  // Default: unknown errors are FATAL (safe default — don't silently retry unknown failures)
  return "FATAL";
}
```

### Pattern 7: Dry-Run Mode

```typescript
async dryRun(agentDir: string, agentsRoot: string, configOverrides: Record<string, string>): Promise<void> {
  // 1. Load manifest (validates schema, env vars)
  const manifest = await loadManifest(agentDir, agentsRoot);

  // 2. Check all plugins are registered
  for (const bead of manifest.beads) {
    this.registry.resolve(bead.type); // throws RegistryError if missing
  }

  // 3. Check all prompt files exist
  for (const bead of manifest.beads) {
    const promptPath = path.join(manifest.agentDir, bead.prompt);
    await fs.access(promptPath); // throws if missing
  }

  // 4. Validate template variables (built-ins + manifest vars + overrides vs. prompt placeholders)
  // Uses existing validateTemplateVars() and buildTemplateVars() from template.ts
  // Skip beads.* references (runtime only — same rule as validateAgentsAtStartup)
}
```

### Anti-Patterns to Avoid

- **Referencing `code-agent`, category rotation, or any agent name in `engine.ts`:** ENGN-01 is violated the moment any string "code-agent" appears in the engine. Zero references allowed.
- **Calling `spawnWithTimeout` directly from plugins:** Both plugins must call the existing `runBead()` and `cloneRepo()` functions. Introducing new subprocess logic violates ENGN-02/03.
- **Plugin-extensible error categories:** The `BeadErrorCategory` enum is engine-level and fixed — locked decision.
- **Global pipeline timeout:** Only per-bead timeouts (from manifest). No engine-level wall clock.
- **Rethrowing rollback errors:** Rollback failures are `logger.warn()` only; original error is always what's returned.
- **Spreading `process.env`:** `runBead()` already uses `buildBeadEnv()`. The plugin must pass `allowedTools` and resolved env vars from `ctx.currentBead`, not spread the host environment.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML manifest loading | Custom YAML parser | `loadManifest()` from `manifest-loader.ts` | Already built, tested, security-checked (path containment, Zod validation) |
| Bead output schema validation | Custom JSON parsing | `validateBeadOutput()` from `manifest-loader.ts` | Already handles `extractLastJsonBlock`, schema validation, error types |
| Template rendering | Custom `{{var}}` replacement | `renderAgentTemplate()` from `agent/template.ts` | Handles dot-notation, array indexing, undefined passthrough |
| Template variable building | Custom merge logic | `buildTemplateVars()` + `buildBuiltIns()` from `agent/template.ts` | Correct precedence already implemented (built-ins > config > manifest) |
| Load-time template validation | Custom placeholder scan | `validateTemplateVars()` from `agent/template.ts` | Correctly skips `beads.*` references — this edge case is non-obvious |
| Subprocess spawning | New `spawn()` wrapper | `runBead()` from `bead-runner.ts` | Handles env isolation, timeout, JSON parsing, `buildBeadArgs()` |
| Git clone | New `git` invocation | `cloneRepo()` from `git-harness.ts` | Handles `GIT_CONFIG_NOSYSTEM`, credential forwarding, cleanup |
| Timeout string parsing | Custom regex | `parseTimeout()` from `utils/process.ts` | Handles `ms/s/m/h` units, already tested |
| Temp dir cleanup | Custom `rm -rf` | `cleanupDir()` from `git-harness.ts` | Swallows cleanup errors (intentional — must not mask original error) |
| Bead type registry lookup | Map lookup inline | `BeadRegistry.resolve()` | Throws `RegistryError` with diagnostic list of registered types |
| Path containment at run time | Custom `startsWith` check | `assertContained()` from `manifest-loader.ts` | Handles symlinks via `realpath()`, correct separator edge case |

**Key insight:** Every hard part of this phase (subprocess, git, schema validation, template rendering, path containment) has already been built and tested in phases 5-7. Phase 8 is pure orchestration — the engine connects these pieces without rewriting them.

---

## Common Pitfalls

### Pitfall 1: `runBead()` Has a Narrow `beadName` Union Type

**What goes wrong:** `runBead()` currently types `beadName` as `"analyze" | "implement" | "verify" | "mr" | "log"` — a hardcoded union from the code-agent era. `StandardBeadPlugin` will pass arbitrary bead names from the manifest. TypeScript will error.

**Why it happens:** The old type was agent-specific. `StandardBeadPlugin` must accept any string bead name.

**How to avoid:** Widen the `beadName` parameter in `runBead()` from the union to `string`, or add `| string` to the existing union. The `buildBeadEnv()` function uses `beadName` to gate GITLAB_TOKEN forwarding — this logic needs updating too. The engine-level approach: pass `gitlabToken` only when the resolved env includes `GITLAB_TOKEN` (from `ctx.currentBead.env`), removing the hardcoded `"mr"` special case from `buildBeadEnv()`.

**Warning signs:** `Argument of type 'string' is not assignable to parameter of type '"analyze" | "implement" | "verify" | "mr" | "log"'` TypeScript error when writing the plugin.

### Pitfall 2: `cloneRepo()` Creates Its Own Temp Dirs, Not the Shared Run Dir

**What goes wrong:** The current `cloneRepo()` in `git-harness.ts` calls `fs.mkdtemp()` internally to create `night-shift-repo-*` and `night-shift-handoff-*` dirs. The CONTEXT.md decision is a **single shared temp dir** at `/tmp/nightshift-{runId}/`. These are incompatible.

**Why it happens:** `cloneRepo()` was designed before the shared-temp-dir decision existed.

**How to avoid:** Two options:
1. Add an optional `repoDir` parameter to `cloneRepo()` so the engine can pass in the shared temp dir path.
2. Have `GitCloneBeadPlugin` call `cloneRepo()` and then move the resulting dirs into the shared run dir.

Option 1 (extend `cloneRepo()`) is cleaner. The plugin passes `path.join(runTmpDir, "repo")` and `path.join(runTmpDir, "handoff")` as pre-created paths. The engine then cleans up `runTmpDir` on completion.

**Warning signs:** Two separate cleanup paths (old `cloneRepo` temp dirs and new engine temp dir) — double cleanup risk and orphan leaks.

### Pitfall 3: Rollback Must Not Rethrow

**What goes wrong:** A careless `await cleanupRunDir(...)` inside a `catch` block that itself throws causes the original error to be lost, and the rollback error surfaces instead.

**Why it happens:** `async` cleanup functions can throw even with `{ force: true }` in edge cases.

**How to avoid:** Follow the existing pattern from `cleanupDir()` in `git-harness.ts` — wrap cleanup in `try/catch`, log as `warn`, never rethrow. Original error is always preserved.

**Warning signs:** Tests that check error type/message start failing intermittently with `EBUSY` or `ENOENT` from cleanup.

### Pitfall 4: Dry-Run Must Not Create Temp Dirs

**What goes wrong:** If `dryRun()` creates any filesystem artifacts, Phase 11's `agent validate` command will leave `/tmp/nightshift-*` dirs behind on every validation.

**Why it happens:** Easy to accidentally call the shared temp dir setup at the top of `run()` before the dry-run check.

**How to avoid:** Separate `run()` and `dryRun()` as distinct methods. `dryRun()` never creates a `runId` temp dir — it only reads (manifest, prompt files) and calls `registry.resolve()`.

**Warning signs:** `/tmp/nightshift-*` dirs appearing after `nightshift agent validate` runs.

### Pitfall 5: `AgentPipelineContext.previousBeads` Grows with Parsed Output

**What goes wrong:** After each bead, the engine stores the parsed output in `ctx.previousBeads` so next beads can reference `{{beads.analyze.output.result}}`. If `validateBeadOutput()` throws (schema violation), the engine must abort — not store a partial result.

**Why it happens:** Exception handling that stores to `previousBeads` before the schema validation step.

**How to avoid:** Only add to `previousBeads` after `validateBeadOutput()` succeeds. On exception, go directly to rollback.

### Pitfall 6: `workDir` vs. `agentDir` Confusion

**What goes wrong:** The engine sets `ctx.workDir` to the cloned repo directory (where beads run), but `ctx.agentDir` is the agent directory (where prompt files live). Mixing these up means prompts are read from the repo, or beads run in the agent directory.

**Why it happens:** Two different path concepts in one context object.

**How to avoid:** Before the bead loop, set `ctx.workDir = path.join(runTmpDir, "repo")` after clone. Read prompt files using `path.join(ctx.agentDir, bead.prompt)`. Pass `cwd: ctx.workDir` to `runBead()`.

---

## Code Examples

### Minimal Engine Run Loop (Illustrative — Not Final)

```typescript
// Source: based on existing patterns in code-agent-runner.ts and manifest-loader.ts

async run<T = unknown>(
  agentDir: string,
  agentsRoot: string,
  taskId: string,
  configOverrides: Record<string, string> = {},
): Promise<AgentRunResult<T>> {
  const runId = crypto.randomUUID();
  const startTime = Date.now();
  const perBead: BeadOutcome[] = [];
  const tmpDir = path.join(os.tmpdir(), `nightshift-${runId}`);

  await fs.mkdir(tmpDir, { recursive: true });

  let manifest: LoadedManifest;
  try {
    manifest = await loadManifest(agentDir, agentsRoot);
  } catch (err) {
    await cleanupRunDir(tmpDir, this.logger);
    return this.fatalResult(runId, agentDir, err, 0, Date.now() - startTime, perBead);
  }

  const builtIns = buildBuiltIns(taskId, manifest.name, path.join(tmpDir, "repo"));
  let ctx: AgentPipelineContext = {
    taskId,
    agentName: manifest.name,
    agentDir: manifest.agentDir,
    workDir: path.join(tmpDir, "repo"),
    handoffDir: path.join(tmpDir, "handoff"),
    manifest,
    currentBead: manifest.beads[0],  // updated per iteration
    previousBeads: {},
    variables: buildTemplateVars(builtIns, manifest.variables, configOverrides, {}),
  };

  for (let i = 0; i < manifest.beads.length; i++) {
    const bead = manifest.beads[i];
    ctx = { ...ctx, currentBead: bead };
    const beadStart = Date.now();

    let output: BeadOutput;
    try {
      const factory = this.registry.resolve(bead.type);
      const plugin = factory(bead, manifest);
      output = await plugin.execute(ctx);
    } catch (err) {
      const durationMs = Date.now() - beadStart;
      const category = categorizeError(err, false);
      perBead.push({ name: bead.name, status: "FAILED", durationMs, error: String(err) });
      await cleanupRunDir(tmpDir, this.logger);
      return {
        runId, agentName: manifest.name,
        status: category, finalOutput: null,
        perBead, totalDurationMs: Date.now() - startTime,
        failedBeadIndex: i, errorCategory: category,
        error: String(err),
      };
    }

    const durationMs = Date.now() - beadStart;
    // Parse output and store in previousBeads
    const parsed = validateBeadOutput(output.rawOutput, bead.compiledOutputSchema, bead.name);
    ctx = {
      ...ctx,
      previousBeads: { ...ctx.previousBeads, [bead.name]: { output: parsed, rawOutput: output.rawOutput } },
      variables: buildTemplateVars(builtIns, manifest.variables, configOverrides, ctx.previousBeads),
    };
    perBead.push({ name: bead.name, status: "SUCCESS", durationMs });
  }

  await cleanupRunDir(tmpDir, this.logger);
  return {
    runId, agentName: manifest.name,
    status: "SUCCESS",
    finalOutput: (ctx.previousBeads[manifest.beads.at(-1)!.name]?.output ?? null) as T,
    perBead, totalDurationMs: Date.now() - startTime,
  };
}
```

### Unit Test Pattern (No Real subprocess)

```typescript
// Source: pattern from tests/unit/bead-registry.test.ts and tests/unit/startup-validation.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Mock runBead — no real claude -p invocation
vi.mock("../../src/agent/bead-runner.js", () => ({
  runBead: vi.fn(),
}));

// Mock cloneRepo — no real git clone
vi.mock("../../src/agent/git-harness.js", () => ({
  cloneRepo: vi.fn(),
  cleanupDir: vi.fn(),
}));

import { runBead } from "../../src/agent/bead-runner.js";
import { AgentEngine } from "../../src/agent/engine.js";
import { BeadRegistry } from "../../src/agent/bead-registry.js";
import { StandardBeadPlugin } from "../../src/agent/plugins/standard-bead-plugin.js";

describe("AgentEngine", () => {
  let tmpDir: string;
  let agentsRoot: string;
  let agentDir: string;
  let registry: BeadRegistry;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-engine-test-"));
    agentsRoot = path.join(tmpDir, "agents");
    agentDir = path.join(agentsRoot, "test-agent");
    await fs.mkdir(path.join(agentDir, "prompts"), { recursive: true });

    registry = new BeadRegistry();
    registry.register("standard", () => new StandardBeadPlugin());

    vi.mocked(runBead).mockResolvedValue({
      exitCode: 0,
      stdout: '```json\n{"result":"ok"}\n```',
      stderr: "",
      durationMs: 100,
      costUsd: 0.001,
      timedOut: false,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
});
```

### Existing `runBead()` Signature (for Plugin Mapping Reference)

```typescript
// Source: src/agent/bead-runner.ts (existing)
export async function runBead(options: {
  beadName: "analyze" | "implement" | "verify" | "mr" | "log"; // MUST be widened for ENGN-02
  prompt: string;
  model: string;
  cwd: string;
  timeoutMs: number;
  gitlabToken?: string;
  maxTokens?: number;
  mcpConfigPath?: string;
  allowedTools?: string[];
}): Promise<BeadResult>
```

### Existing `cloneRepo()` Signature (for Plugin Mapping Reference)

```typescript
// Source: src/agent/git-harness.ts (existing)
export async function cloneRepo(
  repoUrl: string,
  gitlabToken: string | undefined,
): Promise<CloneResult>  // { repoDir: string; handoffDir: string }
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded `runCodeAgentPipeline()` pipeline | Generic `AgentEngine` driven by manifest | Phase 8 | Engine has zero agent-specific logic |
| `beadName` union tied to code-agent bead names | `string` bead type from manifest | Phase 8 | `runBead()` `beadName` parameter must be widened |
| `cloneRepo()` creates its own temp dirs | Engine-owned single shared temp dir per run | Phase 8 | `cloneRepo()` needs optional path parameters |
| No error categorization | `FATAL` / `TRANSIENT` enum | Phase 8 | Caller can decide retry strategy |

**Deprecated/outdated patterns (do NOT use in Phase 8):**
- `buildBeadEnv(beadName, gitlabToken)` hardcoded `"mr"` check: replace with env-based GITLAB_TOKEN detection
- `buildBuiltInVars()` from `code-agent-runner.ts`: the generic equivalent is `buildBuiltIns()` + `buildTemplateVars()` from `agent/template.ts`

---

## Open Questions

1. **`runBead()` `beadName` parameter widening**
   - What we know: Current type is `"analyze" | "implement" | "verify" | "mr" | "log"` — a code-agent-specific union
   - What's unclear: Whether `buildBeadEnv()` GITLAB_TOKEN gating on `beadName === "mr"` should migrate to env-presence check or stay as a hardcoded type
   - Recommendation: Change `beadName` to `string` in `runBead()`. Change `buildBeadEnv()` to gate GITLAB_TOKEN on whether the caller provides a non-undefined `gitlabToken` argument (which the plugin decides based on `ctx.currentBead.env`). This removes the only code-agent-specific constant from the shared infrastructure.

2. **`cloneRepo()` shared-temp-dir adaptation**
   - What we know: Current `cloneRepo()` creates its own `mkdtemp` dirs internally
   - What's unclear: Whether to add optional `repoDir` / `handoffDir` params to `cloneRepo()` or have `GitCloneBeadPlugin` post-move the dirs
   - Recommendation: Add optional `repoDir?: string` parameter to `cloneRepo()`. If provided, skip `mkdtemp` and clone directly into the provided path. Backward compatible (existing callers still work). This is the cleanest approach.

3. **`handoffDir` vs. single shared temp dir**
   - What we know: `AgentPipelineContext` has `workDir` (repo) and `handoffDir` (inter-bead files). `cloneRepo()` currently returns both.
   - What's unclear: With the shared run temp dir, should `handoffDir` be `{runTmpDir}/handoff/` or simply a subdirectory of `workDir`?
   - Recommendation: Use `{runTmpDir}/handoff/` as a sibling of `{runTmpDir}/repo/`. Keeps repo contents separate from handoff files. Engine creates both before starting the bead loop.

---

## Sources

### Primary (HIGH confidence)

- Direct source code inspection: `src/agent/bead-runner.ts` — `runBead()` signature, `buildBeadEnv()`, `buildBeadArgs()`
- Direct source code inspection: `src/agent/git-harness.ts` — `cloneRepo()` signature, `cleanupDir()` pattern
- Direct source code inspection: `src/agent/bead-plugin.ts` — `BeadPlugin` interface, `AgentPipelineContext`, `BeadPluginFactory`
- Direct source code inspection: `src/agent/bead-registry.ts` — `BeadRegistry` class, DI pattern
- Direct source code inspection: `src/agent/manifest-loader.ts` — `loadManifest()`, `validateBeadOutput()`, `assertContained()`
- Direct source code inspection: `src/agent/template.ts` — `buildTemplateVars()`, `buildBuiltIns()`, `validateTemplateVars()`, `renderAgentTemplate()`
- Direct source code inspection: `src/core/errors.ts` — all error class hierarchy
- Direct source code inspection: `src/utils/process.ts` — `parseTimeout()`, `SpawnResult`
- Direct source code inspection: `tests/unit/bead-registry.test.ts` — mock pattern for `BeadPluginFactory`
- Direct source code inspection: `tests/unit/startup-validation.test.ts` — `vi.mock()` pattern, `fs.mkdtemp` fixture pattern
- Direct source code inspection: `tests/unit/manifest-loader.test.ts` — `createTempAgent` helper pattern for agent directory fixtures

### Secondary (MEDIUM confidence)

- `vitest.config.ts` — confirmed test framework (vitest ^3.1.0), timeout (30s), include pattern (`tests/**/*.test.ts`)
- `package.json` — confirmed no new dependencies needed (all required libraries already present)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already present; no new dependencies introduced
- Architecture: HIGH — derived directly from existing codebase patterns (BeadRegistry DI, manifest-loader tests, cleanup patterns from git-harness)
- Pitfalls: HIGH — `runBead()` type narrowing is a concrete TypeScript issue discovered by reading the actual signature; temp dir conflicts are concrete behavioral conflicts between current `cloneRepo()` and locked CONTEXT.md decisions

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable codebase — internal architecture doesn't change without a plan)
