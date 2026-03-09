# Phase 5: Dispatch Foundation - Research

**Researched:** 2026-02-25
**Domain:** TypeScript type system refactoring, dispatch routing, file naming / concurrent safety
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Agent naming convention**
- kebab-case only, enforced by validation
- Max 64 characters, reserved name list (e.g. `default`, `all`, `none`)
- Agent name must match its directory name 1:1 — no manifest override
- Agent directories live in `agents/` next to `nightshift.yaml` in the user's project root (not inside the night-shift source tree)

**AgentConfig shape**
- Minimal stub in Phase 5: just name + path. Later phases expand as fields are needed
- `PipelineContext` carries task identity + paths only: `taskId`, `agentName`, `workDir`, `handoffDir`
- `AgentRunResult` uses generic outcomes: `SUCCESS`, `FAILURE`, `SKIPPED` (not agent-specific like `MR_CREATED`)
- `AgentRunResult` includes `details: Record<string, unknown>` for agent-specific data (MR URL, summary, etc.)

**Default agent behavior**
- `agentName` is **required** on `NightShiftTask` — no implicit default, every task must declare its agent
- During migration (Phases 5-9): hardcode `agentName='code-agent'` routing to the old pipeline. Phase 10 switches to AgentEngine
- No directory validation in Phase 5 — agentName is carried as a string. Validation against `agents/` comes in Phase 7

**Handoff file convention**
- Format: JSON content with `.json` extension (not markdown)
- Filename pattern: `handoff-{agentName}-{taskId}.json` where taskId is a 6-char random hex
- Location: per-agent subdirectory — `handoffs/{agentName}/handoff-{agentName}-{taskId}.json`
- Typed `HandoffPayload` interface defined in Phase 5 for type-safe bead-to-bead data passing
- Cleanup is configurable in `nightshift.yaml`: on = auto-delete after run completes, off = never auto-delete

### Claude's Discretion
- Exact fields on the minimal AgentConfig stub beyond name + path
- HandoffPayload interface shape based on current producer/consumer needs
- Reserved name list contents
- How to generate the 6-char hex task ID (crypto.randomBytes or similar)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUN-01 | `isCodeAgent` boolean flag is fully retired — replaced by `agentName?: string` on task types | Three usages found across 3 files (types.ts, scheduler.ts, agent-pool.ts) — all must be touched. The optional `?` modifier on `agentName` is intentional: it allows gradual migration before Phase 10 makes it required. The scheduler currently hardcodes detection via `recurring.name === "code-agent"` — this becomes `agentName: 'code-agent'`. |
| FOUN-02 | `AgentConfig` type system defines agent configuration, pipeline context, and run result interfaces | New interfaces must live in a new `src/agent/agent-types.ts` file (or an extended `src/core/types.ts`). `PipelineContext` already exists in `code-agent-runner.ts` as a code-agent-specific shape — Phase 5 introduces a *generic* replacement at `src/core/types.ts` or `src/agent/agent-types.ts`. The dispatch path (`agent-pool.ts`) must import these. |
| FOUN-03 | Handoff files include task ID suffix to prevent collisions when `maxConcurrent > 1` | Current code in `code-agent-runner.ts` uses bare filenames (`analysis.json`, `verify.json`) inside a `handoffDir` already created as a unique tmpdir per run. The collision risk is not in the tmpdir itself (already unique) but in the *new* per-agent subdirectory model. The new pattern `handoffs/{agentName}/handoff-{agentName}-{taskId}.json` requires generating the taskId suffix. `crypto.randomBytes(3).toString('hex')` produces 6 hex chars. |
</phase_requirements>

## Summary

Phase 5 is an internal plumbing refactor with no user-facing changes. It retires `isCodeAgent: boolean` from the task type system, introduces a string-based `agentName` field, defines three foundational interfaces (`AgentConfig`, `PipelineContext`, `AgentRunResult`) that the entire v2.0 architecture depends on, and fixes handoff file naming so concurrent runs cannot clobber each other.

