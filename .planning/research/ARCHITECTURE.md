# Architecture Research

**Domain:** Pluggable agent template system for poll-based autonomous agent daemon
**Researched:** 2026-02-25
**Confidence:** HIGH (based on direct codebase analysis — every file relevant to integration was read)

---

## Context: What Exists Today

Night-shift v1.0 is a poll-based daemon with a hardcoded code-agent. The relevant coupling points are:

**The hardcoded dispatch branch in `AgentPool.dispatch()`:**
```typescript
// agent-pool.ts — current
if (task.isCodeAgent && this.codeAgentConfig) {
  this.runCodeAgentTask(task, startedAt);  // → runCodeAgent()
  return;
}
// Generic fallback
const runner = new AgentRunner(runnerOpts);
runner.run(task);
```

**The magic string coupling in `Scheduler.createTask()`:**
```typescript
isCodeAgent: recurring.name === "code-agent" && !!this.config.codeAgent,
```

**The flat config in `nightshift.yaml`:**
```yaml
code_agent:           # top-level singleton, hardcoded schema
  repo_url: ...
  confluence_page_id: ...
  category_schedule: ...
  prompts: { analyze, implement, verify, mr, log }
```

Everything in `src/agent/` implements the 4-bead pipeline as one monolithic flow hardcoded to the code-agent's specific concerns. The bead names (`analyze`, `implement`, `verify`, `mr`, `log`) are string literals spread across `bead-runner.ts`, `code-agent-runner.ts`, and `code-agent.ts`. There is no abstraction for "bead pipeline" — it is a sequence of imperative function calls.

---

## v2.0 Target Architecture

### System Overview

