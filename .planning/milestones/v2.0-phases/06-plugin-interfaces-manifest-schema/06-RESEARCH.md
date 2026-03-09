# Phase 6: Plugin Interfaces and Manifest Schema - Research

**Researched:** 2026-02-26
**Domain:** Zod v4 schema design, plugin interface typing, JSON Schema validation, template variable resolution, path security
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Manifest DX**
- Minimal defaults: only `name`, `description`, and `beads` array are required — model, timeout, env, allowedTools all have sensible defaults
- `description` is required on every manifest
- No `version` field for now — add when schema actually evolves
- Bead-level overrides (model, timeout, allowedTools, env) are inline on the bead entry, not in a separate section
- Agent-level defaults for `model`, `timeout`, `allowedTools`, and `env` — beads inherit unless they override
- Inheritance behavior: `model` and `timeout` use override (bead replaces agent-level); `env` uses merge (bead adds to agent-level, bead wins on collision); `allowedTools` uses override (bead replaces agent-level entirely, can expand beyond agent-level)
- All prompt file paths are relative to the agent directory — no absolute paths, no shared refs
- Manifest validation reports ALL errors at once, not fail-on-first
- Bead `name` must be unique within a manifest
- `outputSchema` uses inline JSON Schema in the manifest (no external file refs)
- `outputSchema` is required on ALL beads (including the last one)
- Bead types are registry-based: any string is valid as a type, BeadRegistry maps type strings to plugin factory functions
- Custom bead types are declared in nightshift.yaml under `bead_plugins:` with paths to implementations
- `env` supports both passthrough syntax (string = name from host) and explicit values (key-value pair)
- `variables` section at agent level only (not per-bead), injected into prompt templates
- nightshift.yaml can override manifest variables at schedule time — enables one agent template with multiple configurations
- No `maxTurns` — `timeout` is sufficient for cost/execution control
- Linear pipelines only — no conditional beads (`when`) for now
- Schedule lives in nightshift.yaml only — manifest defines WHAT, config defines WHEN

**Bead contract strictness**
- Hard abort on schema violation: `BEAD_CONTRACT_VIOLATION` stops the pipeline immediately, no partial results
- Distinct error `BEAD_OUTPUT_MISSING` when a bead with outputSchema produces no JSON block (different root cause from violation)
- JSON block extraction: engine looks for JSON code blocks in bead output; uses the LAST block if multiple exist
- Both structured + raw output passed to next bead: `previousBead.output` (parsed JSON) and `previousBead.rawOutput` (full text)
- All previous beads' outputs are accessible via PipelineContext (not just the immediately preceding bead)
- Schema validation is manifest-driven only — plugins don't declare input/output types, engine handles validation
- No retries on contract violation — fail immediately, fix the prompt/schema
- Error output shows truncated preview (500 chars) of raw output, full output in log file
- BeadPlugin interface: single `execute(ctx: PipelineContext): Promise<BeadOutput>` method, no lifecycle hooks
- BeadOutput is raw string output only — metadata (duration, model, tokens) tracked separately by engine logging
- BeadRegistry is a DI instance passed to the engine, not a singleton

**Template variable system**
- Handlebars `{{var}}` syntax for template variables in prompt files
- Pure substitution only — no conditionals, loops, or helpers
- Fail at load time if a prompt references an undefined variable (catch typos before agent runs)
- Core built-in variables (always available, no declaration needed): `{{task_id}}`, `{{run_date}}`, `{{agent_name}}`, `{{repo_path}}`
- Hard error when user-defined variable collides with a built-in name (not just a warning)
- Variable resolution precedence: built-ins (immutable) > nightshift.yaml overrides > manifest defaults
- Previous bead outputs accessible as template variables via dot notation: `{{beads.analyze.output.summary}}`
- Full deep access with array indexing: `{{beads.analyze.output.results.categories[0].name}}`
- Raw output also accessible: `{{beads.analyze.rawOutput}}`
- Arrays and objects are JSON-serialized when injected into prompts

**Security boundaries**
- realpath() containment: resolve all paths with realpath(), verify resolved path is within the agents root directory
- Path containment checked at BOTH load time AND runtime (TOCTOU protection)
- Agents root directory is configurable via `agents_dir` in nightshift.yaml (default: `./agents`)
- Env isolation: bead subprocess gets ONLY declared env vars plus OS essentials (PATH, HOME, USER, SHELL, TMPDIR) — all other host env vars stripped
- Error at load time if a declared env var isn't set in the host environment
- Warn on secret-looking explicit values (var names containing token/key/secret/password with hardcoded values)
- Validate `allowedTools` against known Claude tool names at load time (reject unknown tools)
- Plugin paths in `bead_plugins` also undergo containment checks (must resolve within project root)
- Zod schema uses `.strict()` — unknown fields in manifest are validation errors
- All paths in nightshift.yaml validated at startup (agents_dir, bead_plugins, agent references)
- Security error messages include the full resolved path (local tool, developer needs debugging info)

### Claude's Discretion
- Exact Zod schema structure and field naming conventions
- Error message formatting and "did you mean?" suggestion implementation
- Internal PipelineContext type structure
- JSON block extraction regex/parsing approach
- How bead output variables are resolved at template substitution time
- Which specific OS-essential env vars to include beyond the decided set