The scope is tightly bounded: `isCodeAgent` appears in exactly 3 source files and 1 test file. The new interfaces need to be defined once and imported by the dispatch path. The handoff filename change in `code-agent-runner.ts` requires adding a `taskId` suffix — but since `cloneRepo()` already creates a unique `handoffDir` per run via `mkdtemp`, the current code is safe for the single-agent case. The new per-agent subdirectory model (`handoffs/{agentName}/`) is designed for Phase 6+ when multiple agents share a workspace handoff store.

The migration contract for Phases 5-9 is: the scheduler stamps `agentName='code-agent'` on every code-agent recurring task, and `AgentPool.dispatch()` routes on `agentName === 'code-agent'` instead of `isCodeAgent`. Phase 10 replaces this hardcoded route with the generic `AgentEngine`. Nothing about the existing pipeline logic changes in Phase 5.

**Primary recommendation:** Introduce `agentName?: string` on `NightShiftTask`, delete `isCodeAgent`, update the 3 producer/consumer sites atomically, define the 3 new interfaces in `src/agent/agent-types.ts`, and update handoff filenames to include `{taskId}` suffix. All in one coherent phase.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5.7.0 (already installed) | Type interfaces, strict mode | Already in project; strict mode already enabled in tsconfig.json |
| Node.js `crypto` module | built-in | Generate 6-char hex taskId | Already used in `scheduler.ts` (`crypto.randomBytes(4).toString('hex')`) — no new dependency |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | ^3.1.0 (already installed) | Unit tests for new dispatch routing | Tests already exist for `AgentPool` and `Scheduler` — extend them |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `crypto.randomBytes(3).toString('hex')` | `Math.random().toString(16).slice(2,8)` | crypto is already imported in scheduler.ts; Math.random is not cryptographically random but adequate for filename uniqueness. Either works — crypto is consistent with existing code. |
| New `src/agent/agent-types.ts` file | Extend `src/core/types.ts` | `src/core/types.ts` is already 143 lines and contains config/daemon/task types. Adding agent-specific interfaces there would mix concerns. A dedicated file is cleaner. |

**Installation:** No new packages needed. All dependencies already installed.

## Architecture Patterns

### Recommended Project Structure

After Phase 5, the relevant files look like:

```
src/
├── core/
│   └── types.ts              # NightShiftTask gets agentName?, isCodeAgent removed
├── agent/
│   ├── agent-types.ts        # NEW: AgentConfig, PipelineContext, AgentRunResult, HandoffPayload
│   ├── code-agent-runner.ts  # PipelineContext renamed/replaced; handoff filenames updated
│   └── types.ts              # CodeAgentRunResult stays (used by existing pipeline)
└── daemon/
    ├── agent-pool.ts         # dispatch() routes on agentName instead of isCodeAgent
    └── scheduler.ts          # createTask() sets agentName, removes isCodeAgent
```

### Pattern 1: agentName replaces isCodeAgent in NightShiftTask

**What:** Replace the boolean flag with a string discriminator on the task type.
**When to use:** Every place that reads `task.isCodeAgent` switches to `task.agentName === 'code-agent'`.

```typescript
// src/core/types.ts — BEFORE
export interface NightShiftTask {
  // ...
  isCodeAgent?: boolean;
}

// src/core/types.ts — AFTER
export interface NightShiftTask {
  // ...
  agentName?: string;  // kebab-case agent name; required in Phase 10 after migration complete
}
```

### Pattern 2: Scheduler stamps agentName on recurring tasks

**What:** The scheduler currently detects code-agent by checking `recurring.name === 'code-agent'`. This becomes explicit: stamp `agentName: 'code-agent'` during task creation.

```typescript
// src/daemon/scheduler.ts — BEFORE
isCodeAgent: recurring.name === "code-agent" && !!this.config.codeAgent,

// src/daemon/scheduler.ts — AFTER
agentName: recurring.name === "code-agent" && !!this.config.codeAgent
  ? "code-agent"
  : undefined,
```

The condition stays the same — code-agent tasks are those whose recurring name is `'code-agent'` AND the `codeAgent` config section is present. Other recurring tasks get `agentName: undefined` during the migration period.

### Pattern 3: AgentPool dispatch routes on agentName

**What:** `agent-pool.ts` currently checks `task.isCodeAgent && this.codeAgentConfig`. This becomes a string comparison.