```
nightshift.yaml
  agents/
    - name: code-agent
      path: ./agents/code-agent/        ← agent template directory
  recurring:
    - name: nightly-code-improvement
      schedule: "0 2 * * *"
      agent: code-agent                 ← reference by name (NEW)
      notify: true

Orchestrator (unchanged poll loop)
  ├── Scheduler        ← reads agent: field, resolves template dir
  ├── AgentPool        ← generic dispatch via AgentEngine (NEW)
  └── AgentEngine      ← loads manifest, runs bead pipeline (NEW)

Agent Template Directory (./agents/code-agent/)
  ├── manifest.yaml    ← bead pipeline definition + typed I/O
  ├── analyze.md       ← prompt template for analyze bead
  ├── implement.md     ← prompt template for implement bead
  ├── verify.md        ← prompt template for verify bead
  ├── mr.md            ← prompt template for mr bead
  └── log.md           ← prompt template for log bead

Composable Bead Plugins (src/agent/beads/)
  ├── types.ts         ← BeadPlugin<TInput, TOutput> interface (NEW)
  ├── standard.ts      ← StandardBead plugin (prompt → claude -p → stdout)
  ├── git-clone.ts     ← GitCloneBead plugin (no claude, returns repoDir) (NEW)
  └── registry.ts      ← BeadRegistry mapping names to plugin factories (NEW)
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `NightShiftTask` (extended) | Carries `agentName` instead of `isCodeAgent: boolean` | Scheduler → AgentPool → AgentEngine |
| `AgentEngine` (new) | Load manifest, validate I/O contracts, run bead sequence, aggregate cost/duration | AgentPool (invoked by), BeadRegistry (uses), Logger |
| `BeadPlugin<TIn, TOut>` interface (new) | Execute one step of an agent pipeline — input typed, output typed | AgentEngine (called by) |
| `BeadRegistry` (new) | Map bead type names in manifest to plugin implementations | AgentEngine (reads), bead plugins (registered in) |
| `AgentTemplateLoader` (new) | Read and validate `manifest.yaml` from template directory | AgentEngine (uses) |
| `manifest.yaml` (new file format) | Declarative bead pipeline: name, type, prompt, tools, env, I/O schema | AgentEngine reads this |
| `AgentPool` (modified) | Route tasks with `agentName` to `AgentEngine`; retain generic `AgentRunner` for plain recurring tasks | Orchestrator (same interface as before) |
| `Scheduler` (modified) | Resolve `agent:` field from recurring task config to `agentName` on the dispatched task | Orchestrator (same interface) |
| `config.ts` (modified) | Add `agents` array to config schema; change `RecurringTaskSchema` to accept `agent:` field | loadConfig() |
| `code-agent/` template (new files) | Migrate hardcoded code-agent logic into manifest + prompt files | AgentEngine (loaded at runtime) |

---

## What Changes vs What Is Created

### Modified (existing files touched)

**`src/core/types.ts`**
- Add `agentName?: string` to `NightShiftTask`
- Remove `isCodeAgent?: boolean` from `NightShiftTask` (breaking — search all usages)
- Add `AgentConfig` interface (name, path, variables)
- Add `agents?: AgentConfig[]` to `NightShiftConfig`
- Extend `RecurringTaskConfig` with `agent?: string`
- Remove `CodeAgentConfig` (migrated to manifest.yaml format)

**`src/core/config.ts`**
- Add `AgentsSchema` (array of `{ name, path }`)
- Replace `CodeAgentSchema` with `AgentsSchema` in `ConfigSchema`
- Extend `RecurringTaskSchema` with `agent: z.string().optional()`
- Remove `codeAgent` from `NightShiftConfig` return type

**`src/daemon/scheduler.ts`**
- Remove magic string: `isCodeAgent: recurring.name === "code-agent" && !!this.config.codeAgent`
- Replace with: `agentName: recurring.agent` (passes through whatever is in config)
- Remove `CategoryScheduleConfig` import — category rotation moves into the code-agent manifest/template variables

**`src/daemon/agent-pool.ts`**
- Remove `codeAgentConfig` field and all `CodeAgentConfig` wiring
- Remove `updateCodeAgentConfig()` method
- Remove `runCodeAgentTask()` private method
- Add `agentEngine: AgentEngine` field (constructed in Orchestrator, passed in)
- Modify `dispatch()`: replace the `if (task.isCodeAgent)` branch with `if (task.agentName) → agentEngine.run(task)`

**`src/daemon/orchestrator.ts`**
- Remove `codeAgentConfig: this.config.codeAgent` from AgentPool constructor args
- Remove `this.pool.updateCodeAgentConfig(freshConfig.codeAgent)` in hot-reload tick
- Add `AgentEngine` construction and pass to `AgentPool`
- Add agents config directory resolution

### Created (new files)

**`src/agent/engine/types.ts`**
- `BeadPlugin<TInput, TOutput>` interface
- `BeadManifestEntry` interface (bead name, type, prompt, tools, env, timeout)
- `AgentManifest` interface (pipeline: BeadManifestEntry[], variables: Record)
- `AgentRunResult` type (generalizes `CodeAgentRunResult`)

**`src/agent/engine/registry.ts`**
- `BeadRegistry` class with `register(type: string, factory: BeadPluginFactory)` and `resolve(type: string): BeadPlugin`
- Built-in registrations: `"standard"` (claude -p) and `"git-clone"` (harness-side clone)

**`src/agent/engine/loader.ts`**
- `AgentTemplateLoader` class
- `load(agentPath: string): Promise<AgentManifest>` — reads and validates manifest.yaml
- Zod schema for manifest.yaml format
- Resolves prompt file paths relative to agent directory

**`src/agent/engine/index.ts`** (the new AgentEngine)
- `AgentEngine` class with `run(task: NightShiftTask): Promise<AgentRunResult>`
- Resolves agent template directory from config
- Loads manifest via `AgentTemplateLoader`
- Iterates bead sequence, calling appropriate plugin from registry
- Typed I/O passing between beads (each bead output → next bead input via context object)
- Cost/duration accumulation
- Cleanup (try/finally for temp dirs created by git-clone bead)

**`src/agent/engine/plugins/standard.ts`**
- `StandardBeadPlugin` — wraps existing `runBead()` from `bead-runner.ts`
- Input: prompt vars, env, tools config
- Output: claude JSON result + parsed structured output (if handoff file specified)

**`src/agent/engine/plugins/git-clone.ts`**
- `GitCloneBeadPlugin` — wraps existing `cloneRepo()` from `git-harness.ts`
- Input: `repoUrl`, `gitlabToken`
- Output: `{ repoDir, handoffDir }`
- Registers `try/finally` cleanup with the engine's context

**`agents/code-agent/manifest.yaml`** (new agent template directory)
- Full pipeline definition for the migrated code-agent
- References `./analyze.md`, `./implement.md`, `./verify.md`, `./mr.md`, `./log.md`
- Declares env requirements, tool allowlists, models per bead
- Includes variables that come from nightshift.yaml (repo_url, confluence_page_id, etc.)

**`agents/code-agent/analyze.md`** (migrated from config-path prompts)
- Moved from user-configured path to bundled template
- Category/guidance variables still injected by engine at runtime

---

## Data Flow Changes

### Task Dispatch Flow (v1.0 → v2.0)

```
v1.0:
  Scheduler.createTask()
    → task.isCodeAgent = (name === "code-agent" && !!codeAgentConfig)
    → AgentPool.dispatch()
        → if (task.isCodeAgent) runCodeAgentTask()
            → runCodeAgent(codeAgentConfig, ...)  ← hardcoded
        → else AgentRunner.run(task)

