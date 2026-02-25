# Stack Research

**Domain:** Pluggable agent template system with composable bead plugins and generic execution engine
**Researched:** 2026-02-25
**Confidence:** HIGH

## Context

This is an additive research pass for v2.0 on top of the existing validated stack (Node.js 22, TypeScript strict, ESM, Zod 4.3.x, vitest, Commander, croner, yaml, chalk, date-fns). The research below covers ONLY what new capabilities require. Existing dependencies are not re-evaluated.

The three new capabilities are:
1. **Agent template loading** — discover and load agent directories (prompt files + manifest.yaml)
2. **Composable bead plugins with typed I/O** — bead definitions with Zod-validated input/output contracts
3. **Generic engine** — config schema for multi-agent scheduling, replaces hardcoded `code_agent` section

---

## New Stack Requirements

### 1. Agent Template Discovery and Manifest Loading

**Verdict: No new npm dependency needed.**

Agent template directories are discovered with `node:fs/promises` using `readdir` with `{ withFileTypes: true }` to enumerate subdirectories. Each template directory contains a `manifest.yaml` validated by an extension to the existing Zod schema. Manifest parsing uses the `yaml` package already present in the project.

**Why `node:fs/promises.readdir` and not `fs.promises.glob`:**
Node.js 22 introduced `fs.promises.glob` (un-flagged in v22.2.0) but it still emits `ExperimentalWarning` at runtime in Node 22.x and a stability bug was reported in Node 24. A two-step `readdir` + `stat/isDirectory()` scan is stable, zero-risk, and sufficient for discovering top-level agent directories. The project has no deeply nested plugin trees requiring recursive glob traversal.

**Discovery pattern (uses existing APIs):**
```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml"; // already a dependency

async function discoverAgentTemplates(agentsDir: string): Promise<AgentTemplate[]> {
  const entries = await fs.readdir(agentsDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());

  const templates: AgentTemplate[] = [];
  for (const dir of dirs) {
    const manifestPath = path.join(agentsDir, dir.name, "manifest.yaml");
    try {
      const raw = await fs.readFile(manifestPath, "utf-8");
      const parsed = parseYaml(raw);
      const manifest = AgentManifestSchema.parse(parsed); // Zod
      templates.push({ id: dir.name, dir: path.join(agentsDir, dir.name), manifest });
    } catch {
      // skip invalid/missing manifests — report but don't abort
    }
  }
  return templates;
}
```

**Manifest format (manifest.yaml):**
The manifest establishes the agent identity, its bead pipeline, and its config requirements. Based on patterns from Claude Code plugin system, Google ADK YAML configs, and the `.agents/` spec, the following fields are standard:

```yaml
# manifest.yaml — required fields
name: code-agent
version: "1.0"
description: "Clones a GitLab repo and creates a focused improvement MR"

beads:
  - id: analyze
    prompt: prompts/analyze.md
    model: claude-opus-4-6
    allowed_tools: [Bash, Read, Write]
    output_schema: analysis_result
  - id: implement
    prompt: prompts/implement.md
    model: claude-opus-4-6
    allowed_tools: [Bash, Read, Write]
    depends_on: analyze
  - id: verify
    prompt: prompts/verify.md
    model: claude-sonnet-4-6
    allowed_tools: [Bash, Read, Write]
    depends_on: implement
    output_schema: verify_result
  - id: mr
    prompt: prompts/mr.md
    model: claude-sonnet-4-6
    allowed_tools: [Bash, Read, Write]
    depends_on: verify
    token_env_vars: [GITLAB_TOKEN]

config_schema:
  repo_url: string
  confluence_page_id: string
  category_schedule: object
```

**Confidence:** HIGH — uses `readdir` (stable Node.js built-in), `yaml` (existing dep), Zod (existing dep).

---

### 2. Composable Bead Plugins with Typed I/O

**Verdict: Use existing Zod 4.3.x. No new dependency needed.**

Typed bead I/O is implemented with Zod discriminated unions and schema composition — both significantly improved in Zod v4. Each bead declares its output schema as a named Zod schema. The engine validates the handoff JSON file written by each bead against the declared output schema before passing it to the next bead.

**Why Zod (not AJV) for bead I/O validation:**
- AJV is 5-18x faster but requires a 4ms startup cost, which matters in CLI/daemon contexts
- AJV does not natively infer TypeScript types — requires additional codegen
- Zod infers types directly: `z.infer<typeof BeadOutputSchema>` gives the TypeScript type at zero cost
- Zod v4 discriminated unions now compose and support union/pipe discriminators — exactly the right tool for typed bead result variants
- The project already uses Zod for config validation; bead I/O uses the same mental model

**Bead output schema pattern:**