```typescript
// src/daemon/agent-pool.ts — BEFORE
if (task.isCodeAgent && this.codeAgentConfig) {
  // code-agent path
}

// src/daemon/agent-pool.ts — AFTER
if (task.agentName === 'code-agent' && this.codeAgentConfig) {
  // code-agent path — unchanged behaviour, new discriminator
}
```

### Pattern 4: New foundational interfaces in agent-types.ts

**What:** Define the three interfaces that subsequent phases build on.

```typescript
// src/agent/agent-types.ts

/**
 * Minimal agent configuration stub for Phase 5.
 * Expanded in later phases (manifest path, bead config, etc.).
 */
export interface AgentConfig {
  name: string;   // kebab-case, max 64 chars
  path: string;   // absolute path to agent directory
}

/**
 * Generic pipeline context passed to every agent run.
 * Carries task identity and paths — no agent-specific data.
 *
 * Replaces the code-agent-specific PipelineContext in code-agent-runner.ts
 * at the generic level. The code-agent still uses its own richer context
 * internally; this is the harness-level abstraction.
 */
export interface PipelineContext {
  taskId: string;
  agentName: string;
  workDir: string;
  handoffDir: string;
}

/**
 * Generic outcome from any agent run.
 * Agent-specific data (MR URL, summary, etc.) goes in details.
 */
export type AgentRunOutcome = 'SUCCESS' | 'FAILURE' | 'SKIPPED';

export interface AgentRunResult {
  outcome: AgentRunOutcome;
  details: Record<string, unknown>;
}

/**
 * Typed handoff payload for bead-to-bead data passing.
 * All beads write and read this shape from the handoff file.
 */
export interface HandoffPayload {
  [key: string]: unknown;
}
```

### Pattern 5: Handoff filenames include taskId suffix

**What:** Handoff files move from bare names to `handoff-{agentName}-{taskId}.json` inside a per-agent subdirectory.

```typescript
// BEFORE (in code-agent-runner.ts)
const handoffFile = path.join(ctx.handoffDir, "analysis.json");
const verifyHandoffFile = path.join(ctx.handoffDir, "verify.json");

// AFTER
// handoffDir is now: <workspace>/handoffs/code-agent/
// taskId is passed in via PipelineContext
const handoffFile = path.join(ctx.handoffDir, `handoff-code-agent-${ctx.taskId}-analysis.json`);
const verifyHandoffFile = path.join(ctx.handoffDir, `handoff-code-agent-${ctx.taskId}-verify.json`);
```

Note: The `taskId` embedded in handoff filenames is the 6-char hex suffix. The full `task.id` (format `ns-{8hex}`) is already available on `NightShiftTask`. The handoff naming can use this directly — no separate generation needed. Verify the decision: CONTEXT.md says "6-char random hex" but the existing task IDs are already 8-char hex. To stay consistent: derive the 6-char suffix from the task ID rather than generating a new one. E.g., `task.id.slice(-6)` — or generate a fresh `crypto.randomBytes(3).toString('hex')` independent of task ID. Both are valid; the key constraint is the suffix makes the filename unique per run.

### Anti-Patterns to Avoid

- **Changing the code-agent pipeline logic in Phase 5:** Phase 5 is routing plumbing only. The 4-bead pipeline (`runCodeAgentPipeline`) does not change. Any change to `code-agent-runner.ts` is limited to handoff filename updates.
- **Making agentName required now:** Per the decisions, `agentName` is optional (`?`) during the migration period. Making it required (`string` not `string?`) would break all existing tests that create tasks without `agentName`. Phase 10 will make it required.
- **Deleting `CodeAgentRunResult` or `CodeAgentOutcome`:** These types in `src/agent/types.ts` are still used by the live pipeline. They should not be deleted in Phase 5.
- **Renaming the existing `PipelineContext` in code-agent-runner.ts:** The code-agent-runner uses its own rich `PipelineContext` (with `config`, `gitlabToken`, `logger`, etc.). The new generic `PipelineContext` in `agent-types.ts` is a *different type at a different layer*. To avoid name collision, the code-agent runner's type should be kept as-is or renamed to `CodeAgentPipelineContext` internally. The generic one in `agent-types.ts` is for the dispatch harness level.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unique 6-char hex IDs | Custom UUID generator | `crypto.randomBytes(3).toString('hex')` | Already used in scheduler.ts; 3 bytes = 6 hex chars; stdlib, no deps |
| kebab-case validation | Regex from scratch | `/^[a-z][a-z0-9-]{0,62}[a-z0-9]$|^[a-z]$/` | Standard pattern; document it inline |