v2.0:
  Scheduler.createTask()
    → task.agentName = recurring.agent  (e.g., "code-agent")
    → AgentPool.dispatch()
        → if (task.agentName) agentEngine.run(task)
            → AgentTemplateLoader.load(resolveAgentDir(task.agentName))
            → iterate manifest.pipeline[]
                → registry.resolve(bead.type).execute(input, context)
            → aggregate result
        → else AgentRunner.run(task)  ← generic claude -p (unchanged)
```

### Bead I/O Passing (new)

The engine maintains a `PipelineContext` object that grows as beads execute:

```
engine.run(task)
  context = { task, vars: resolvedVars, agentDir }

  bead[0] = git-clone plugin
    input:  { repoUrl: vars.repo_url, gitlabToken: env.GITLAB_TOKEN }
    output: { repoDir: "/tmp/ns-...", handoffDir: "/tmp/ns-handoff-..." }
    context.repoDir = output.repoDir      ← available to subsequent beads
    context.handoffDir = output.handoffDir

  bead[1] = standard plugin (analyze.md)
    input:  { prompt: rendered(analyze.md, context.vars + context.repoDir) }
    output: { parsed: AnalysisResult from handoff JSON }
    context.analysisResult = output.parsed

  bead[2] = standard plugin (implement.md)
    input:  { prompt: rendered(implement.md, context.vars + context.analysisResult) }
    output: { beadResult: BeadResult }
    ...

  bead[n] = cleanup (implicit, via engine try/finally)
    rm -rf context.repoDir, context.handoffDir
```

This replaces the hardcoded `PipelineContext` in `code-agent-runner.ts`. The context is generic — any agent template can populate whatever fields it needs.

### Config Schema (v1.0 → v2.0)

```yaml
# v1.0 nightshift.yaml
code_agent:
  repo_url: git@gitlab.com:org/repo.git
  confluence_page_id: "123456"
  category_schedule: { monday: [tests], ... }
  prompts: { analyze: ./prompts/analyze.md, ... }

# v2.0 nightshift.yaml
agents:
  - name: code-agent
    path: ./agents/code-agent      # directory containing manifest.yaml + prompts
    variables:                     # static vars passed to all beads
      repo_url: git@gitlab.com:org/repo.git
      confluence_page_id: "123456"
      reviewer: "jsmith"

recurring:
  - name: nightly-code-improvement
    schedule: "0 2 * * *"
    agent: code-agent              # references agents[].name
    notify: true
```

Category rotation (previously `category_schedule` in `code_agent`) moves to a manifest-level decision or a bead-specific variable injected at runtime. The simplest approach: the code-agent manifest reads a `NIGHT_SHIFT_CATEGORY` env var that the engine injects based on a `category_schedule` variable declared in the manifest. This keeps category rotation as a framework concern but makes it explicit in the template rather than hardcoded in scheduler.ts.

---

## manifest.yaml Format

```yaml
# agents/code-agent/manifest.yaml
name: code-agent
description: "Nightly GitLab MR creator"

