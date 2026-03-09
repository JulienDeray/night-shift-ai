# Phase 9: Code-Agent Migration - Research

**Researched:** 2026-02-27
**Domain:** Agent directory packaging, manifest-driven pipeline design, prompt adaptation
**Confidence:** HIGH (all findings from direct codebase inspection)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Migration fidelity**
- Adapt to new architecture — not a 1:1 v1.0 clone
- Outcome shape parity only: same final results (MR_CREATED, NO_IMPROVEMENT, etc.) and same MR quality; internal pipeline steps can differ in how they get there
- Behaviors that don't fit the manifest model cleanly should be redesigned to work declaratively within the manifest/engine model (manifest-native approach)
- All v1.0 behaviors migrate — nothing is dropped

**Agent directory layout**
- Agents root path is configurable in nightshift.yaml (default to project-level `agents/`)
- Prompt files live in a `prompts/` subfolder: `agents/code-agent/prompts/analyze.md`, etc.
- Category guidance text lives as template variables in nightshift.yaml agent config — prompts use `{{category_guidance}}` resolved from config
- Agent directory is fully self-contained — everything the agent needs is in its directory; config overrides come from nightshift.yaml but the agent works standalone

**Retry & fallback policy**
- Implement+verify retry expressed as bead-level retry config in manifest: `retry: {maxAttempts: 3, retryFrom: 'implement'}` (engine handles the loop declaratively)
- On retry, the implementation bead receives the verify error details via a template variable (same as v1.0's `verify_error` approach, just manifest-native)
- Category fallback logic lives in the daemon/orchestrator layer, NOT in AgentEngine — the engine runs one category; if it yields NO_IMPROVEMENT, the caller decides what to do
- Fallback category order is configurable per agent in nightshift.yaml (defaults to current fixed order: tests → refactoring → docs → security → performance)

**Log bead**
- The Confluence log bead is a regular mandatory bead in the manifest pipeline — not best-effort
- If it fails to log to Confluence, the pipeline reports failure like any other bead
- Code-agent specific — other future agents may or may not have a log bead
- Allowed tools: Atlassian MCP tools + Read tool (so it can inspect local files to build Confluence entries)
- MCP config for Atlassian is provided via the manifest/config
- Receives previous bead outputs via standard template variables (`{{beads.analyze.output.*}}`, `{{beads.mr.output.*}}`, etc.)
- Same Confluence content format as v1.0: JSONL-style entry with date, category, MR URL, cost, duration

### Claude's Discretion
- Exact manifest YAML structure and field naming (within the decided patterns)
- Prompt content adaptation for the new template variable system
- Engine extensions needed for bead-level retry support
- How `agents_root` config field integrates with existing nightshift.yaml schema
- Integration test design for parity verification

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MIGR-01 | Code-agent exists as `agents/code-agent/` directory with manifest.yaml and prompt files — no functionality lost from v1.0 | Full codebase analysis of v1.0 pipeline, engine, plugins, schema. All gaps and extension points identified. |
</phase_requirements>

---

## Summary

Phase 9 packages the existing v1.0 code-agent pipeline (analyze → implement → verify → mr → log) into the manifest-driven `AgentEngine` architecture built in Phases 5-8. The existing engine and plugin infrastructure is largely ready; this phase's main work is (1) creating the `agents/code-agent/` directory with `manifest.yaml` and adapted prompt files, (2) extending the engine and schema for bead-level retry and MCP config support, and (3) adapting prompts from the old file-based handoff model to the manifest's JSON code block output model.

The v1.0 pipeline uses a shared handoff file on disk for bead-to-bead communication. The manifest model passes bead outputs through `ctx.previousBeads` as structured data accessible via `{{beads.bead-name.output.*}}` template variables. Prompts must be rewritten to output JSON code blocks instead of writing to files, with one exception: the implement and verify beads still need on-disk coordination since implement writes code to the repo (not to stdout) and verify must inspect it.

Three engine extensions are required and scoped to this phase: (1) bead-level retry support (`retry.maxAttempts`, `retry.retryFrom`), (2) MCP config file path support in the manifest bead schema and `StandardBeadPlugin`, and (3) allowing `mcp__*` wildcard patterns in `KNOWN_CLAUDE_TOOLS` validation. Without these, the log bead and implement+verify retry loop cannot work.

**Primary recommendation:** Build the three engine extensions first (retry, MCP config in bead, mcp__ tools in schema), then create the agent directory with manifest and adapted prompts, then add an integration test that runs the engine against the real code-agent directory with mocked `runBead`.

---

## Standard Stack

### Core (all already in project — no new dependencies needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `yaml` | already installed | Parse/write manifest.yaml | Used throughout project for config/manifest |
| `zod` | already installed | Schema validation for manifest and bead outputs | Project standard |
| `vitest` | already installed | Test framework | Project standard |
| `node:fs/promises` | built-in | Read prompt files, agent directory | Used by all bead infrastructure |

### No New Packages Required

All infrastructure (engine, plugins, registry, template, manifest loader) is already in place from Phases 5-8. This phase is content creation (manifest + prompts) and targeted engine extensions.

---

## Architecture Patterns

### Recommended Project Structure

```
agents/
└── code-agent/
    ├── manifest.yaml          # full pipeline declaration
    └── prompts/
        ├── analyze.md         # adapted from src/agent/prompts/analyze.md
        ├── implement.md       # adapted from src/agent/prompts/implement.md
        ├── verify.md          # adapted from src/agent/prompts/verify.md
        ├── mr.md              # adapted from src/agent/prompts/mr.md
        └── log.md             # adapted from src/agent/prompts/log.md
```

The agent directory lives at the project root (same level as `src/`, `tests/`), matching the `agents_dir: ./agents` default in `config.ts`.

### Pattern 1: Manifest Declaration

The manifest declares the full 5-bead pipeline. All inheritance (model, timeout, allowedTools) applies agent-wide with per-bead overrides where needed.

```yaml
name: code-agent
description: Analyzes a repository nightly and creates a focused improvement MR

model: claude-opus-4-6       # default for heavy beads
timeout: 30m
allowedTools: [Bash, Read, Write, Edit, Glob, Grep]

variables:
  repo_url: ""                   # required override from nightshift.yaml
  category: ""                   # required override from nightshift.yaml
  category_guidance: ""          # required override from nightshift.yaml
  confluence_page_id: ""         # required override from nightshift.yaml
  reviewer: ""                   # optional override
  allowed_commands: "git, glab"  # can be overridden

beads:
  - name: clone
    type: git-clone
    prompt: prompts/clone.md      # minimal stub — git-clone plugin ignores prompt content
    outputSchema:
      type: object
      properties:
        repoDir: { type: string }
        handoffDir: { type: string }
      required: [repoDir, handoffDir]

  - name: analyze
    type: standard
    prompt: prompts/analyze.md
    model: claude-opus-4-6
    outputSchema:
      type: object
      properties:
        result: { type: string, enum: [IMPROVEMENT_FOUND, NO_IMPROVEMENT] }
        categoryUsed: { type: string }
        reason: { type: string }
        selected:
          type: object
          properties:
            rank: { type: integer }
            files: { type: array, items: { type: string } }
            description: { type: string }
            rationale: { type: string }
      required: [result, categoryUsed]

  - name: implement
    type: standard
    prompt: prompts/implement.md
    model: claude-opus-4-6
    retry:
      maxAttempts: 3
      retryFrom: implement        # retry from implement (not verify)
    outputSchema:
      type: object
      properties:
        status: { type: string, enum: [IMPLEMENTED] }
      required: [status]

  - name: verify
    type: standard
    prompt: prompts/verify.md
    model: claude-sonnet-4-6
    outputSchema:
      type: object
      properties:
        passed: { type: boolean }
        error_details: { type: string }
      required: [passed]

  - name: mr
    type: standard
    prompt: prompts/mr.md
    model: claude-sonnet-4-6
    env:
      - GITLAB_TOKEN               # passthrough — only mr bead receives it
    outputSchema:
      type: object
      properties:
        mr_url: { type: string }
        outcome: { type: string, enum: [MR_CREATED, MR_FAILED] }
      required: [outcome]

  - name: log
    type: standard
    prompt: prompts/log.md
    model: claude-sonnet-4-6
    timeout: 2m
    mcpConfig: "{{mcp_config_path}}"   # path to mcp-atlassian-config.json
    allowedTools:
      - mcp__atlassian__getAccessibleAtlassianResources
      - mcp__atlassian__getConfluencePage
      - mcp__atlassian__updateConfluencePage
      - Read
    outputSchema:
      type: object
      properties:
        logged: { type: boolean }
      required: [logged]
```

**Key insight on clone bead:** `GitCloneBeadPlugin` uses `ctx.workDir` (pre-created by `TempDirManager`) as the target repoDir. It returns `{ repoDir, handoffDir }` as JSON. The engine does NOT automatically update `ctx.workDir` — this needs investigation (see Open Questions).

### Pattern 2: Prompt Adaptation from v1.0

The v1.0 prompts use `{{date}}`, `{{handoff_file}}`, `{{analysis_file}}`, `{{build_commands}}`. These must be remapped to the manifest template system.

**Variable mapping:**

| v1.0 variable | Manifest equivalent | Source |
|---------------|--------------------|----|
| `{{date}}` | `{{run_date}}` | Built-in |
| `{{repo_url}}` | `{{repo_url}}` | Manifest variable (user provides) |
| `{{category}}` | `{{category}}` | Schedule-level variable override |
| `{{category_guidance}}` | `{{category_guidance}}` | Schedule-level variable override |
| `{{allowed_commands}}` | `{{allowed_commands}}` | Manifest variable (can be overridden) |
| `{{reviewer}}` | `{{reviewer}}` | Manifest variable (can be overridden) |
| `{{handoff_file}}` | REMOVED — beads no longer write to a file; use JSON code block output |
| `{{analysis_file}}` | REMOVED — implement/mr access analyze output via `{{beads.analyze.output.selected}}` |
| `{{verify_error}}` | `{{retry_error}}` | Injected by engine on retry |
| `{{build_commands}}` | `{{allowed_commands}}` | Same variable, renamed |
| `{{short_description}}` | Derived inside mr prompt from `{{beads.analyze.output.selected.description}}` |
| `{{confluence_page_id}}` | `{{confluence_page_id}}` | Manifest variable |
| `{{mr_url}}` | `{{beads.mr.output.mr_url}}` | Previous bead output |
| `{{cost_usd}}`, `{{duration_seconds}}`, `{{summary}}` | Computed by log prompt from `{{beads.*}}` | Previous bead outputs |

### Pattern 3: Output Schema vs. Handoff File

**v1.0 approach:** Beads write structured JSON to `{{handoff_file}}` on disk. The pipeline reads it back to pass data forward.

**Manifest approach:** Beads output JSON code blocks to stdout. Engine validates against `outputSchema` and stores in `ctx.previousBeads[beadName].output`. Downstream beads access via `{{beads.analyze.output.selected.description}}`.

The **implement bead is an exception**: it modifies files in the working repo (not stdout). Its output schema just confirms success (`{ status: "IMPLEMENTED" }`). Verify then runs commands in the same working directory to check the changes.

### Pattern 4: Bead-Level Retry (Engine Extension)

The current engine (Phase 8) has NO retry support — it returns FATAL/TRANSIENT on any failure. The manifest CONTEXT requires `retry: {maxAttempts: 3, retryFrom: 'implement'}` on the verify bead.

The engine loop must be extended:
- When a bead with `retry` config fails and maxAttempts > 1: re-run from the `retryFrom` bead instead of failing immediately
- Inject verify error into `ctx.variables` as `retry_error` (or `verify_error`) for the implement bead to receive on retry
- Apply `git reset --hard HEAD` before retrying implement (same as v1.0 `resetRepo()`)

This is a non-trivial engine extension. It must remain generic (not code-agent-specific).

**Engine extension approach:**
- Add optional `retry` field to `BeadSchema` in manifest-schema.ts: `retry: z.object({ maxAttempts: z.number().int().positive(), retryFrom: z.string() }).optional()`
- Add `retry` to `ResolvedBead` in manifest-types.ts
- Extend the engine bead loop with retry state tracking

### Pattern 5: MCP Config Support (Engine Extension)

The log bead requires `--mcp-config <path>` passed to `claude`. Currently:
- `runBead()` in `bead-runner.ts` accepts `mcpConfigPath?: string`
- `StandardBeadPlugin.execute()` does NOT pass `mcpConfigPath` — it's missing
- `BeadSchema` has no `mcpConfig` field

Extensions needed:
1. Add `mcpConfig?: string` to `BeadSchema` (relative path within agent dir, resolved at load time)
2. Add `mcpConfig?: string` to `ResolvedBead`
3. Pass it through in `StandardBeadPlugin.execute()` → `runBead({ mcpConfigPath: ... })`

The mcpConfig path should follow the same relative-path convention as prompt files, resolved from the agent directory.

### Pattern 6: MCP Tools in Schema Validation

`KNOWN_CLAUDE_TOOLS` in `manifest-schema.ts` currently only lists built-in Claude tools:
```typescript
export const KNOWN_CLAUDE_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'WebFetch', 'WebSearch', 'Task', 'NotebookEdit',
] as const;
```

MCP tools use the `mcp__<server>__<method>` naming pattern. The log bead needs:
- `mcp__atlassian__getAccessibleAtlassianResources`
- `mcp__atlassian__getConfluencePage`
- `mcp__atlassian__updateConfluencePage`

**Solution options:**
1. Allow any string starting with `mcp__` (pattern-based validation) — most flexible
2. Add specific Atlassian tools to `KNOWN_CLAUDE_TOOLS` — narrow but safe

Option 1 is better for future agents. The `validateAllowedTools` function should accept `mcp__*` prefixed strings without complaint.

### Pattern 7: Injection Mitigation Preamble

The v1.0 `loadBeadPrompt()` prepends `INJECTION_MITIGATION_PREAMBLE` to all rendered prompts. The new `StandardBeadPlugin` uses `renderAgentTemplate()` directly without this preamble.

The preamble is a security measure: it reminds the LLM that repo file contents are data, not instructions. For the code-agent which reads untrusted repo files, this protection must be preserved.

**Solution:** Add preamble injection in `StandardBeadPlugin.execute()`, or add it to `renderAgentTemplate()`, or make it configurable in the manifest (`injectSecurityPreamble: true`). The cleanest approach is adding it in `StandardBeadPlugin` since it always applies to Claude subprocess beads that process repo content.

### Pattern 8: Category Fallback (Caller Responsibility)

v1.0 `runCodeAgentPipeline()` implements a category fallback loop (tries 5 categories). In the new architecture, this is the daemon/caller's responsibility per the locked decision.

The engine runs ONE pipeline with ONE category (passed as a variable). If the analyze bead outputs `NO_IMPROVEMENT`, the engine still returns SUCCESS (the pipeline ran correctly). The caller interprets the `finalOutput` to determine if it should try another category.

This means:
- The daemon (Phase 10) will implement the fallback loop
- For Phase 9's integration test, we only need to verify one category run correctly
- The `analyzeBeadOutputSchema` must include `result: IMPROVEMENT_FOUND | NO_IMPROVEMENT` so the caller can inspect `AgentRunResult.finalOutput`

**However:** the `finalOutput` in `AgentRunResult<T>` is the LAST bead's output (the log bead). To check if the analyze bead returned NO_IMPROVEMENT, the caller needs access to per-bead outputs. The current `AgentRunResult` only exposes `finalOutput` (last bead) and `perBead` (status/duration, not output). **This is a gap** — the caller cannot inspect intermediate bead outputs.

Possible solutions:
- Add `beadOutputs: Record<string, unknown>` to `AgentRunResult` — exposes all bead outputs
- Use a known output schema convention where the log bead echoes the outcome in its output
- Have the pipeline return a discriminated union based on what bead stopped last

The simplest fix: add `beadOutputs` to `AgentRunResult` so the daemon can check `result.beadOutputs['analyze']?.result`.

### Anti-Patterns to Avoid

- **File-based handoff in prompts:** Don't keep `{{handoff_file}}` in adapted prompts — this breaks the manifest model. Use `{{beads.analyze.output.*}}` for downstream access.
- **Category logic in engine:** No fallback loops or category-specific branching in the engine — it's the caller's job.
- **Hardcoding `code-agent` in engine:** The engine must remain zero-agent-specific. Any extensions (retry, MCP, preamble) must be manifest-configurable.
- **Copying old prompts verbatim:** The old prompts reference variables that don't exist in the manifest model. Every `{{handoff_file}}` and `{{analysis_file}}` reference must be replaced.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML serialization | Custom YAML writer | `yaml` package (already used) | Already handles manifest serialization |
| Schema validation | Custom JSON validator | Zod's `z.fromJSONSchema()` (already used) | Already compiled at manifest load |
| Path containment | Custom path check | `assertContained()` in manifest-loader.ts (already exists) | Already tested and handles symlinks |
| Template rendering | New template engine | `renderAgentTemplate()` in template.ts (already exists) | Already handles dot-notation, array indexing |
| Bead execution | Custom Claude subprocess | `runBead()` in bead-runner.ts (already exists) | Already handles env, mcpConfig, timeouts |
| Env var passthrough | Custom env builder | `buildBeadEnv()` in bead-runner.ts (already exists) | Already enforces allowlist |

**Key insight:** The only truly new code in this phase is (1) the agent directory content (`manifest.yaml` + 5 prompt files), (2) engine extensions (retry, mcpConfig, mcp__ validation), and (3) an integration test. Nothing needs to be built from scratch.

---

## Common Pitfalls

### Pitfall 1: WorkDir Not Updated After Clone Bead

**What goes wrong:** `GitCloneBeadPlugin.execute()` returns `{ repoDir, handoffDir }` as JSON output, but the engine does NOT automatically update `ctx.workDir` after the clone bead. Subsequent beads (analyze, implement, etc.) still use the original `repoDir` from `TempDirManager` (which is pre-created but empty).

**Why it happens:** The engine sets `ctx.workDir = repoDir` from `TempDirManager.create()` at startup. `GitCloneBeadPlugin` calls `cloneRepo(repoUrl, gitlabToken, repoDir)` with the pre-created dir as target, so the clone IS into the right place — but the `handoffDir` returned by `cloneRepo()` is a different path.

**Investigation needed:** In `git-harness.ts`, check what `cloneRepo(repoUrl, gitlabToken, repoDir)` returns when `repoDir` is provided. If it uses the provided dir as the clone target, then `ctx.workDir` is already correct for subsequent beads. But `handoffDir` from the clone result vs. `handoffDir` from `TempDirManager` may differ.

**How to avoid:** Check `git-harness.ts` carefully. The engine's `ctx.workDir` may already be correct (clone writes into the pre-created repoDir). The clone bead's output schema may not need to expose paths if the engine already sets them up correctly.

### Pitfall 2: Verify Bead Output vs. Engine Retry Decision

**What goes wrong:** The verify bead outputs `{ passed: false, error_details: "..." }` as a valid JSON code block that satisfies its outputSchema. The engine sees SUCCESS (schema valid), moves on. But the implement+verify retry is supposed to trigger on `passed: false`.

**Why it happens:** Output schema validation only checks shape, not semantic values. The engine can't distinguish "verify passed" from "verify failed" just from schema validation.

**How to avoid:** The retry mechanism needs to inspect the semantic content of the verify output, not just the schema. Two approaches:
1. Make the verify bead THROW (exit non-zero) on failure — engine treats it as TRANSIENT and retries. But this loses `error_details` for the implement bead.
2. Engine checks `verify.output.passed === false` and retries using the retry config. This requires the engine to understand `retry.retryFrom` and the bead's output semantics.

The manifest-native approach is option 2: the retry config on the verify bead includes a `failCondition` (or the engine checks the declared schema for a `passed: false` pattern). Given the locked decision uses `retry: {maxAttempts: 3, retryFrom: 'implement'}`, the engine must inspect `output.passed` to decide whether to retry — this should be part of the engine extension design.

**Alternative:** Use a different output schema for verify: output `{}` on success, throw on failure (non-zero exit). Then retry is driven by error category. But this loses the `error_details` needed by implement.

**Recommended approach:** The verify prompt instructs the agent to exit non-zero on failure (using `exit 1` in a Bash call) AND output error_details to stdout in a JSON block before exiting. The `StandardBeadPlugin` would then catch the non-zero exit as an error (TRANSIENT), and the retry mechanism provides `error_details` from `stderr` or the partial `rawOutput`.

Actually, the cleanest is: verify bead uses non-zero exit on failure, outputs error_details in its JSON block even on failure. The plugin throws on non-zero exit BUT captures the JSON output from stdout first before throwing. This is a change to `StandardBeadPlugin`.

### Pitfall 3: `mcpConfig` Path Resolution

**What goes wrong:** The log bead's `mcpConfig` path (e.g., `mcp-atlassian-config.json`) is relative to the agent directory in the manifest but needs to be an absolute path when passed to `runBead()`.

**How to avoid:** Resolve the `mcpConfig` path relative to `manifest.agentDir` at manifest load time (same pattern as prompt file paths). Store the absolute path in `ResolvedBead.mcpConfig`.

### Pitfall 4: Injection Preamble Missing for New Plugin Path

**What goes wrong:** v1.0 prompts prepend `INJECTION_MITIGATION_PREAMBLE` via `loadBeadPrompt()`. The new `StandardBeadPlugin` uses `renderAgentTemplate()` directly — NO preamble. Code-agent beads read untrusted repo files and are vulnerable to prompt injection.

**How to avoid:** Add preamble injection in `StandardBeadPlugin.execute()` before calling `runBead()`. Since this protects ALL standard beads (not just code-agent), it's the right place. Alternatively, make it opt-in via a manifest flag `injectSecurityPreamble: true`.

### Pitfall 5: Template Variables Not Provided for All Prompts

**What goes wrong:** Prompt templates reference variables that aren't declared in the manifest `variables` block or provided as schedule overrides. `validateTemplateVars` throws at startup, blocking the daemon.

**How to avoid:** Before writing prompts, enumerate ALL `{{placeholder}}` patterns and ensure each maps to a built-in, a manifest variable, or a schedule override. Key variables that must be present:
- `repo_url` — manifest variable (user provides in nightshift.yaml `agents.variables`)
- `category` — schedule variable override
- `category_guidance` — schedule variable override
- `allowed_commands` — manifest variable with a sensible default
- `reviewer` — manifest variable, defaults to `""`
- `confluence_page_id` — manifest variable (user provides)
- `mcp_config_path` — manifest variable (user provides, or optional with conditional)

### Pitfall 6: Category Fallback Output Not Accessible to Caller

**What goes wrong:** After the pipeline runs, the caller needs to know if the analyze bead returned `NO_IMPROVEMENT` to decide whether to try another category. But `AgentRunResult.finalOutput` is the LOG bead's output, not the analyze bead's.

**How to avoid:** Extend `AgentRunResult` with `beadOutputs: Record<string, unknown>` so the caller can check `result.beadOutputs['analyze']?.result === 'NO_IMPROVEMENT'`. This is a small engine extension but necessary for the daemon to implement category fallback in Phase 10.

---

## Code Examples

### Engine Retry Extension (manifest-schema.ts)

```typescript
// Add to BeadSchema:
const RetrySchema = z.object({
  maxAttempts: z.number().int().positive().max(10),
  retryFrom: z.string().min(1),
}).strict();

export const BeadSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  env: z.array(EnvVarSchema).optional(),
  timeout: z.string().optional(),
  mcpConfig: z.string().optional(),    // NEW: relative path to MCP config file
  retry: RetrySchema.optional(),        // NEW: retry configuration
  outputSchema: z.record(z.string(), z.unknown()),
}).strict().superRefine(/* ... */);
```

### MCP Tools Pattern in validateAllowedTools

```typescript
function validateAllowedTools(tools: string[] | undefined, ctx: z.RefinementCtx, pathPrefix: string[]): void {
  if (!tools) return;
  const knownSet = new Set<string>(KNOWN_CLAUDE_TOOLS);
  const unknown = tools.filter((t) => !knownSet.has(t) && !t.startsWith('mcp__'));
  // ↑ allow any mcp__* tool — validated at runtime by Claude CLI
  for (const tool of unknown) {
    ctx.addIssue({
      code: 'custom',
      path: [...pathPrefix, 'allowedTools'],
      message: `Unknown tool "${tool}". Known tools: ${KNOWN_CLAUDE_TOOLS.join(', ')}, or any mcp__* tool`,
    });
  }
}
```

### StandardBeadPlugin with mcpConfig + Preamble

```typescript
// In StandardBeadPlugin.execute():
const rawPrompt = await fs.readFile(path.join(ctx.agentDir, ctx.currentBead.prompt), "utf-8");
const renderedPrompt = INJECTION_MITIGATION_PREAMBLE + "\n---\n\n" + renderAgentTemplate(rawPrompt, ctx.variables);

const mcpConfigPath = ctx.currentBead.mcpConfig
  ? path.join(ctx.agentDir, ctx.currentBead.mcpConfig)
  : undefined;

const result = await runBead({
  beadName: ctx.currentBead.name,
  prompt: renderedPrompt,
  model: ctx.currentBead.model,
  cwd: ctx.workDir,
  timeoutMs,
  gitlabToken,
  allowedTools: ctx.currentBead.allowedTools,
  mcpConfigPath,   // NEW
});
```

### Analyze Bead Output (adapted prompt output section)

```markdown
## Output

Output the following JSON code block and then stop. Do not write any files.

\`\`\`json
{
  "result": "IMPROVEMENT_FOUND",
  "categoryUsed": "{{category}}",
  "reason": "Brief explanation",
  "candidates": [...],
  "selected": {
    "rank": 1,
    "files": ["path/to/file.ext"],
    "description": "Short description",
    "rationale": "Why this change is valuable"
  }
}
\`\`\`
```

### Log Bead Accessing Previous Bead Outputs

```markdown
## Run Record

- Date: {{run_date}}
- Category: {{beads.analyze.output.categoryUsed}}
- MR URL: {{beads.mr.output.mr_url}}
- Outcome: {{beads.mr.output.outcome}}
- Confluence Page: {{confluence_page_id}}
```

### Integration Test Pattern (vitest, mocking runBead)

```typescript
// tests/unit/code-agent-integration.test.ts
// Uses the real agents/code-agent/ directory with mocked runBead
vi.mock("../../src/agent/bead-runner.js", () => ({ runBead: vi.fn() }));

it("runs code-agent pipeline and returns SUCCESS with MR_CREATED outcome", async () => {
  const agentsRoot = path.resolve("agents");
  const agentDir = path.join(agentsRoot, "code-agent");

  // Set required env vars
  process.env.GITLAB_TOKEN = "fake-token";

  // Mock each bead's response
  mockRunBead
    .mockResolvedValueOnce(makeBeadResult('```json\n{"repoDir":"/tmp/repo","handoffDir":"/tmp/handoff"}\n```'))  // clone
    .mockResolvedValueOnce(makeBeadResult('```json\n{"result":"IMPROVEMENT_FOUND","categoryUsed":"refactoring","selected":{"rank":1,"files":["src/Foo.scala"],"description":"simplify Foo","rationale":"DRY"}}\n```'))  // analyze
    .mockResolvedValueOnce(makeBeadResult('```json\n{"status":"IMPLEMENTED"}\n```'))  // implement
    .mockResolvedValueOnce(makeBeadResult('```json\n{"passed":true,"error_details":""}\n```'))  // verify
    .mockResolvedValueOnce(makeBeadResult('```json\n{"outcome":"MR_CREATED","mr_url":"https://gitlab.com/foo/bar/-/merge_requests/42"}\n```'))  // mr
    .mockResolvedValueOnce(makeBeadResult('```json\n{"logged":true}\n```'));  // log

  const registry = new BeadRegistry();
  registry.register("standard", (_bead, _manifest) => new StandardBeadPlugin());
  registry.register("git-clone", (_bead, _manifest) => new GitCloneBeadPlugin());

  const engine = new AgentEngine(registry, silentLogger());
  const result = await engine.run(agentDir, agentsRoot, "test-task-01", {
    repo_url: "git@gitlab.com:team/repo.git",
    category: "refactoring",
    category_guidance: "Broad scope — code duplication...",
    confluence_page_id: "12345",
  });

  expect(result.status).toBe("SUCCESS");
  // Access final bead output (log bead)
  expect(result.finalOutput).toMatchObject({ logged: true });
  // Access intermediate bead output (analyze) for outcome shape parity
  expect(result.beadOutputs?.['mr']).toMatchObject({ outcome: "MR_CREATED" });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| File-based handoff (`handoff-code-agent-{taskId}.json`) | JSON code block output in stdout, engine stores in `ctx.previousBeads` | Phase 9 | Beads no longer coordinate through the filesystem |
| Hardcoded pipeline in `runCodeAgentPipeline()` | Declarative manifest with typed bead sequence | Phase 9 | Pipeline is data, not code |
| `loadBeadPrompt()` with v1.0 template variables | `renderAgentTemplate()` with manifest variable system | Phase 9 | Consistent template variable scoping |
| Category fallback loop inside pipeline function | Caller implements fallback loop after inspecting `NO_IMPROVEMENT` outcome | Phase 9 | Clean separation of concerns |
| Best-effort Confluence log (errors swallowed) | Mandatory log bead — failure is a pipeline failure | Phase 9 | Explicit failure surface |

---

## Open Questions

1. **Does `GitCloneBeadPlugin` correctly populate `ctx.workDir` for subsequent beads?**
   - What we know: `TempDirManager.create()` pre-creates `{tmp}/repo/` and passes it as initial `ctx.workDir`. `GitCloneBeadPlugin` calls `cloneRepo(repoUrl, gitlabToken, repoDir)` with `ctx.workDir` as `repoDir`.
   - What's unclear: Does `cloneRepo()` with an explicit `repoDir` clone INTO that directory, making it the correct `workDir` for subsequent beads? Or does it create a subdirectory?
   - Recommendation: Read `git-harness.ts` carefully. If `cloneRepo(url, token, repoDir)` clones into `repoDir` directly, the engine `ctx.workDir` stays correct and no special handling is needed.

2. **How does verify retry provide `error_details` to the implement bead?**
   - What we know: The engine must inject `verify_error` / `retry_error` into template variables on retry.
   - What's unclear: The verify bead must succeed (valid output schema) even on `passed: false`. So the engine needs to detect `passed: false` semantically, not just schema failure. The retry config `retryFrom: implement` means the engine re-runs from implement.
   - Recommendation: Engine checks `beadOutput.passed === false` when the bead has `retry` config. On false, it injects `retry_error = bead.output.error_details` into template variables, resets the repo, and re-runs from `retryFrom` bead. This requires the engine to understand that `passed: false` is a retry trigger — this semantic must be declared somewhere (either as a manifest convention or hardcoded for boolean `passed` fields).

3. **Where does `beadOutputs` live in `AgentRunResult`?**
   - What we know: The caller (Phase 10 daemon) needs `beadOutputs['analyze'].result` to decide on category fallback.
   - What's unclear: Is this a breaking API change to `AgentRunResult`? Does Phase 10's requirements already anticipate it?
   - Recommendation: Add `beadOutputs?: Record<string, unknown>` as an optional field to `AgentRunResult` in Phase 9. Always populate it. Phase 10 can rely on it.

4. **Should `mcpConfig` in the manifest be a relative path or come from a template variable?**
   - What we know: The v1.0 config (`nightshift.yaml`) has `log_mcp_config: ./mcp-atlassian-config.json`. Users configure this path.
   - What's unclear: In the manifest model, should the mcpConfig path be hardcoded in the manifest, or should it be `{{mcp_config_path}}` resolved from schedule variables?
   - Recommendation: Make it a template variable `{{mcp_config_path}}` in the manifest's `mcpConfig` field. Users provide it in their nightshift.yaml agent variables. This keeps the agent directory self-contained (no absolute paths) while remaining user-configurable.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (already configured) |
| Config file | `vitest.config.ts` at project root |
| Quick run command | `npm test -- --reporter=dot` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MIGR-01 (dir structure) | `agents/code-agent/manifest.yaml` exists, loads without error | unit | `npm test -- --reporter=dot tests/unit/code-agent-manifest.test.ts` | ❌ Wave 0 |
| MIGR-01 (pipeline shape) | Engine runs code-agent pipeline, final output has `MR_CREATED` / `NO_IMPROVEMENT` shape | unit | `npm test -- --reporter=dot tests/unit/code-agent-manifest.test.ts` | ❌ Wave 0 |
| MIGR-01 (portability) | Agent dir can be loaded from a different `agentsRoot` without engine code changes | unit | same test file | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- --reporter=dot tests/unit/code-agent-manifest.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/code-agent-manifest.test.ts` — covers MIGR-01: loads manifest, runs mocked pipeline, checks outcome shape
- [ ] Engine retry extension tests (add to `tests/unit/engine.test.ts`) — covers bead-level retry
- [ ] MCP tools validation test (add to `tests/unit/manifest-schema.test.ts`) — covers `mcp__*` allowedTools

*(No new framework needed — existing vitest infrastructure covers all gaps)*

---

## Implementation Plan (Suggested Phase 9 Tasks)

Based on the research, Phase 9 naturally breaks into 3 plans:

**Plan 01: Engine Extensions** (prerequisite for everything else)
1. Add `mcp__*` wildcard support to `validateAllowedTools` in manifest-schema.ts
2. Add `mcpConfig?: string` field to `BeadSchema`, `ResolvedBead`, and `manifest-loader.ts` (resolve relative to agentDir)
3. Pass `mcpConfigPath` through `StandardBeadPlugin.execute()` → `runBead()`
4. Add injection mitigation preamble to `StandardBeadPlugin.execute()`
5. Add `retry?: { maxAttempts, retryFrom }` field to `BeadSchema` and `ResolvedBead`
6. Extend engine bead loop with retry state (re-run from `retryFrom` bead, inject `retry_error` variable, call git reset)
7. Add `beadOutputs?: Record<string, unknown>` to `AgentRunResult`
8. Tests for each extension

**Plan 02: Agent Directory Creation**
1. Create `agents/code-agent/` directory
2. Write `manifest.yaml` with full 5-bead pipeline
3. Adapt `analyze.md` prompt: remove `{{handoff_file}}`, add JSON code block output, remap variables
4. Adapt `implement.md` prompt: access analyze via `{{beads.analyze.output.*}}`, remap variables
5. Adapt `verify.md` prompt: output JSON code block (not file), remap variables
6. Adapt `mr.md` prompt: derive short_description from `{{beads.analyze.output.selected.description}}`
7. Adapt `log.md` prompt: use `{{beads.*}}` for run record data
8. Run `dryRun()` / startup validation against the agent directory to verify all template vars resolve

**Plan 03: Integration Test**
1. Write `tests/unit/code-agent-manifest.test.ts`
2. Load real `agents/code-agent/` directory through `AgentEngine` with mocked `runBead`
3. Verify SUCCESS + MR_CREATED shape
4. Verify NO_IMPROVEMENT shape (analyze bead returns NO_IMPROVEMENT)
5. Verify portability: move agent dir to a temp location, point `agentsRoot` there, engine still works

---

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection — `src/agent/engine.ts` (AgentEngine implementation)
- Direct codebase inspection — `src/agent/manifest-schema.ts` (KNOWN_CLAUDE_TOOLS, BeadSchema)
- Direct codebase inspection — `src/agent/manifest-loader.ts` (loadManifest, resolveBeadConfig)
- Direct codebase inspection — `src/agent/plugins/standard-bead-plugin.ts` (mcpConfig gap confirmed)
- Direct codebase inspection — `src/agent/code-agent-runner.ts` (v1.0 pipeline with retry/fallback)
- Direct codebase inspection — `src/agent/code-agent.ts` (log bead MCP tools, best-effort pattern)
- Direct codebase inspection — `src/agent/prompts/*.md` (all template variables enumerated)
- Direct codebase inspection — `src/core/config.ts` (agents_dir field confirmed, schedule variables)
- Direct codebase inspection — `src/agent/engine-types.ts` (AgentRunResult — no beadOutputs field)
- Direct codebase inspection — `src/agent/bead-runner.ts` (mcpConfigPath already supported in runBead)

### Secondary (MEDIUM confidence)

- `.planning/phases/09-code-agent-migration/09-CONTEXT.md` — user decisions (locked constraints)
- `.planning/STATE.md` — accumulated design decisions from Phases 5-8

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all existing
- Architecture patterns: HIGH — directly derived from reading engine.ts, code-agent-runner.ts, manifest-schema.ts
- Pitfalls: HIGH for verified gaps (mcpConfig missing in plugin, KNOWN_CLAUDE_TOOLS, no preamble, no retry in engine); MEDIUM for retry semantics (design choices remain for implementation)
- Engine extensions: HIGH — gaps confirmed by code reading; specific API designs are recommendations

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable codebase — no external dependencies to track)
