# Phase 7: Config Schema Migration and Startup Validation - Research

**Researched:** 2026-02-26
**Domain:** Zod schema design, TypeScript config types, daemon startup validation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Config structure: agents: + schedule: separation**
- Two new top-level sections: `agents:` (declaration) and `schedule:` (cron triggers)
- `agents:` declares WHAT exists — each entry has `name` (matches directory under `agents_dir`) plus optional defaults: `notify`, `variables`
- `schedule:` declares WHEN agents run — each entry has `agent:` (must reference a declared agent), `cron:`, and optional overrides: `variables`, `enabled`, `notify`
- Every schedule entry MUST reference an agent declared in `agents:` — error if not: "Schedule references unknown agent 'foo'"
- Same agent can appear in multiple schedule entries with different cron/variables
- Agent manifest resolved by convention: `agents_dir/<name>/manifest.yaml`
- `agents_dir` defaults to `./agents` relative to nightshift.yaml — configurable

**Clean break: code_agent: and recurring: removed**
- Both `code_agent:` and `recurring:` top-level keys are removed from the schema
- `.strict()` on the Zod schema rejects them as unknown fields — standard Zod error, no special migration message
- No deprecation period — pre-1.0 software, breaking changes expected
- No migration CLI command — migration guide in documentation only
- `nightshift init` template updated to show new `agents:` + `schedule:` format with commented examples

**Schedule entries: no inline prompts**
- Every schedule entry references a declared agent — no inline `prompt:` field
- Simple recurring tasks: create a single-bead agent manifest and schedule it

**one_off_defaults: kept**
- `one_off_defaults:` stays for global defaults on `nightshift run` invocations
- Resolution order: `one_off_defaults` < agent-level defaults < CLI flags
- One-off runs also reference declared agents with optional variable overrides

**Startup validation depth**
- Full schema validation of every referenced manifest.yaml (Zod parse)
- Prompt file existence check — verify all referenced prompt files exist and are readable
- Template variable validation — parse prompt files, extract `{{var}}` references, verify each is defined in the variable resolution chain (built-ins, manifest defaults, nightshift.yaml overrides)
- Env var presence check — if a manifest declares env vars, verify they're set in the host environment
- All errors across ALL agents reported at once (not fail-on-first-agent)
- Non-zero exit code and actionable error messages before the first poll tick runs

### Claude's Discretion
- Exact Zod schema field naming for the new `agents:` and `schedule:` sections
- How `agents_dir` default resolution works internally
- Error message formatting and grouping (per-agent sections, error counts)
- How the migration from `CategoryScheduleSchema` to cron is documented
- Exit code conventions (which non-zero code for config vs manifest errors)
- Internal structure for merging agent defaults with schedule overrides

### Deferred Ideas (OUT OF SCOPE)
- `nightshift migrate` CLI command
- Special "did you mean agents:?" error when detecting `code_agent:` key
- Convention-based plugin discovery for `bead_plugins:`
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MIGR-02 | `nightshift.yaml` uses `agents:` array where each entry references an agent by name with schedule and variables | Zod schema rewrite of `ConfigSchema` in `src/core/config.ts`; new `AgentDeclarationSchema` + `ScheduleEntrySchema`; `NightShiftConfig` type updated |
| WIRE-03 | Daemon validates all referenced agent manifests at startup and fails with actionable error if any are broken | New `validateAgentsAtStartup()` function calling `loadManifest()` for each declared agent; called from `Orchestrator.start()` before `pollLoop()` |
</phase_requirements>

---

## Summary

Phase 7 is a surgical rewrite of two tightly coupled modules: `src/core/config.ts` (the Zod schema + type mapper) and `src/daemon/orchestrator.ts` (the startup sequence). All Phase 6 infrastructure — `loadManifest()`, `validateTemplateVars()`, `assertContained()` — is already production-ready and directly callable. The missing piece is the config schema that feeds agent names into those validators, and a startup gate in the orchestrator that calls them.

The config rewrite is a clean break: `code_agent:` and `recurring:` are removed by Zod's `.strict()` mode, and two new top-level keys (`agents:` and `schedule:`) replace them. The TypeScript side requires updates to `NightShiftConfig` in `src/core/types.ts` and the `mapConfig()` adapter in `src/core/config.ts`. No incremental migration path — `.strict()` rejects the old keys with standard Zod validation errors.