# Variables this template requires (validated at load time)
required_variables:
  - repo_url
  - confluence_page_id

# Optional with defaults
default_variables:
  max_tokens: "8192"
  reviewer: ""

# Category rotation declared here (not in nightshift.yaml)
category_schedule:
  monday: [tests]
  tuesday: [refactoring]
  wednesday: [docs]
  thursday: [security]
  friday: [cleanup]

# Bead pipeline (executed in order)
pipeline:
  - name: clone
    type: git-clone
    # No prompt — this is a harness-side operation
    env:
      GITLAB_TOKEN: "{{ env.GITLAB_TOKEN }}"  # forwarded from engine context

  - name: analyze
    type: standard
    prompt: ./analyze.md
    model: claude-opus-4-6
    tools: [Bash, Read, Write]
    timeout: inherit           # uses task-level timeout
    handoff:
      file: "{{ handoff_dir }}/analysis.json"
      schema:
        result: string         # "IMPROVEMENT_FOUND" | "NO_IMPROVEMENT"
        reason: string?
        selected: object?

  - name: implement
    type: standard
    prompt: ./implement.md
    model: claude-opus-4-6
    tools: [Bash, Read, Write]
    retry:
      max: 2
      on_failure: verify       # retry on verify failure
      reset: git-reset-hard    # repo reset between retries

  - name: verify
    type: standard
    prompt: ./verify.md
    model: claude-sonnet-4-6
    tools: [Bash, Read, Write]
    handoff:
      file: "{{ handoff_dir }}/verify.json"
      schema:
        passed: boolean
        error_details: string?

  - name: mr
    type: standard
    prompt: ./mr.md
    model: claude-sonnet-4-6
    tools: [Bash, Read, Write]
    env:
      GITLAB_TOKEN: "{{ env.GITLAB_TOKEN }}"  # only this bead gets the token

  - name: log
    type: standard
    prompt: ./log.md
    model: claude-sonnet-4-6
    tools:
      - mcp__atlassian__getAccessibleAtlassianResources
      - mcp__atlassian__getConfluencePage
      - mcp__atlassian__updateConfluencePage
    mcp_config: "{{ variables.log_mcp_config }}"
    timeout: 120000
    optional: true             # log bead failure does not fail the pipeline
```

This manifest format replaces all the hardcoded logic in `code-agent-runner.ts`. The engine reads it and drives execution generically.

---

## Architectural Patterns

### Pattern 1: Plugin Interface with Typed Context Passing

**What:** Each bead is a plugin that receives a shared mutable `PipelineContext` and returns typed output that is merged into the context for subsequent beads.

**When:** Any multi-step pipeline where steps need to share state without tight coupling.

**Trade-offs:** The context becomes the implicit coupling point — beads depend on earlier beads having populated specific context fields. The manifest must declare dependencies. Without enforcement, this degrades to implicit global state. Mitigation: required_variables validation at load time and explicit handoff declarations in manifest.

**Example:**
```typescript
// src/agent/engine/types.ts
export interface BeadPlugin<TInput, TOutput> {
  execute(
    input: TInput,
    context: PipelineContext,
    logger: Logger,
  ): Promise<TOutput>;
}

export interface PipelineContext {
  task: NightShiftTask;
  vars: Record<string, string>;
  agentDir: string;
  repoDir?: string;          // set by git-clone bead
  handoffDir?: string;       // set by git-clone bead
  analysisResult?: unknown;  // set by analyze bead
  cleanups: Array<() => Promise<void>>; // registered by git-clone bead
}
```

### Pattern 2: Registry Pattern for Bead Types

**What:** A central registry maps string type names (from manifest.yaml) to plugin factory functions. New bead types can be registered without modifying the engine.

**When:** When the set of step types is open-ended and should be extensible without modifying core code.

**Trade-offs:** Indirection — you cannot statically follow the call chain from manifest entry to plugin implementation. Mitigated by keeping the registry small (only 2-3 built-in types initially) and co-locating registration with each plugin file.

**Example:**
```typescript
// src/agent/engine/registry.ts
export class BeadRegistry {
  private plugins = new Map<string, BeadPluginFactory>();