### Deferred Ideas (OUT OF SCOPE)
- Conditional beads (`when` clause) — future enhancement after linear pipelines prove out
- Convention-based plugin discovery (auto-scan plugins/ directory) — evaluate after explicit registration is used
- Shared prompt refs (`@shared/` prefix for cross-agent prompt reuse) — future phase
- `maxTurns` per bead for API usage control — reconsider if timeout proves insufficient
- Manifest `version` field for schema evolution — add when schema actually changes
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MFST-01 | `manifest.yaml` schema declares the full bead pipeline (name, type, prompt file, model, allowedTools, env vars, timeout, output schema) | Zod v4 `.strict()` schema with union types for env vars, record type for outputSchema; verified all-errors collection via `safeParse` |
| MFST-02 | Agent template loader reads and Zod-validates manifest from an agent directory with `realpath()` path containment | Node.js `fs.realpath()` + string startsWith containment check; pattern verified working |
| MFST-03 | Engine injects built-in variables and agent-specific variables into prompt templates, with built-ins taking precedence on collision | Enhanced `renderTemplate` with dot notation regex and nested value resolver; built-ins defined as frozen constant map |
| PLUG-01 | `BeadPlugin<TInput, TOutput>` interface defines typed plugin contract with shared `PipelineContext` | TypeScript interface with single `execute(ctx): Promise<BeadOutput>` method; PipelineContext extends existing harness type |
| PLUG-02 | `BeadRegistry` maps bead type strings from manifests to plugin factory functions | Class holding `Map<string, BeadPluginFactory>` passed as DI to engine |
| PLUG-03 | Engine validates bead output against manifest-declared schema before passing to next bead | Zod v4 `z.fromJSONSchema()` converts inline JSON Schema to Zod at load time; `safeParse` used at runtime |
| PLUG-04 | Per-bead model, allowedTools, env vars, and timeout are declared in manifest and enforced by engine | Resolved manifest types expose merged config per bead after inheritance logic applied |
</phase_requirements>

## Summary

Phase 6 defines the complete contract between agent directories and the engine. It is a pure types/schema/validation phase — no execution logic. The output is a set of TypeScript interfaces, Zod schemas, a loader, a registry class, and an enhanced template renderer. Nothing in Phase 6 spawns processes or reads agent manifests at runtime; it defines what valid manifests look like and how they are loaded and resolved.

The existing codebase provides a strong foundation. Zod v4.3.6 is already installed and used for config validation in `src/core/config.ts` — the same patterns (`.strict()`, `.safeParse()`, all-errors reporting via `issues` array, union types, record types) apply directly to the manifest schema. The `yaml` package (v2.8.2) is already present for parsing. The existing `renderTemplate` in `src/utils/template.ts` uses a simple `{{word}}` regex that must be extended to support dot notation and array indexing for bead output variable access.

The biggest discovery is that Zod v4 provides `z.fromJSONSchema()` built-in — this eliminates the need for Ajv or any external JSON Schema validator for bead output validation (PLUG-03). The function converts a user-supplied JSON Schema object into a Zod schema at load time; runtime validation is then `zodSchema.safeParse(parsedOutput)`. This is verified to work correctly and report path-keyed errors.

**Primary recommendation:** Build the manifest loader as a single module `src/agent/manifest-loader.ts` that reads YAML, runs Zod validation, applies path containment, resolves inheritance, and compiles outputSchema entries to Zod schemas — returning a fully resolved `LoadedManifest` that the engine consumes directly without re-reading the file.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | 4.3.6 (installed) | Manifest YAML schema validation | Already used for config validation; `.strict()` enforces no unknown fields; `safeParse` collects all errors |
| `zod` `z.fromJSONSchema` | 4.3.6 built-in | Convert `outputSchema` JSON Schema to Zod at load time | Eliminates Ajv dependency; verified working for object/enum/array/nested schemas |
| `yaml` | 2.8.2 (installed) | Parse `manifest.yaml` content | Already used; `parse()` returns plain JS objects |
| `node:fs/promises` `realpath` | Node built-in | Resolve symlinks for path containment | TOCTOU-safe when checked at both load and runtime |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `date-fns` | installed | Format `{{run_date}}` built-in variable | Already used in `renderTemplate` |
| `node:path` | Node built-in | Path joining and resolution | `path.join`, `path.resolve`, `path.sep` for containment prefix check |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `z.fromJSONSchema` | Ajv | Ajv is more complete (full JSON Schema spec), but adds a dependency; Zod covers the subset needed for bead output schemas |
| `z.fromJSONSchema` | Hand-rolled JSON Schema checker | Never hand-roll; Zod handles recursive schemas, error paths, union types |
| `yaml.parse` | `js-yaml` | `yaml` is already installed; no reason to switch |