The startup validation gate is an `async` function that iterates `config.agents`, resolves each agent directory, calls `loadManifest()` (which performs full Zod validation, env var resolution, and path containment checks), then additionally validates prompt file existence and template variables for each bead using Phase 6's `validateTemplateVars()`. All errors are collected and reported together before `process.exit(1)` is called, matching the "report all errors at once" pattern locked in Phase 6.

**Primary recommendation:** Implement as two focused changes — schema rewrite first (config.ts + types.ts), startup validation second (orchestrator.ts) — with dedicated test files for each.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | ^4.3.0 (already installed) | Schema validation for config and manifest | Already used in project; `z.object().strict()` rejects unknown keys |
| yaml | ^2.8.0 (already installed) | YAML parsing for nightshift.yaml | Already used in `loadConfig()` |
| node:fs/promises | Node.js built-in | File existence checks for prompt files | Already used throughout |
| node:path | Node.js built-in | agents_dir resolution relative to config file | Already used in orchestrator |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| croner | ^10.0.0 (already installed) | Cron expression validation for schedule entries | Can validate cron strings at load time via `new Cron(expr)` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| z.object().strict() | z.object().passthrough() | strict() is the right choice — silently accepting old keys would hide migration errors |
| Collecting all errors before exit | Fail-on-first-agent | Locked decision: report all errors at once |

**Installation:** No new dependencies needed — all libraries already present.

---

## Architecture Patterns

### Recommended Project Structure

The phase touches these files:
```
src/
├── core/
│   ├── config.ts        # REWRITE: new AgentDeclarationSchema, ScheduleEntrySchema, ConfigSchema
│   └── types.ts         # UPDATE: new AgentDeclaration, ScheduleEntry, NightShiftConfig
├── daemon/
│   └── orchestrator.ts  # UPDATE: validateAgentsAtStartup() called in start() before pollLoop
└── cli/
    └── commands/
        └── init.ts      # UPDATE: getDefaultConfigYaml() shows new agents:/schedule: format
tests/
├── unit/
│   └── config.test.ts   # UPDATE: rewrite all tests for new schema
└── integration/
    └── startup-validation.test.ts  # NEW: daemon startup validation tests
```

### Pattern 1: Zod Schema for agents: + schedule:

**What:** Two new sub-schemas within `ConfigSchema`. The cross-validation (schedule entry must reference a declared agent) is handled with `.superRefine()` on the root schema.

**When to use:** Whenever two arrays have a referential integrity constraint in Zod.

**Example:**
```typescript
// Source: Zod v4 docs + project patterns from src/agent/manifest-schema.ts
const AgentDeclarationSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "must be kebab-case"),
  notify: z.boolean().optional(),
  variables: z.record(z.string(), z.string()).optional(),
}).strict();

const ScheduleEntrySchema = z.object({
  agent: z.string().min(1),
  cron: z.string().min(1),
  variables: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true),
  notify: z.boolean().optional(),
}).strict();

const ConfigSchema = z.object({
  workspace: z.string().default("./workspace"),
  inbox: z.string().default("./inbox"),
  agents_dir: z.string().default("./agents"),
  max_concurrent: z.number().int().positive().default(2),
  default_timeout: z.string().default("30m"),
  beads: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  daemon: z.object({ /* ... */ }).default({ /* ... */ }),
  agents: z.array(AgentDeclarationSchema).default([]),
  schedule: z.array(ScheduleEntrySchema).default([]),
  one_off_defaults: z.object({ /* ... */ }).default({ timeout: "30m" }),
  ntfy: NtfyConfigSchema,
}).strict().superRefine((data, ctx) => {
  // Cross-validation: schedule entries must reference declared agents
  const declaredNames = new Set(data.agents.map((a) => a.name));
  for (let i = 0; i < data.schedule.length; i++) {
    const entry = data.schedule[i];
    if (!declaredNames.has(entry.agent)) {
      ctx.addIssue({
        code: "custom",
        path: ["schedule", i, "agent"],
        message: `Schedule references unknown agent '${entry.agent}'`,
      });
    }
  }
  // Validate cron expressions
  for (let i = 0; i < data.schedule.length; i++) {
    const entry = data.schedule[i];
    if (entry.enabled) {
      try {
        new Cron(entry.cron);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["schedule", i, "cron"],
          message: `Invalid cron expression: '${entry.cron}'`,
        });
      }
    }
  }
});
```