**Key insight:** This phase has no new external dependencies. All the patterns needed are already in the codebase.

## Common Pitfalls

### Pitfall 1: Test breakage from isCodeAgent removal
**What goes wrong:** `tests/unit/agent-pool.test.ts` directly creates tasks with `isCodeAgent: true`. Removing the field from the interface causes TypeScript errors in tests immediately.
**Why it happens:** The test file has 6 tests that use `isCodeAgent: true` and checks that `runCodeAgent` is called.
**How to avoid:** Update the test file in the same commit as the type change. Replace `isCodeAgent: true` with `agentName: 'code-agent'` in all test helpers, and update dispatch assertions accordingly.
**Warning signs:** `tsc --noEmit` fails with "Object literal may only specify known properties, and 'isCodeAgent' does not exist in type 'NightShiftTask'".

### Pitfall 2: PipelineContext name collision
**What goes wrong:** Both `src/agent/code-agent-runner.ts` (existing, rich) and `src/agent/agent-types.ts` (new, generic) will export something called `PipelineContext`. Any file that imports from both will get a type conflict or shadowing.
**Why it happens:** The existing `PipelineContext` in `code-agent-runner.ts` is tightly coupled to `CodeAgentConfig` and carries `logger`, `gitlabToken`, etc. The new generic one is minimal (4 fields).
**How to avoid:** Either (a) keep the existing `PipelineContext` in `code-agent-runner.ts` with its name unchanged and give the new generic one a different name (e.g., `AgentPipelineContext`), or (b) rename the existing one to `CodeAgentPipelineContext` internally. Option (a) avoids touching `code-agent-runner.ts` beyond the handoff filename changes required by FOUN-03.
**Warning signs:** `import type { PipelineContext }` in any file that imports from both modules.

### Pitfall 3: Handoff directory creation for the new per-agent subdirectory
**What goes wrong:** The new handoff path is `handoffs/{agentName}/handoff-{agentName}-{taskId}.json`. If the `handoffs/code-agent/` subdirectory doesn't exist when the first bead tries to write to it, the write fails with ENOENT.
**Why it happens:** The current code creates `handoffDir` via `fs.mkdtemp` at a flat level — the directory always exists because `mkdtemp` creates it. The new model uses a fixed subdirectory path that must be explicitly created.
**How to avoid:** Add an `ensureDir()` call before writing the first handoff file, or create the directory in `cloneRepo()`/task setup. The existing `ensureDir()` helper in `src/core/paths.ts` is exactly right for this.
**Warning signs:** `ENOENT: no such file or directory, open 'handoffs/code-agent/handoff-...'`.

### Pitfall 4: scheduler.ts isCodeAgent condition logic
**What goes wrong:** The condition `recurring.name === "code-agent" && !!this.config.codeAgent` must be preserved exactly when translating to `agentName`. A subtle change (e.g., not checking `!!this.config.codeAgent`) would stamp `agentName: 'code-agent'` even when no `codeAgent` config is present, causing the dispatch to call `runCodeAgent` with an undefined config.
**Why it happens:** The original boolean was a guard: `isCodeAgent` is only true when *both* conditions hold. The `agentName` string version must preserve this guard.
**How to avoid:** Use a ternary: `agentName: recurring.name === 'code-agent' && !!this.config.codeAgent ? 'code-agent' : undefined`.
**Warning signs:** `runCodeAgent` called with `this.codeAgentConfig!` when `codeAgentConfig` is undefined.

## Code Examples

Verified patterns from the existing codebase:

### Existing crypto usage in scheduler.ts (task ID generation)
```typescript
// Source: src/daemon/scheduler.ts line 104
const taskId = `ns-${crypto.randomBytes(4).toString("hex")}`;
```
For handoff suffix: `crypto.randomBytes(3).toString('hex')` yields 6 chars. Alternatively, use the task's existing ID: since `task.id` is `ns-{8hex}`, the last 6 chars are already unique per task: `task.id.slice(-6)`.