  register(type: string, factory: BeadPluginFactory): void {
    this.plugins.set(type, factory);
  }

  resolve(type: string): BeadPlugin<unknown, unknown> {
    const factory = this.plugins.get(type);
    if (!factory) throw new Error(`Unknown bead type: "${type}"`);
    return factory();
  }
}

// src/agent/engine/plugins/standard.ts registers itself:
registry.register("standard", () => new StandardBeadPlugin());
registry.register("git-clone", () => new GitCloneBeadPlugin());
```

### Pattern 3: Manifest-Declared Pipeline (Declarative over Imperative)

**What:** The agent pipeline is declared in YAML (sequence of bead entries with type, prompt, options) rather than being hardcoded in TypeScript. The engine interprets the manifest.

**When:** The core motivation for this milestone — users should be able to define new agents by creating a directory, not by writing TypeScript.

**Trade-offs:** The manifest must be expressive enough to cover real use cases without becoming a programming language. Start minimal — only the fields that code-agent actually uses. Extend incrementally as real templates expose gaps.

**Constraint:** Do not implement retry logic, category rotation, or optional beads in the generic engine for v2.0 unless the code-agent migration demonstrably requires it. Start with a linear pipeline; add branching only when a concrete use case demands it.

### Pattern 4: Harness-Side vs Agent-Side Operations

**What:** Operations that must run outside `claude -p` (clone, cleanup, env setup) are harness-side bead plugins. Operations that require Claude's judgment (analyze, implement, verify) are standard (claude -p) bead plugins.

**When:** Determining which "bead" type to use. Key question: does this step require LLM reasoning, or is it a deterministic operation the TypeScript runtime can perform?

**Rule:** If it's deterministic, it's a harness-side plugin. If it requires judgment, it's a standard (claude -p) plugin.

**Examples:**
- `git clone` → harness-side (`git-clone` bead type)
- `git reset --hard HEAD` between retries → harness-side
- Analyze which file to improve → standard (claude -p)
- Verify the build passes → standard (claude -p) with Bash tool

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Generic Engine Growing Code-Agent-Specific Logic

**What people do:** Add `if bead.name === "mr"` conditionals in the engine to handle special cases like the GITLAB_TOKEN env var injection or the retry-after-verify pattern.

**Why it's wrong:** Defeats the purpose of the generic engine. Now the engine is coupled to one specific agent template's quirks. Every new agent that needs similar special cases adds more conditionals.

**Do this instead:** Express special behavior in the manifest. The `env` block in a bead entry controls which env vars are forwarded. The `retry.on_failure` field controls retry behavior. The engine implements the mechanism; the manifest provides the policy.

### Anti-Pattern 2: Removing the Generic `AgentRunner` Path

**What people do:** Migrate all tasks to the agent template system, removing the `AgentRunner` code path for plain recurring tasks.

**Why it's wrong:** Plain recurring tasks (simple `claude -p` with a prompt) are the core value of the generic daemon. They require no template directory. Removing this path means every recurring task now needs a manifest.yaml directory.

**Do this instead:** Keep both dispatch paths in `AgentPool.dispatch()`. Tasks without `agentName` continue to use `AgentRunner`. Tasks with `agentName` use `AgentEngine`. This is backward compatible — existing nightshift.yaml configs with only `recurring[]` entries continue to work unchanged.

### Anti-Pattern 3: Hardcoding Category Rotation in the Engine

**What people do:** Move `resolveCategory()` from `scheduler.ts` into `AgentEngine` as a first-class engine feature, since code-agent needs it.

**Why it's wrong:** Category rotation is a code-agent concern, not a generic engine concern. Other agent templates may not have categories at all. Making the engine category-aware creates a leaky abstraction.

**Do this instead:** Declare the `category_schedule` in the code-agent manifest. The engine resolves it as a standard variable injection before executing the pipeline. The engine's job is "inject vars, run beads" — not "implement code-agent business logic."

### Anti-Pattern 4: Manifest Format That Cannot Be Validated

**What people do:** Make the manifest format loose (accept any YAML) so it's easy to add new fields without changing the loader.

**Why it's wrong:** Typos in manifest files cause silent failures at runtime — the wrong tool list is used, a prompt file is silently missing, env vars are not forwarded. These bugs are hard to debug because they show up in agent behavior, not in startup errors.

**Do this instead:** Validate the manifest with a Zod schema in `AgentTemplateLoader.load()`. Fail loudly at load time with a clear error message if required fields are missing or types are wrong. Use strict mode so unknown fields are rejected.

### Anti-Pattern 5: Baking Prompt Content Into the Engine

**What people do:** The engine has special handling for "inject the security preamble" or "add the category guidance text" because the code-agent needs them.

**Why it's wrong:** Couples the engine to the code-agent's prompt strategy. Other agents may not need a security preamble. They may want to inject it differently.

**Do this instead:** The `INJECTION_MITIGATION_PREAMBLE` from `prompt-loader.ts` stays as-is. The `StandardBeadPlugin` always prepends it (current behavior). If a future agent wants different preamble behavior, that is a new bead type, not a manifest option on the standard type.

---

## Build Order

The dependency chain is strict. Each phase has concrete prerequisites.

```
Phase 1: Type System + Config Schema
  ├── src/core/types.ts — add AgentConfig, extend RecurringTaskConfig, remove CodeAgentConfig
  ├── src/core/config.ts — add AgentsSchema, agent field in RecurringTaskSchema
  └── No behavior change — types only; existing tests still pass