**Key insight on `.strict()`:** Zod v4 `.strict()` generates an `unrecognized_keys` issue for any key not in the schema definition. When a user still has `code_agent:` or `recurring:` in their YAML, they'll see: `  - code_agent: Unrecognized key(s) in object: 'code_agent'`. This is the locked behavior — no special handling needed.

### Pattern 2: Startup Validation Gate

**What:** A function that validates all manifests before the daemon enters its poll loop. Called in `Orchestrator.start()` after config load but before `pollLoop()`.

**When to use:** Any startup-time validation that should block the daemon from running with broken configuration.

**Example:**
```typescript
// In orchestrator.ts
async function validateAgentsAtStartup(
  config: NightShiftConfig,
  configDir: string,
  logger: Logger,
): Promise<void> {
  if (config.agents.length === 0) return;

  const agentsRoot = path.resolve(configDir, config.agentsDir);
  const errors: string[] = [];

  for (const agent of config.agents) {
    const agentDir = path.join(agentsRoot, agent.name);
    try {
      const manifest = await loadManifest(agentDir, agentsRoot);
      // Validate prompt file existence + template variables for each bead
      await validateManifestPrompts(manifest, agent, logger);
    } catch (err) {
      errors.push(`Agent '${agent.name}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    const msg = `Startup validation failed — ${errors.length} agent(s) have errors:\n\n` +
      errors.map((e, i) => `[${i + 1}] ${e}`).join("\n\n");
    throw new ConfigError(msg);
  }
}
```

The throw causes `orchestrator.start()` to reject, which causes `process.exit(1)` in `src/daemon/index.ts`.

### Pattern 3: Prompt File + Template Variable Validation

**What:** For each bead in a loaded manifest, read the prompt file and call `validateTemplateVars()` with the resolved variable set (built-ins + manifest.variables + schedule-level overrides).

**Context:** The startup validator can only check variables that are resolvable at startup time (built-ins and static overrides). Variables that come from schedule-level entries must also be checked. However, built-ins like `task_id`, `repo_path` are only available at runtime, so they need to be represented with placeholder values for validation purposes.

**Example:**
```typescript
import { validateTemplateVars, BUILT_IN_VARS } from "../agent/template.js";

async function validateManifestPrompts(
  manifest: LoadedManifest,
  agentDecl: AgentDeclaration,
  scheduleVarOverrides: Record<string, string>[],
): Promise<void> {
  // Build a vars map for validation: built-ins as placeholders + manifest vars + all schedule overrides
  const builtInPlaceholders: Record<string, string> = Object.fromEntries(
    BUILT_IN_VARS.map((v) => [v, `<${v}>`])
  );
  // Merge all possible variable sources for validation
  const allKnownVars: Record<string, unknown> = {
    ...manifest.variables,
    ...agentDecl.variables,
    ...builtInPlaceholders,
  };
  // Include all schedule-level overrides as additional known vars
  for (const overrides of scheduleVarOverrides) {
    Object.assign(allKnownVars, overrides);
  }

  for (const bead of manifest.beads) {
    const promptPath = path.join(manifest.agentDir, bead.prompt);
    let promptContent: string;
    try {
      promptContent = await fs.readFile(promptPath, "utf-8");
    } catch {
      throw new ManifestError(`Bead '${bead.name}': prompt file not found: ${promptPath}`);
    }
    validateTemplateVars(promptContent, allKnownVars);
  }
}
```

### Pattern 4: TypeScript Type Updates

**What:** New types added to `src/core/types.ts`, old types removed.

**Example:**
```typescript
// NEW types in types.ts
export interface AgentDeclaration {
  name: string;
  notify?: boolean;
  variables?: Record<string, string>;
}

export interface ScheduleEntry {
  agent: string;
  cron: string;
  variables?: Record<string, string>;
  enabled: boolean;
  notify?: boolean;
}