### Existing ensureDir usage in paths.ts
```typescript
// Source: src/core/paths.ts lines 45-47
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}
```
Use this to create `handoffs/{agentName}/` before writing handoff files.

### Existing dispatch guard in agent-pool.ts (to be updated)
```typescript
// Source: src/daemon/agent-pool.ts line 68
if (task.isCodeAgent && this.codeAgentConfig) {
  // becomes:
  // if (task.agentName === 'code-agent' && this.codeAgentConfig) {
}
```

### Existing mkdtemp handoff directory pattern (for context — changes in FOUN-03)
```typescript
// Source: src/agent/git-harness.ts lines 18-21
const handoffDir = await fs.mkdtemp(
  path.join(os.tmpdir(), `night-shift-handoff-${runId}-`),
);
```
In Phase 5, the handoff dir model shifts to a stable path under the workspace. The `mkdtemp` approach creates a unique tmpdir — the new `handoffs/{agentName}/` subdirectory model abandons the mkdtemp pattern in favor of a persistent per-agent directory with task-ID-suffixed filenames.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `isCodeAgent: boolean` on task | `agentName?: string` on task | Phase 5 | Enables routing to any named agent, not just the hardcoded code-agent boolean |
| `handoff-{runId}/analysis.json` (tmpdir isolation) | `handoffs/{agentName}/handoff-{agentName}-{taskId}.json` | Phase 5 | Per-agent subdirectory + taskId suffix = concurrent-safe, inspectable, agent-scoped |
| `PipelineContext` lives in `code-agent-runner.ts` only | Generic `PipelineContext` in `agent-types.ts` + code-agent-specific context internally | Phase 5 | Dispatch harness can reference context shape without importing agent-specific code |

**Deprecated/outdated:**
- `isCodeAgent?: boolean` on `NightShiftTask`: Removed in Phase 5. Replaced by `agentName?: string`.
- `task.isCodeAgent` dispatch check: Replaced by `task.agentName === 'code-agent'`.

## Open Questions

1. **Should `agentName` default to `'code-agent'` for tasks that have no explicit agentName?**
   - What we know: The decision says `agentName` is **required** (no implicit default), but `?` makes it optional in TypeScript until Phase 10.
   - What's unclear: What happens at dispatch time when `agentName` is undefined? Currently generic AgentRunner handles it — that behavior is unchanged.
   - Recommendation: Leave undefined tasks to fall through to the AgentRunner path. This is current behavior for all non-code-agent tasks. No change needed.

2. **Where exactly does the handoff directory live in the new model?**
   - What we know: The pattern is `handoffs/{agentName}/handoff-{agentName}-{taskId}.json`. The CONTEXT.md doesn't specify the root of `handoffs/`.
   - What's unclear: Is `handoffs/` under the tmpdir created by `cloneRepo()`, under the workspace dir, or under `.nightshift/`?
   - Recommendation: Keep `handoffs/` as a subdirectory of the existing `handoffDir` tmpdir. This preserves the isolation property (each run still gets its own tmpdir from `mkdtemp`), while the subdirectory adds per-agent organization. The `{agentName}` subdirectory is created on demand. The `taskId` suffix is still needed even inside the tmpdir because (in Phase 10+) multiple tasks for the same agent could run concurrently against the same agent directory. Plan: `path.join(handoffDir, agentName, filename)`.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `src/core/types.ts`, `src/daemon/scheduler.ts`, `src/daemon/agent-pool.ts`, `src/agent/code-agent-runner.ts`, `src/agent/git-harness.ts`, `src/core/paths.ts` — all read verbatim
- `tests/unit/agent-pool.test.ts` — read verbatim; identifies exact test changes needed

### Secondary (MEDIUM confidence)
- TypeScript strict mode behavior with optional properties: verified via existing `tsconfig.json` (`"strict": true`)
- `crypto.randomBytes` pattern: verified in `src/daemon/scheduler.ts` line 104

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all patterns verified from existing source
- Architecture: HIGH — all three `isCodeAgent` usages located; migration path is mechanical
- Pitfalls: HIGH — pitfalls derived from direct code reading, not speculation

**Research date:** 2026-02-25
**Valid until:** 2026-04-25 (stable TypeScript/Node.js patterns; no fast-moving dependencies)