```typescript
// Named, composable output schemas for each bead type
export const AnalysisResultSchema = z.discriminatedUnion("result", [
  z.object({
    result: z.literal("IMPROVEMENT_FOUND"),
    categoryUsed: z.string(),
    selected: z.object({
      description: z.string(),
      files: z.array(z.string()),
      rationale: z.string(),
    }),
  }),
  z.object({
    result: z.literal("NO_IMPROVEMENT"),
    categoryUsed: z.string(),
    reason: z.string(),
  }),
]);
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const VerifyResultSchema = z.object({
  passed: z.boolean(),
  error_details: z.string().optional(),
});
export type VerifyResult = z.infer<typeof VerifyResultSchema>;

// Registry maps bead output_schema names to Zod schemas
export const BEAD_OUTPUT_SCHEMAS = {
  analysis_result: AnalysisResultSchema,
  verify_result: VerifyResultSchema,
} as const;
```

**Handoff validation in engine:**
The engine reads the handoff JSON file after each bead and calls `schema.safeParse(parsed)`. On failure, the engine treats the bead as if it produced NO_IMPROVEMENT (same as current error handling for missing handoff files), preserving the existing fallback semantics.

**What "composable" means here:**
Beads are composable because the manifest declares `depends_on` relationships. The engine resolves the dependency graph and passes the validated output of upstream beads as template variables to downstream bead prompts. No bead hardcodes knowledge of another bead's position in the pipeline.

**Confidence:** HIGH — Zod v4 discriminated unions and schema composition verified at zod.dev/v4.

---

### 3. Generic Engine and Config Schema for Multi-Agent Scheduling

**Verdict: Replace the hardcoded `code_agent` config section with a generic `agents` array. No new dependency needed.**

The existing `NightShiftConfig.codeAgent` is a single hardcoded object. v2.0 replaces it with an `agents` array where each entry references an agent template by ID and provides agent-specific config values. The Zod config schema extension follows the same additive pattern used in v1.0.

**New config schema (nightshift.yaml):**
```yaml
agents:
  - id: nightly-scala-improvements
    template: code-agent               # directory name under agents_dir
    schedule: "0 2 * * 1-5"           # cron expression
    notify: true
    config:
      repo_url: git@gitlab.com:team/repo.git
      confluence_page_id: "123456"
      category_schedule:
        monday: [tests]
        tuesday: [refactoring]
        wednesday: [docs]
      reviewer: jsmith

agents_dir: ~/.nightshift/agents      # where template directories live
```

**Zod schema extension:**
```typescript
const AgentInstanceSchema = z.object({
  id: z.string().min(1),
  template: z.string().min(1),
  schedule: z.string().min(1),
  notify: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()), // agent-specific, validated against manifest config_schema
});

const ConfigSchema = z.object({
  // ... existing fields ...
  agents_dir: z.string().default("~/.nightshift/agents"),
  agents: z.array(AgentInstanceSchema).default([]),
  // code_agent: kept for backward compatibility, deprecated
  code_agent: CodeAgentSchema, // existing schema, marked deprecated in docs
});
```

**Backward compatibility:** The existing `code_agent` key is preserved and the engine auto-converts it to an `AgentInstance` at load time, referencing the built-in `code-agent` template. No existing `nightshift.yaml` files break.

**Generic engine dispatch:**
The daemon's orchestrator switches from calling `runCodeAgentPipeline()` directly to calling `runAgentPipeline(instance, template)`. The `runAgentPipeline` function loads the manifest, resolves bead prompts, and executes beads in dependency order — the same 4-bead pipeline logic refactored to be template-driven rather than hardcoded.

**Confidence:** HIGH — follows exact same Zod config extension pattern already validated in v1.0.

---

## Recommended Stack (New Additions Summary)

### Core Technologies (unchanged)

All v1.0 technologies remain as-is. No version bumps required.

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| Node.js | 22+ | Runtime | Unchanged |
| TypeScript strict | 5.7+ | Type safety | Unchanged |
| Zod | 4.3.x | Config and bead I/O schema validation | Extended, not version-bumped |
| yaml | 2.8.x | YAML parsing for manifests | Already used for nightshift.yaml |
| croner | 10.x | Cron scheduling | Unchanged |
| vitest | 3.x | Tests | Unchanged |

### New Additions

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `node:fs/promises.readdir` (built-in) | Node 22+ | Template directory discovery | Zero-dep, `{ withFileTypes: true }` returns `Dirent` objects for `isDirectory()` check |