Phase 2: Bead Plugin Interfaces + Registry
  ├── src/agent/engine/types.ts — BeadPlugin interface, PipelineContext, AgentRunResult
  ├── src/agent/engine/registry.ts — BeadRegistry
  └── Tests: registry registers/resolves types correctly

Phase 3: Agent Template Loader
  ├── src/agent/engine/loader.ts — reads manifest.yaml, Zod schema validates it
  ├── Depends on: types from Phase 2
  └── Tests: load valid manifest, reject invalid manifest (missing required_variables, bad schema)

Phase 4: Harness-Side Bead Plugins
  ├── src/agent/engine/plugins/git-clone.ts — wraps cloneRepo() + registers cleanup
  ├── src/agent/engine/plugins/standard.ts — wraps runBead() from bead-runner.ts
  ├── Depends on: types (Phase 2), existing git-harness.ts and bead-runner.ts (unchanged)
  └── Tests: git-clone plugin calls cloneRepo with correct args, registers cleanup

Phase 5: AgentEngine
  ├── src/agent/engine/index.ts — linear pipeline executor
  ├── Depends on: all of above phases
  ├── Feature parity target: runs code-agent manifest and produces same output as runCodeAgentPipeline()
  └── Tests: unit test with mock plugins; integration test running code-agent manifest

Phase 6: Agent Template Migration (code-agent)
  ├── agents/code-agent/manifest.yaml — declarative pipeline
  ├── agents/code-agent/analyze.md   — moved from configDir/prompts/analyze.md
  ├── agents/code-agent/implement.md
  ├── agents/code-agent/verify.md
  ├── agents/code-agent/mr.md
  ├── agents/code-agent/log.md
  ├── Depends on: AgentEngine can load and run a manifest (Phase 5)
  └── Tests: diff output of code-agent via new engine vs old runCodeAgentPipeline()

Phase 7: Wiring + Deprecation
  ├── src/daemon/agent-pool.ts — replace isCodeAgent branch with agentName → AgentEngine
  ├── src/daemon/orchestrator.ts — construct AgentEngine, pass to pool, remove codeAgent config wiring
  ├── src/daemon/scheduler.ts — remove isCodeAgent magic string, pass agentName
  ├── Remove: src/agent/code-agent.ts, src/agent/code-agent-runner.ts (superseded by engine + template)
  └── Tests: existing integration tests still pass; new dispatch path exercised