// UPDATED NightShiftConfig
export interface NightShiftConfig {
  workspace: string;
  inbox: string;
  agentsDir: string;          // NEW: replaces implicit ./agents
  maxConcurrent: number;
  defaultTimeout: string;
  beads: BeadsConfig;
  daemon: DaemonConfig;
  agents: AgentDeclaration[]; // NEW: replaces recurring + codeAgent
  schedule: ScheduleEntry[];  // NEW: replaces recurring + codeAgent
  oneOffDefaults: OneOffDefaults;
  ntfy?: NtfyConfig;
  // REMOVED: codeAgent, recurring
}
```

### Anti-Patterns to Avoid

- **Fail-on-first-agent at startup:** Collect all errors, then throw once. Consistent with Phase 6.
- **Validating template variables without built-in placeholders:** Built-ins are only available at runtime; the startup validator must inject placeholder values to prevent false negatives.
- **Using `process.cwd()` for agents_dir resolution:** Must use `configDir` (the directory of nightshift.yaml), not CWD. The orchestrator already tracks `configDir` as `path.dirname(getConfigPath())`.
- **Calling `loadManifest()` with a non-existent path before catching errors:** `loadManifest()` throws `ManifestError` for missing files — catch and aggregate.
- **Using `z.object()` without `.strict()` on the root ConfigSchema:** Without strict, old `code_agent:` keys pass silently. `.strict()` is the enforcement mechanism.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Manifest loading + validation | Custom file reader + parser | `loadManifest()` from Phase 6 | Already handles path containment, Zod validation, env resolution, output schema compilation |
| Template variable validation | Custom regex extractor | `validateTemplateVars()` from Phase 6 | Already handles `beads.*` skip, dot notation, array indexing |
| YAML parsing | Custom parser | `yaml` package (already used) | Handles all YAML edge cases |
| Cron validation | Custom cron parser | `new Cron(expr)` from `croner` (already installed) | Validates and throws on bad expressions |
| Cross-field Zod validation | Multiple schemas with separate cross-checks | `z.superRefine()` on root schema | The standard Zod v4 pattern for referential integrity |

**Key insight:** Phase 6 delivered the full manifest validation infrastructure. Phase 7's job is to wire it into the startup path and define the schema that feeds it agent names.

---

## Common Pitfalls

### Pitfall 1: Missing configDir Propagation
**What goes wrong:** `agents_dir` resolved relative to `process.cwd()` instead of the nightshift.yaml location, causing failures when the daemon is started from a different directory.
**Why it happens:** Forgetting that `process.cwd()` is whatever directory the CLI was invoked from.
**How to avoid:** Use `path.dirname(getConfigPath())` — the orchestrator already stores this as `this.configDir`. Pass it to the validation function.
**Warning signs:** Tests pass when run from the project root but fail from subdirectories.

### Pitfall 2: Zod v4 `.strict()` Behavior
**What goes wrong:** Assuming `.strict()` throws an error immediately on unknown keys — it doesn't, it adds issues to `ZodError`. The existing `safeParse()` + issue collection pattern handles this correctly.
**Why it happens:** Confusing "strict mode" with immediate throw vs. issue accumulation.
**How to avoid:** No change needed — existing `ConfigSchema.safeParse(parsed)` pattern already collects all issues including unknown key issues. `.strict()` just adds those issues.
**Warning signs:** Trying to catch a thrown error from `.strict()` in `loadConfig()` — the error path already exists via `result.success === false`.

### Pitfall 3: Duplicate Agent Name in agents: Array
**What goes wrong:** Two entries in `agents:` with the same `name` — second one silently wins or produces confusing errors.
**Why it happens:** No uniqueness validation on the `agents:` array.
**How to avoid:** Add a `superRefine` check on `agents` array (analogous to bead name deduplication in `ManifestSchema`).
**Warning signs:** Schedule entries ambiguously reference one of two agents with the same name.

### Pitfall 4: Template Validation Too Strict at Startup
**What goes wrong:** Rejecting valid configs because schedule-level variable overrides are not visible to the manifest-level variable check.
**Why it happens:** The startup validator only sees `manifest.variables` + agent-level `variables`; schedule entries may supply additional variables that satisfy template requirements.
**How to avoid:** Build the vars map for template validation as the union of: built-in placeholders + manifest.variables + agentDecl.variables + ALL schedule-level variable overrides for that agent.
**Warning signs:** Valid configs rejected with "Prompt references undefined variables" for vars that are supplied in schedule entries.

### Pitfall 5: orchestrator.ts Hot-Reload Touching Removed Fields
**What goes wrong:** The `tick()` method in orchestrator currently accesses `freshConfig.codeAgent` and `freshConfig.recurring`. These must be updated when those fields are removed.
**Why it happens:** The orchestrator's hot-reload code (`this.pool.updateCodeAgentConfig(freshConfig.codeAgent)`) references now-removed fields.
**How to avoid:** Update `tick()` to remove the `updateCodeAgentConfig` call. Phase 7 does not wire up agent scheduling from the new format (that's Phase 10) — the scheduler just won't run anything for the new `schedule:` entries until wired up.
**Warning signs:** TypeScript compile errors when `NightShiftConfig.codeAgent` and `recurring` are removed.

### Pitfall 6: Tests for Old Config Schema Not Updated
**What goes wrong:** `tests/unit/config.test.ts` has ~15 tests specifically for `code_agent:`, `recurring:`, and `category_schedule:` — all will fail after the schema rewrite.
**Why it happens:** The test file tests the old schema behavior.
**How to avoid:** Rewrite config.test.ts entirely for the new schema. Old test cases become the new "rejected unknown keys" cases.
**Warning signs:** Large number of failing tests immediately after the schema rewrite.

---

## Code Examples

Verified patterns from the existing codebase:

### Existing loadConfig() Pattern (src/core/config.ts)
```typescript
// Source: src/core/config.ts (verbatim)
const result = ConfigSchema.safeParse(parsed);
if (!result.success) {
  const issues = result.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new ConfigError(`Invalid config:\n${issues}`);
}
return mapConfig(result.data);
```
This is the exact pattern for reporting Zod errors. `.strict()` unknown key issues appear in `result.error.issues` with `code: "unrecognized_keys"` — they format the same way.

### Existing Orchestrator Startup Sequence (src/daemon/orchestrator.ts)
```typescript
// Source: src/daemon/orchestrator.ts Orchestrator.start() (verbatim)
async start(): Promise<void> {
  this.config = await loadConfig();
  this.logger = await Logger.createDaemonLogger();
  // ... setup ...
  await ensureNightShiftDirs();
  await this.scheduler.loadState();
  await writePidFile(process.pid);
  await this.writeHeartbeat();
  // ... logging ...
  // Start heartbeat
  this.heartbeatTimer = setInterval(...);
  // Start poll loop
  await this.pollLoop();
}
```
The startup validation gate goes between `this.writeHeartbeat()` and the heartbeat timer setup — after the daemon has confirmed its own state files are written (so PID is registered) but before the poll loop starts.

### Existing daemon/index.ts Error Handling
```typescript
// Source: src/daemon/index.ts (verbatim)
orchestrator.start().catch((err) => {
  console.error("Failed to start daemon:", err);
  process.exit(1);
});
```
Any throw from `Orchestrator.start()` reaches this catch and calls `process.exit(1)`. This is already wired — the validation gate just needs to throw.

### Default Config YAML Template Pattern (src/core/config.ts)
```typescript
// Source: src/core/config.ts getDefaultConfigYaml()
export function getDefaultConfigYaml(): string {
  return `workspace: ./workspace
inbox: ./inbox
# ...
`;
}
```
The new template replaces `recurring: []` and commented `code_agent:` with `agents: []` and `schedule: []` plus commented examples.

### Existing superRefine Cross-Validation (src/agent/manifest-schema.ts)
```typescript
// Source: src/agent/manifest-schema.ts ManifestSchema (verbatim)
export const ManifestSchema = z.object({
  // ...
  beads: z.array(BeadSchema).min(1).superRefine((beads, ctx) => {
    const names = beads.map((b) => b.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate bead names: ${[...new Set(dupes)].join(', ')}`,
      });
    }
  }),
}).strict().superRefine((manifest, ctx) => {
  validateAllowedTools(manifest.allowedTools, ctx, []);
});
```
Exactly the same pattern applies for cross-validating `schedule[i].agent` references against `agents[j].name`.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `code_agent:` + `recurring:` single-purpose blocks | `agents:` + `schedule:` general-purpose | Phase 7 | One scheduling mechanism for everything |
| No startup manifest validation | Full manifest + prompt + env validation at start | Phase 7 | Failures at startup, not at 2am |
| CategoryScheduleSchema (day→categories) | Multiple schedule entries with cron + variables | Phase 7 | More expressive; any cadence, not just per-day |

**Deprecated/outdated:**
- `CodeAgentSchema`: removed — replaced by agent declaration + manifest convention
- `CategoryScheduleSchema`: removed — replaced by multiple schedule entries with different cron expressions
- `RecurringTaskSchema`: removed — replaced by agent manifests with `schedule:` entries
- `NightShiftConfig.codeAgent`: removed field
- `NightShiftConfig.recurring`: removed field
- `Orchestrator.tick()` calls to `pool.updateCodeAgentConfig()` and `scheduler.updateConfig()`: must be updated to remove `codeAgent` references

---

## Open Questions

1. **Should the startup validator run for `nightshift daemon start` only, or also for `nightshift run`?**
   - What we know: WIRE-03 says "daemon validates at startup"; `nightshift run` is a separate code path through `src/cli/commands/run.ts`
   - What's unclear: Whether the `nightshift run` command should also validate the manifest before running
   - Recommendation: Phase 7 targets daemon startup (WIRE-03). One-off validation (`nightshift agent validate`) is Phase 11 (DX-03). Keep `run.ts` out of scope.

2. **How does hot-reload in `tick()` interact with the new `agents:` / `schedule:` fields?**
   - What we know: `tick()` currently hot-reloads `recurring` and `codeAgent` from freshConfig. Both are being removed.
   - What's unclear: Should the hot-reload also pick up changes to `agents:` and `schedule:`?
   - Recommendation: Phase 7 removes the old hot-reload references but does NOT add hot-reload for `agents:` + `schedule:` — the Scheduler doesn't yet process the new format (that's Phase 10). Keep `tick()` minimal: reload only `defaultTimeout` and remove dead code. The scheduler hot-reload stays as-is for the existing (now-empty) `recurring` array path.

3. **Exit code convention for config vs manifest validation errors**
   - What we know: `process.exit(1)` is used in `daemon/index.ts` for all startup failures. The `start` command checks `process.exitCode = 1` on config error.
   - What's unclear: Whether to differentiate config parse errors (exit 1) from manifest validation errors (exit 2).
   - Recommendation: Use exit code 1 for both — POSIX convention for "general error", and the existing code already uses it uniformly. Differentiated codes add complexity without clear consumer benefit.

---

## Implementation Plan (Scope Outline)

Based on the research, Phase 7 naturally splits into **two plans**:

**Plan 07-01: Config Schema Rewrite**
- Rewrite `ConfigSchema` in `src/core/config.ts` — remove `CodeAgentSchema`, `RecurringTaskSchema`, `CategoryScheduleSchema`; add `AgentDeclarationSchema`, `ScheduleEntrySchema`; add `agents_dir` field
- Update `NightShiftConfig` and remove `CodeAgentConfig`, `RecurringTaskConfig`, `CategoryScheduleConfig` from `src/core/types.ts`; add `AgentDeclaration`, `ScheduleEntry`
- Update `mapConfig()` in `config.ts` to map new fields
- Update `getDefaultConfigYaml()` to show new format with commented examples
- Remove dead `codeAgent` + `recurring` references from `orchestrator.ts` tick hot-reload and `agent-pool.ts` constructor
- Rewrite `tests/unit/config.test.ts` for new schema

**Plan 07-02: Startup Validation Gate**
- Add `validateAgentsAtStartup()` function (new module or inline in orchestrator)
- Wire into `Orchestrator.start()` before `pollLoop()`
- Add prompt file existence + `validateTemplateVars()` per bead
- Ensure all errors across all agents collected before throwing
- Add `tests/integration/startup-validation.test.ts` (or unit-level with mocked `loadManifest`)

---

## Sources

### Primary (HIGH confidence)
- `src/core/config.ts` — current ConfigSchema, loadConfig(), mapConfig() implementation
- `src/core/types.ts` — current NightShiftConfig, CodeAgentConfig, RecurringTaskConfig types
- `src/daemon/orchestrator.ts` — current startup sequence and tick hot-reload
- `src/daemon/index.ts` — daemon entry point error handling
- `src/agent/manifest-loader.ts` — loadManifest() + validateBeadOutput() already available
- `src/agent/manifest-schema.ts` — superRefine pattern for cross-validation
- `src/agent/template.ts` — validateTemplateVars(), BUILT_IN_VARS, buildTemplateVars()
- `src/core/errors.ts` — ConfigError, ManifestError error classes
- `tests/unit/config.test.ts` — existing test patterns for loadConfig()
- `tests/unit/manifest-loader.test.ts` — test patterns for manifest validation

### Secondary (MEDIUM confidence)
- Zod v4 `.strict()` behavior — verified from existing manifest-schema.ts usage (uses `.strict()` with `.superRefine()`)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all patterns verified in existing codebase
- Architecture: HIGH — all building blocks exist and are tested; research verified wiring points
- Pitfalls: HIGH — derived from direct code inspection of the affected modules

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (stable stack — no external API dependencies)