**That is the complete list of new additions.** All v2.0 capability is achieved by composing existing dependencies in new patterns.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `fast-glob`, `tinyglobby`, `glob` | Template scanning is a flat `readdir` one level deep — no recursive glob needed. CVE-2025-64756 hit the `glob` package in late 2025, adding security noise for zero benefit | `fs.promises.readdir` with `{ withFileTypes: true }` |
| `fs.promises.glob` (built-in) | Still emits `ExperimentalWarning` in Node 22.x; bug report open in Node 24. Not stable enough for a tool that runs autonomously | `fs.promises.readdir` |
| AJV / Typebox | Faster than Zod but requires separate type generation step; 4ms startup cost per validation matters in CLI/daemon contexts; project already uses Zod throughout | Zod 4.3.x (existing) |
| JSON manifest format (`manifest.json`) | YAML is already parsed in the project (nightshift.yaml); YAML manifests are consistent with the config format users already edit; comments are supported in YAML | `manifest.yaml` parsed with existing `yaml` package |
| `zod-file` or `@niiju/safe-yaml-env` | These wrap `fs.readFile` + `yaml.parse` + `z.parse` — exactly what the project already does in `config.ts`. Adding wrappers for a 3-line pattern adds a dependency with no API benefit | Inline `readFile` + `parseYaml` + `ZodSchema.parse` |
| Dynamic `import()` for agent code modules | Agent logic lives in prompt files and bead definitions, not compiled JS modules. There is nothing to `import()` at runtime. Agent behavior is entirely prompt-driven via `claude -p` | Template variable injection into markdown prompts |
| Dependency injection framework | The engine's "plugin" surface is YAML manifests, not TypeScript classes. No IoC container is needed when plugins are data (manifests + prompts), not code | Plain TypeScript functions with explicit arguments |

---

## Integration Points

| New Capability | Hooks Into | How |
|----------------|-----------|-----|
| Agent template discovery | New `src/agent/template-loader.ts` | `readdir` + manifest parse on `agents_dir` at daemon startup |
| Manifest Zod schema | `src/core/config.ts` | `AgentManifestSchema` defined alongside existing config schemas |
| Bead output schemas | New `src/agent/bead-schemas.ts` | `BEAD_OUTPUT_SCHEMAS` registry, validated in `runBead` before returning |
| Generic engine | `src/agent/engine.ts` (renamed from `code-agent-runner.ts`) | `runAgentPipeline(instance, template)` replaces `runCodeAgentPipeline(ctx)` |
| Config `agents` array | `src/core/config.ts` + `src/core/types.ts` | New `AgentInstance[]` field, `code_agent` auto-converted at load time |
| Multi-agent scheduling | `src/daemon/scheduler.ts` | Iterates `config.agents` to schedule all instances; existing `code_agent` compat shim |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Zod 4.3.x | TypeScript 5.7+ | Already installed; discriminated union composition is a v4 feature |
| yaml 2.8.x | TypeScript 5.9+ min (can use `skipLibCheck: true` for earlier) | Already installed; `parse` + `stringify` named exports work in ESM |
| Node.js 22 `readdir` | All target Node 20+ versions | `{ withFileTypes: true }` is stable API since Node 10.10 |

---

## Alternatives Considered

| Recommended | Alternative | When Alternative Makes Sense |
|-------------|-------------|------------------------------|
| `readdir` + manual manifest parse | `fast-glob` pattern `**/manifest.yaml` | Only if agent templates are nested more than one level deep (out of scope) |
| Zod for bead I/O schemas | AJV | AJV is better for high-throughput server APIs validating thousands of objects/sec; overkill for 5 bead handoffs per agent run |
| `manifest.yaml` for template metadata | `manifest.json` | JSON when manifests are machine-generated and comments are never needed |
| Flat `agents_dir` scan | npm-registry-style agent packages | Registry model makes sense if agents are distributed as npm packages; copying directories is simpler for an autonomous local tool |

---

## Sources

- [Zod v4 Release Notes](https://zod.dev/v4) — Discriminated union composition, schema performance, current stable version 4.3.x (HIGH confidence, official docs)
- [Node.js fs.promises.glob experimental status](https://github.com/nodejs/node/issues/58343) — Confirms ExperimentalWarning still present in Node 24; supports `readdir` choice (HIGH confidence, official issue tracker)
- [Node.js fs API docs](https://nodejs.org/api/fs.html) — `readdir` with `withFileTypes`, `Dirent.isDirectory()`, promise API (HIGH confidence, official docs)
- [yaml npm package](https://www.npmjs.com/package/yaml) — ESM named exports, TypeScript support, 85M+ weekly downloads (HIGH confidence, official npm)
- [glob CVE-2025-64756](https://medium.com/@balazs.csaba.diy/whats-this-glob-npm-madness-suddenly-every-node-js-image-is-vulnerable-but-why-1ba1b0cbad97) — Security vulnerability in glob package ecosystem (MEDIUM confidence, WebSearch)
- [AJV vs Zod comparison](https://betterstack.com/community/guides/scaling-nodejs/typebox-vs-zod/) — Performance and TypeScript integration tradeoffs (MEDIUM confidence, WebSearch)
- [agentsfolder/spec](https://github.com/agentsfolder/spec) — Open specification for shareable agent directory structure with manifest.yaml (MEDIUM confidence, WebSearch)

---

*Stack research for: night-shift v2.0 pluggable agent architecture*
*Researched: 2026-02-25*