Phase 8: nightshift.yaml Migration
  ├── Update default config template (getDefaultConfigYaml) to use new agents[] + agent: field
  ├── Add migration note/warning for users with code_agent: in their config
  └── Update CLI config validation to handle old + new format gracefully
```

**Critical constraint:** Do NOT attempt to run the new engine against a real repo until Phase 6 is complete and Phase 5 unit tests pass. The migration is feature-parity-first, then cleanup.

---

## Integration Points

### Internal Boundaries (what calls what across the new boundary)

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `AgentPool` → `AgentEngine` | Direct method call: `agentEngine.run(task)` | AgentEngine is injected into AgentPool constructor — same pattern as existing `AgentRunner` |
| `AgentEngine` → `BeadRegistry` | `registry.resolve(bead.type)` | Registry holds plugin factories; engine instantiates per run |
| `AgentEngine` → `AgentTemplateLoader` | `loader.load(agentDir)` | Loader is stateless; manifest is re-loaded each run (no caching needed — runs are infrequent) |
| `StandardBeadPlugin` → `bead-runner.ts:runBead()` | Direct call — no interface change | `runBead()` stays as-is; StandardBeadPlugin is a thin adapter |
| `GitCloneBeadPlugin` → `git-harness.ts:cloneRepo()` | Direct call — no interface change | `cloneRepo()` stays as-is; plugin registers cleanup callback with engine |
| `Orchestrator` → `AgentEngine` | Construction + pass to `AgentPool` | Engine needs: config agents[], logger, configDir |
| `Scheduler` → config `agents[]` | Reads `recurring[].agent` field, copies to `NightShiftTask.agentName` | No resolution at scheduler time — resolution is AgentEngine's job |

### Preserved Interfaces (unchanged — critical for backward compat)

| Interface | Why Preserved |
|-----------|--------------|
| `AgentRunner.run(task: NightShiftTask)` | Still used for generic recurring tasks without `agent:` field |
| `BeadsClient` | No changes — task persistence is unaffected |
| `Orchestrator.tick()` | Poll loop unchanged; only AgentPool.dispatch() internals change |
| `writeReport()` in inbox/reporter.ts | Receives `AgentExecutionResult` — engine must emit this same shape |
| `NightShiftTask` shape (minus isCodeAgent) | Scheduler → Pool interface; removing isCodeAgent is the one breaking change |

---

## Scalability Considerations

This is a personal/team tool. Scalability is the agent template ecosystem, not system scale.

| Concern | Today | After v2.0 |
|---------|-------|------------|
| Adding a new agent | Requires TypeScript changes to AgentPool + new config schema | Create a directory, write manifest.yaml + prompt files |
| Sharing an agent | Fork the repo, copy the TS code | Copy the agent/ directory to another nightshift installation |
| Testing a new bead type | Requires modifying engine source | Implement `BeadPlugin` interface, register in registry |
| Category rotation for a different agent | Hardcoded in scheduler.ts | Declare `category_schedule` in manifest.yaml |
| Per-bead timeout tuning | Hardcoded constants in code-agent-runner.ts | `timeout` field in manifest bead entry |

The architecture scales in agent template count, not in concurrent execution. The existing `maxConcurrent` cap and poll-based dispatch remain unchanged.

---

## Sources

- Night-shift v1.0 codebase (direct read): `src/daemon/agent-pool.ts`, `src/daemon/orchestrator.ts`, `src/daemon/scheduler.ts`, `src/agent/code-agent.ts`, `src/agent/code-agent-runner.ts`, `src/agent/bead-runner.ts`, `src/agent/types.ts`, `src/core/types.ts`, `src/core/config.ts` — HIGH confidence
- `.planning/codebase/ARCHITECTURE.md` — authoritative architectural description of v1.0 — HIGH confidence
- `.planning/PROJECT.md` — v2.0 milestone goals and constraints — HIGH confidence
- Zod v4 documentation (existing usage in config.ts) — for manifest schema validation approach — HIGH confidence

---

*Architecture research for: pluggable agent template system (v2.0 milestone)*
*Researched: 2026-02-25*