**Installation:** No new packages needed. All required libraries are already installed.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── agent/
│   ├── manifest-loader.ts      # Reads, validates, resolves manifest → LoadedManifest
│   ├── manifest-schema.ts      # Zod schema for manifest.yaml; exports ManifestSchema + types
│   ├── manifest-types.ts       # TypeScript interfaces: ManifestBead, LoadedManifest, ResolvedBead
│   ├── bead-plugin.ts          # BeadPlugin interface + BeadOutput + BeadPluginFactory types
│   ├── bead-registry.ts        # BeadRegistry class (DI instance, Map-based)
│   ├── template.ts             # Enhanced renderTemplate with dot notation + built-ins enforcement
│   └── [existing files...]
├── core/
│   └── [existing errors.ts...]  # Add BEAD_CONTRACT_VIOLATION, BEAD_OUTPUT_MISSING error types
```

### Pattern 1: Zod Manifest Schema with .strict()

**What:** Define the manifest shape using Zod with `.strict()` so unknown fields fail validation. Use `safeParse` to collect all errors, not just the first.

**When to use:** Always — this is the only manifest validation path.

**Example:**
```typescript
// src/agent/manifest-schema.ts
import { z } from "zod";

const EnvVarSchema = z.union([
  z.string().min(1),                                          // passthrough: env var name from host
  z.object({ name: z.string().min(1), value: z.string() })  // explicit key-value
]);

export const BeadSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),          // any string; BeadRegistry resolves to plugin
  prompt: z.string().min(1),        // relative to agent directory
  model: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  env: z.array(EnvVarSchema).optional(),
  timeout: z.string().optional(),
  outputSchema: z.record(z.string(), z.unknown()),  // required on ALL beads
}).strict();

export const ManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),   // required
  model: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  env: z.array(EnvVarSchema).optional(),
  timeout: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  beads: z.array(BeadSchema).min(1),
}).strict();

export type Manifest = z.infer<typeof ManifestSchema>;
```

**Verified behavior:**
- Unknown fields produce `unrecognized_keys` error (confirmed working)
- Missing required fields produce typed errors with path (e.g., `beads.0.name`)
- `safeParse` collects ALL issues; confirmed 3+ issues reported simultaneously

### Pattern 2: All-Errors Error Formatting

**What:** Format Zod issues into human-readable messages that show field path and problem, similar to TypeScript compiler output.

**When to use:** In `manifest-loader.ts` after a failed `safeParse`.

**Example:**
```typescript
// In manifest-loader.ts
function formatManifestErrors(
  issues: z.ZodIssue[],
  manifestPath: string
): string {
  const lines = issues.map(
    (issue) =>
      `  ${manifestPath}: ${issue.path.join(".") || "(root)"}: ${issue.message}`
  );
  return `Manifest validation failed:\n${lines.join("\n")}`;
}
```

### Pattern 3: realpath() Path Containment Check

**What:** Resolve symlinks with `fs.realpath()`, then verify the resolved path starts with the agents root directory. Must be checked at load time AND the call site before runtime use.

**When to use:** Whenever a path from a manifest (agent dir, prompt files, plugin paths) is resolved.

**Example:**
```typescript
// src/agent/manifest-loader.ts
import { realpath } from "node:fs/promises";
import path from "node:path";

export async function assertContained(
  resolvedPath: string,
  rootDir: string,
  label: string,
): Promise<void> {
  const resolvedRoot = await realpath(rootDir);
  const resolvedTarget = await realpath(resolvedPath);
  // Ensure prefix ends with separator to prevent "/agents-root-extra" false positives
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;
  if (!resolvedTarget.startsWith(rootWithSep) && resolvedTarget !== resolvedRoot) {
    throw new ManifestSecurityError(
      `Path containment violation: ${label} resolved to "${resolvedTarget}", which is outside agents root "${resolvedRoot}"`
    );
  }
}
```

**Pitfall:** `"/agents-root".startsWith("/agents-root")` is true AND so is `"/agents-root-extra/file"`. Always append `path.sep` before the startsWith check.

### Pattern 4: Inheritance Resolution

**What:** Apply bead-level overrides on top of agent-level defaults with field-specific merge strategies.

**When to use:** In the manifest loader, after successful Zod parse, to produce `ResolvedBead[]` for the engine.

**Example:**
```typescript
// src/agent/manifest-loader.ts
function resolveBeadConfig(manifest: Manifest, bead: ManifestBead): ResolvedBead {
  return {
    name: bead.name,
    type: bead.type,
    prompt: bead.prompt,
    // model: bead overrides agent-level entirely
    model: bead.model ?? manifest.model ?? DEFAULT_MODEL,
    // timeout: bead overrides agent-level entirely
    timeout: bead.timeout ?? manifest.timeout ?? DEFAULT_TIMEOUT,
    // allowedTools: bead overrides agent-level entirely (can expand)
    allowedTools: bead.allowedTools ?? manifest.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
    // env: MERGE — agent-level first, bead-level wins on collision
    env: mergeEnv(manifest.env ?? [], bead.env ?? []),
    outputSchema: bead.outputSchema,
  };
}

function mergeEnv(agentEnv: EnvVar[], beadEnv: EnvVar[]): EnvVar[] {
  // Agent-level first, then bead additions; bead entries override agent entries with same name
  const map = new Map<string, EnvVar>();
  for (const e of agentEnv) map.set(envName(e), e);
  for (const e of beadEnv) map.set(envName(e), e);   // bead wins on collision
  return [...map.values()];
}
```

### Pattern 5: z.fromJSONSchema() for Runtime Output Validation

**What:** At manifest load time, compile each bead's `outputSchema` (user's JSON Schema object) to a Zod schema. At runtime, use the compiled Zod schema to validate extracted JSON.

**When to use:** PLUG-03 requirement — bead output validation before passing to next bead.

**Example:**
```typescript
// src/agent/manifest-loader.ts (load time)
import { z } from "zod";

function compileOutputSchema(jsonSchema: Record<string, unknown>, beadName: string): z.ZodTypeAny {
  try {
    return (z as any).fromJSONSchema(jsonSchema) as z.ZodTypeAny;
  } catch (err) {
    throw new ManifestError(
      `Bead "${beadName}": invalid outputSchema — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// src/agent/agent-engine.ts (runtime, Phase 8)
function validateBeadOutput(
  output: unknown,
  compiledSchema: z.ZodTypeAny,
  beadName: string,
  rawOutput: string,
): asserts output is unknown {
  const result = compiledSchema.safeParse(output);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new BeadContractViolationError(
      `BEAD_CONTRACT_VIOLATION: bead "${beadName}" output did not match declared schema:\n${issues}\n\nOutput preview: ${rawOutput.slice(0, 500)}`
    );
  }
}
```

**Verified behavior of `z.fromJSONSchema`:**
- `{ type: 'object', required: ['result'], properties: { result: { type: 'string', enum: [...] } } }` — works
- Nested objects and arrays — works
- Reports errors with `path` arrays matching JSON Schema structure
- Objects: `{ type: 'string', enum: [...] }` enum violations include the expected values in the message

### Pattern 6: Enhanced Template Variable Resolution

**What:** Extend `renderTemplate` to support dot notation (`{{beads.analyze.output.summary}}`) and array indexing (`{{beads.analyze.output.results[0].name}}`), while enforcing built-in precedence.

**When to use:** Replace existing `renderTemplate` usage for agent prompt loading. The existing code-agent-runner still uses the simple form — keep backwards compatible.

**Example:**
```typescript
// src/agent/template.ts (new enhanced version for agent manifests)

const BUILT_IN_VARS = ['task_id', 'run_date', 'agent_name', 'repo_path'] as const;
type BuiltInVar = (typeof BUILT_IN_VARS)[number];

export function validateVariableNames(
  userVarNames: string[],
): void {
  const collisions = userVarNames.filter((name) =>
    (BUILT_IN_VARS as readonly string[]).includes(name)
  );
  if (collisions.length > 0) {
    throw new ManifestError(
      `Variables collision with built-ins: ${collisions.join(', ')}. ` +
      `Built-in names are reserved: ${BUILT_IN_VARS.join(', ')}`
    );
  }
}

export function buildTemplateVars(
  builtIns: Record<BuiltInVar, string>,
  manifestVars: Record<string, string>,
  configOverrides: Record<string, string>,
  beadOutputs: Record<string, { output: unknown; rawOutput: string }>,
): Record<string, unknown> {
  // Precedence: built-ins > config overrides > manifest defaults
  const merged = { ...manifestVars, ...configOverrides };
  const beads: Record<string, unknown> = {};
  for (const [beadName, result] of Object.entries(beadOutputs)) {
    beads[beadName] = { output: result.output, rawOutput: result.rawOutput };
  }
  return { ...merged, ...builtIns, beads };
}

export function renderAgentTemplate(
  template: string,
  vars: Record<string, unknown>,
): string {
  // Extended regex: matches word chars, dots, brackets for array indexing
  return template.replace(/\{\{([a-zA-Z0-9_.[\]]+)\}\}/g, (match, key: string) => {
    const value = resolveNestedValue(vars, key);
    if (value === undefined) return match;  // keep placeholder — fail-at-load catches this
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

function resolveNestedValue(obj: Record<string, unknown>, path: string): unknown {
  // Normalize array indexing: foo[0].bar → foo.0.bar
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  const parts = normalized.split('.');
  let curr: unknown = obj;
  for (const part of parts) {
    if (curr == null || typeof curr !== 'object') return undefined;
    curr = (curr as Record<string, unknown>)[part];
  }
  return curr;
}
```

**Verified behavior:**
- `{{beads.analyze.output.summary}}` resolves nested object
- `{{beads.analyze.output.results[1].name}}` resolves array item property
- Objects/arrays JSON-serialized when injected
- Current `renderTemplate` regex `/\{\{(\w+)\}\}/g` does NOT support dots (verified) — the extended regex is required

### Pattern 7: Fail-at-Load Undefined Variable Detection

**What:** After building the template var map, scan prompt file for `{{placeholder}}` tokens and fail if any don't resolve. Catches typos before agent runs.

**When to use:** In manifest loader, after rendering/resolving variable map.

**Example:**
```typescript
export function validateTemplateVars(
  template: string,
  vars: Record<string, unknown>,
): void {
  const placeholders = [...template.matchAll(/\{\{([a-zA-Z0-9_.[\]]+)\}\}/g)].map(
    (m) => m[1]
  );
  const unresolved = placeholders.filter(
    (key) => resolveNestedValue(vars, key) === undefined
  );
  if (unresolved.length > 0) {
    throw new ManifestError(
      `Prompt references undefined variables: ${unresolved.join(', ')}`
    );
  }
}
```

**Note:** At Phase 6, `beads.*` references can't be validated at load time (values only exist at runtime). The validator should skip `beads.*` prefixed paths at load time, validating only static vars.

### Pattern 8: BeadPlugin Interface

**What:** Minimal interface — single `execute` method, no lifecycle hooks. `BeadOutput` is raw string only.

**When to use:** Phase 6 defines these; Phase 8 (engine) implements them.

**Example:**
```typescript
// src/agent/bead-plugin.ts

export interface BeadOutput {
  rawOutput: string;   // full text output from the bead
}

export interface BeadPlugin {
  execute(ctx: AgentPipelineContext): Promise<BeadOutput>;
}

export type BeadPluginFactory = (
  beadConfig: ResolvedBead,
  manifest: LoadedManifest,
) => BeadPlugin;
```

### Pattern 9: BeadRegistry as DI Instance

**What:** A class holding a `Map<string, BeadPluginFactory>`. Passed to the engine at construction time, not a singleton.

**When to use:** Phase 6 defines; Phase 8 (engine) uses; built-ins registered by engine bootstrap.

**Example:**
```typescript
// src/agent/bead-registry.ts

export class BeadRegistry {
  private readonly factories = new Map<string, BeadPluginFactory>();

  register(type: string, factory: BeadPluginFactory): void {
    this.factories.set(type, factory);
  }

  resolve(type: string): BeadPluginFactory {
    const factory = this.factories.get(type);
    if (!factory) {
      throw new RegistryError(
        `Unknown bead type "${type}". Registered types: ${[...this.factories.keys()].join(', ')}`
      );
    }
    return factory;
  }

  hasType(type: string): boolean {
    return this.factories.has(type);
  }
}
```

### Pattern 10: JSON Block Extraction

**What:** Extract the last JSON code block from bead raw text output.

**When to use:** Phase 8 engine, but the regex is defined in Phase 6 (manifest-loader or a utility).

**Example:**
```typescript
export function extractLastJsonBlock(text: string): string | null {
  const blocks = [...text.matchAll(/```(?:json)?\n([\s\S]*?)\n```/g)];
  if (blocks.length === 0) return null;
  return blocks[blocks.length - 1][1];
}
```

**Verified behavior:**
- Single block: returns the block content
- Multiple blocks: returns LAST block (as specified)
- No blocks: returns `null` (triggers `BEAD_OUTPUT_MISSING` error)

### Anti-Patterns to Avoid

- **Singleton BeadRegistry:** Makes testing hard and prevents multiple pipeline instances. Pass as DI parameter.
- **Spreading process.env into template vars:** The existing code-agent-runner explicitly avoids this. The new template system must also never spread `process.env` — only the declared env allowlist.
- **Absolute prompt paths in manifest:** Reject at schema level with `.refine()` or at containment check — the schema YAML field `prompt` must be a relative path.
- **Path startsWith without trailing separator:** `"/agents/foo".startsWith("/agents")` is true, but so is `"/agents-extra/file"`. Always append `path.sep`.
- **Validating `beads.*` template variables at load time:** Those references only resolve at runtime. Skip them during static validation — only validate non-`beads.` prefixed placeholders at load time.
- **Mutable PipelineContext in plugins:** Plugins receive context but must not mutate it. Context passed to `execute()` should be the engine's resolved read-only view.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON Schema validation at runtime | Custom type checker | `z.fromJSONSchema()` (Zod v4 built-in) | Handles recursive schemas, union types, proper error paths, edge cases in spec |
| YAML parsing | Custom parser | `yaml.parse()` (already installed) | Spec-compliant, handles anchors, multiline strings, type coercion |
| All-errors collection | Custom error accumulator | `ManifestSchema.safeParse()` — Zod collects all | Zod traverses entire schema and returns all issues in one pass |
| Template variable dot notation | Custom property accessor | `resolveNestedValue()` (10 lines, verified pattern) | Simple enough to write once correctly; verify with tests |
| Symlink resolution | Custom path resolution | `fs.realpath()` (Node built-in) | Correctly follows symlink chains; OS-level guarantee |

**Key insight:** Zod v4's `z.fromJSONSchema()` is the critical discovery for this phase. It eliminates what would otherwise require adding Ajv as a dependency and writing a type-bridging layer.

## Common Pitfalls

### Pitfall 1: Path Separator Edge Case in Containment Check
**What goes wrong:** `resolvedPath.startsWith(resolvedRoot)` returns `true` for `/agents/foo` when root is `/agents`, but ALSO for `/agents-extra/file` if root is `/agents`.
**Why it happens:** String prefix matching doesn't respect directory boundaries.
**How to avoid:** Always check `resolvedPath.startsWith(resolvedRoot + path.sep)` (and handle the case where `resolvedPath === resolvedRoot` separately).
**Warning signs:** Containment tests pass for paths that are siblings of the agents root directory.

### Pitfall 2: Bead Name Uniqueness Not Enforced by Zod Schema
**What goes wrong:** Zod's `z.array()` doesn't check for uniqueness of nested field values. Two beads with `name: "analyze"` would pass Zod validation.
**Why it happens:** JSON Schema/Zod array schemas validate element structure, not inter-element constraints.
**How to avoid:** Add a `.superRefine()` after the array schema, or check uniqueness in the loader after Zod passes.
**Example:**
```typescript
beads: z.array(BeadSchema).min(1).superRefine((beads, ctx) => {
  const names = beads.map((b) => b.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) {
    ctx.addIssue({ code: 'custom', message: `Duplicate bead names: ${[...new Set(dupes)].join(', ')}` });
  }
})
```

### Pitfall 3: z.fromJSONSchema() Errors for Unsupported Schema Features
**What goes wrong:** `z.fromJSONSchema()` may not support all JSON Schema keywords (e.g., `$ref`, `allOf`, `oneOf`, `if/then/else`).
**Why it happens:** Zod's JSON Schema conversion supports a common subset, not the full spec.
**How to avoid:** Test common outputSchema patterns against `z.fromJSONSchema()` in unit tests. If a user uses unsupported features, the error at load time will be surfaced clearly.
**Warning signs:** Complex outputSchema patterns like `$ref` or `allOf` causing `z.fromJSONSchema()` to throw.

### Pitfall 4: Built-in Variable Collision Check Timing
**What goes wrong:** Variable collision check runs after merging, so a nightshift.yaml override that happens to use a built-in name could slip through if check is only on manifest variables.
**Why it happens:** Merge order matters — checking must happen at manifest load time on `variables` keys, and SEPARATELY at override time on nightshift.yaml override keys.
**How to avoid:** Check `manifest.variables` keys against built-ins at load time. Also document that nightshift.yaml variable overrides are checked at config load time (Phase 7 concern).

### Pitfall 5: PipelineContext Name Collision
**What goes wrong:** There are TWO `PipelineContext` types in the codebase — `src/agent/agent-types.ts` (harness-level, Phase 5) and `src/agent/code-agent-runner.ts` (code-agent-specific). The new bead-level `AgentPipelineContext` is a THIRD context type.
**Why it happens:** Each phase adds context that's appropriate for its level. The code-agent-runner one is explicitly noted in comments as distinct.
**How to avoid:** Name the new bead-execution context `AgentPipelineContext` or `BeadExecutionContext` to distinguish from the harness `PipelineContext`. Export from `bead-plugin.ts`.

### Pitfall 6: Template Regex Must Handle Square Brackets
**What goes wrong:** The placeholder regex `/\{\{(\w+)\}\}/g` matches only word characters (`[a-zA-Z0-9_]`). Square brackets and dots in `{{beads.analyze.output.results[0].name}}` won't be matched.
**Why it happens:** The current `renderTemplate` was designed for simple single-word vars only.
**How to avoid:** Use `/\{\{([a-zA-Z0-9_.[\]]+)\}\}/g` for the extended template. The `\[` and `\]` inside the character class are literal brackets. Keep the original `renderTemplate` unchanged for backwards compatibility with the code-agent and recurring task systems.

### Pitfall 7: TOCTOU in Path Containment
**What goes wrong:** Check path at load time, symlink gets swapped between load and runtime use.
**Why it happens:** Time-of-check vs time-of-use is a classic security vulnerability.
**How to avoid:** As specified in CONTEXT.md: check containment at BOTH load time AND immediately before runtime file reads. The `realpath()` call at runtime catches post-load symlink swaps.

## Code Examples

### Complete Manifest Schema Definition
```typescript
// Source: verified with Zod v4.3.6 in the project
import { z } from "zod";

export const EnvVarSchema = z.union([
  z.string().min(1),
  z.object({ name: z.string().min(1), value: z.string() })
]);

export const BeadSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  env: z.array(EnvVarSchema).optional(),
  timeout: z.string().optional(),
  outputSchema: z.record(z.string(), z.unknown()),
}).strict().superRefine((bead, ctx) => {
  // Prompt must be relative (no leading slash)
  if (bead.prompt.startsWith('/')) {
    ctx.addIssue({ code: 'custom', path: ['prompt'], message: 'must be a relative path (no leading slash)' });
  }
});

export const ManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  model: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  env: z.array(EnvVarSchema).optional(),
  timeout: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  beads: z.array(BeadSchema).min(1).superRefine((beads, ctx) => {
    const names = beads.map((b) => b.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length > 0) {
      ctx.addIssue({ code: 'custom', message: `Duplicate bead names: ${[...new Set(dupes)].join(', ')}` });
    }
  }),
}).strict();

export type Manifest = z.infer<typeof ManifestSchema>;
```

### Manifest Loader All-Errors Pattern
```typescript
// Source: derived from existing src/core/config.ts pattern (verified working)
import { parse as parseYaml } from "yaml";
import { ManifestSchema } from "./manifest-schema.js";
import { ManifestError } from "../core/errors.js";

export async function loadManifest(agentDir: string, agentsRoot: string): Promise<LoadedManifest> {
  const manifestPath = path.join(agentDir, "manifest.yaml");

  // Path containment check before any file read
  await assertContained(agentDir, agentsRoot, "agent directory");

  const content = await fs.readFile(manifestPath, "utf-8");

  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    throw new ManifestError(`Invalid YAML in ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${manifestPath}: ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ManifestError(`Manifest validation failed:\n${issues}`);
  }

  return resolveManifest(result.data, agentDir);
}
```

### Env Var Resolution for Subprocess
```typescript
// Source: derived from existing src/agent/bead-runner.ts buildBeadEnv pattern
const OS_ESSENTIALS: (keyof NodeJS.ProcessEnv)[] = ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR'];

export function buildBeadEnvFromManifest(resolvedEnv: ResolvedEnvVar[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // OS essentials first
  for (const key of OS_ESSENTIALS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // Declared vars only
  for (const entry of resolvedEnv) {
    env[entry.name] = entry.value;
  }
  return env;
}
```

### Error Class Addition
```typescript
// Add to src/core/errors.ts
export class ManifestError extends NightShiftError {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

export class ManifestSecurityError extends NightShiftError {
  constructor(message: string) {
    super(message);
    this.name = "ManifestSecurityError";
  }
}

export class BeadContractViolationError extends NightShiftError {
  constructor(message: string) {
    super(message);
    this.name = "BeadContractViolationError";
  }
}

export class BeadOutputMissingError extends NightShiftError {
  constructor(message: string) {
    super(message);
    this.name = "BeadOutputMissingError";
  }
}

export class RegistryError extends NightShiftError {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ajv for JSON Schema validation | `z.fromJSONSchema()` (Zod v4 built-in) | Zod v4 (2024-2025) | No new dependency; Zod already installed |
| Handlebars for template vars | Simple `{{word}}` regex replace | Already simplified | Need to extend regex for dot notation; no full Handlebars needed |
| JSON Schema `$ref` / `allOf` | Inline flat JSON Schema | Project design choice | Avoids dereferencing complexity; `z.fromJSONSchema` handles it |

**Deprecated/outdated:**
- Handlebars library: Not needed — the simpler `{{}}` substitution with an extended regex handles the full requirement without adding a dependency.

## Open Questions

1. **Which OS essentials env vars beyond PATH/HOME/USER/SHELL/TMPDIR?**
   - What we know: CONTEXT.md specifies "PATH, HOME, USER, SHELL, TMPDIR" as the decided set
   - What's unclear: Whether `LANG`, `TERM`, `TMPDIR` (Darwin vs Linux spelling) need to be included; the existing `buildBeadEnv` also passes `LANG` and `TERM`
   - Recommendation: Match the existing `buildBeadEnv` pattern (also include `LANG`, `TERM`) for consistency; Claude's Discretion applies here

2. **How to validate `allowedTools` against known Claude tool names?**
   - What we know: CONTEXT.md says "validate `allowedTools` against known Claude tool names at load time (reject unknown tools)"
   - What's unclear: The set of "known Claude tool names" — it changes with Claude versions; the existing code uses freeform strings
   - Recommendation: Define a static allowlist of current tool names (`Bash`, `Read`, `Write`, `WebFetch`, `WebSearch`, `Edit`, `mcp__*` wildcard), warn/error on unrecognized names that don't match `mcp__*` pattern

3. **`z.fromJSONSchema()` stability in Zod v4?**
   - What we know: Verified working in v4.3.6 for object/enum/array/nested schemas
   - What's unclear: Whether the function is considered stable API in Zod v4 or might change
   - Recommendation: Wrap in a try/catch at load time; if it throws, provide a clear error message; confidence MEDIUM that it's stable (it's in the published API)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.1.x |
| Config file | `vitest.config.ts` (root) — `include: ["tests/**/*.test.ts"]` |
| Quick run command | `npx vitest run tests/unit/manifest-schema.test.ts tests/unit/manifest-loader.test.ts tests/unit/bead-registry.test.ts tests/unit/bead-plugin.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MFST-01 | Valid manifest passes Zod validation; missing required field produces human-readable error with path | unit | `npx vitest run tests/unit/manifest-schema.test.ts -t "valid manifest"` | ❌ Wave 0 |
| MFST-01 | Missing field error identifies field path and file path | unit | `npx vitest run tests/unit/manifest-schema.test.ts -t "missing required"` | ❌ Wave 0 |
| MFST-01 | Unknown fields in manifest are rejected (.strict()) | unit | `npx vitest run tests/unit/manifest-schema.test.ts -t "unknown field"` | ❌ Wave 0 |
| MFST-01 | Duplicate bead names are rejected | unit | `npx vitest run tests/unit/manifest-schema.test.ts -t "duplicate bead"` | ❌ Wave 0 |
| MFST-02 | Agent directory outside agents root (via symlink) is rejected with path-containment error | unit | `npx vitest run tests/unit/manifest-loader.test.ts -t "path containment"` | ❌ Wave 0 |
| MFST-02 | Valid agent directory within root loads manifest successfully | unit | `npx vitest run tests/unit/manifest-loader.test.ts -t "loads valid"` | ❌ Wave 0 |
| MFST-03 | Built-in variables (`{{task_id}}`, `{{run_date}}`, etc.) take precedence over user-defined vars | unit | `npx vitest run tests/unit/template-agent.test.ts -t "built-in precedence"` | ❌ Wave 0 |
| MFST-03 | Collision between user-defined variable and built-in name produces hard error | unit | `npx vitest run tests/unit/template-agent.test.ts -t "collision error"` | ❌ Wave 0 |
| MFST-03 | Prompt with undefined variable reference fails at load time | unit | `npx vitest run tests/unit/template-agent.test.ts -t "undefined variable"` | ❌ Wave 0 |
| MFST-03 | Dot notation `{{beads.analyze.output.summary}}` resolves correctly | unit | `npx vitest run tests/unit/template-agent.test.ts -t "dot notation"` | ❌ Wave 0 |
| MFST-03 | Array indexing `{{beads.analyze.output.results[0].name}}` resolves correctly | unit | `npx vitest run tests/unit/template-agent.test.ts -t "array indexing"` | ❌ Wave 0 |
| PLUG-01 | BeadPlugin interface is correctly typed; implements single execute() method | unit (type check) | `npm run typecheck` | ❌ Wave 0 |
| PLUG-02 | BeadRegistry resolves registered type to factory function | unit | `npx vitest run tests/unit/bead-registry.test.ts -t "resolves"` | ❌ Wave 0 |
| PLUG-02 | BeadRegistry throws RegistryError for unknown type | unit | `npx vitest run tests/unit/bead-registry.test.ts -t "unknown type"` | ❌ Wave 0 |
| PLUG-03 | Bead output matching declared schema passes validation | unit | `npx vitest run tests/unit/manifest-loader.test.ts -t "output schema valid"` | ❌ Wave 0 |
| PLUG-03 | Bead output violating schema throws BEAD_CONTRACT_VIOLATION | unit | `npx vitest run tests/unit/manifest-loader.test.ts -t "contract violation"` | ❌ Wave 0 |
| PLUG-03 | Bead with no JSON block triggers BEAD_OUTPUT_MISSING | unit | `npx vitest run tests/unit/manifest-loader.test.ts -t "output missing"` | ❌ Wave 0 |
| PLUG-04 | Per-bead model overrides agent-level model | unit | `npx vitest run tests/unit/manifest-loader.test.ts -t "bead model override"` | ❌ Wave 0 |
| PLUG-04 | Bead env merges with agent-level env (bead wins collision) | unit | `npx vitest run tests/unit/manifest-loader.test.ts -t "env merge"` | ❌ Wave 0 |
| PLUG-04 | Bead allowedTools overrides agent-level allowedTools entirely | unit | `npx vitest run tests/unit/manifest-loader.test.ts -t "allowedTools override"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/unit/manifest-schema.test.ts tests/unit/manifest-loader.test.ts tests/unit/bead-registry.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/manifest-schema.test.ts` — covers MFST-01 (Zod schema validation, all-errors, .strict())
- [ ] `tests/unit/manifest-loader.test.ts` — covers MFST-02 (path containment), PLUG-03 (output validation), PLUG-04 (inheritance resolution)
- [ ] `tests/unit/template-agent.test.ts` — covers MFST-03 (built-in precedence, dot notation, array indexing, undefined variable detection)
- [ ] `tests/unit/bead-registry.test.ts` — covers PLUG-02 (registry resolve, unknown type error)
- [ ] `src/agent/bead-plugin.ts` — PLUG-01 (interface definition; validated by typecheck, not a runtime test file)

All test infrastructure (Vitest, `fs.mkdtemp` temp dirs, `vi.mock`) is already in place — matching the patterns in `tests/unit/config.test.ts` and `tests/unit/prompt-loader.test.ts`.

## Sources

### Primary (HIGH confidence)
- Zod v4.3.6 (installed) — verified via runtime execution: `.strict()`, `.safeParse()` all-errors, `.superRefine()`, `z.fromJSONSchema()`, union types, record types — all tested with actual code
- Node.js built-in `fs.realpath` — standard API, verified working for symlink resolution and containment check pattern
- `src/core/config.ts` — project's own Zod schema pattern (CategoryScheduleSchema, CodeAgentSchema) — HIGH confidence in project conventions

### Secondary (MEDIUM confidence)
- `src/agent/bead-runner.ts` `buildBeadEnv` — existing env isolation pattern for OS essentials list (`HOME`, `PATH`, `USER`, `LANG`, `SHELL`, `TERM`)
- `src/utils/template.ts` `renderTemplate` — existing template approach to extend; confirmed regex does NOT support dot notation (verified with runtime test)

### Tertiary (LOW confidence)
- `z.fromJSONSchema()` stability across Zod minor versions — API is present in v4.3.6 but stability not confirmed via changelog

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed, tested in project
- Architecture: HIGH — patterns derived from existing working code in the project; key APIs verified with runtime execution
- Pitfalls: HIGH — verified through runtime experiments (path separator, regex behavior) and code reading

**Research date:** 2026-02-26
**Valid until:** 2026-05-26 (stable libraries, project-internal patterns)
