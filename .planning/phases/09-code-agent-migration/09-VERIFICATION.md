---
phase: 09-code-agent-migration
verified: 2026-02-27T19:10:00Z
status: passed
score: 16/16 must-haves verified
re_verification: false
---

# Phase 09: Code-Agent Migration Verification Report

**Phase Goal:** The code-agent exists as a self-contained `agents/code-agent/` directory — runnable by `AgentEngine` with no functionality lost compared to v1.0
**Verified:** 2026-02-27T19:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Plan 01)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A manifest with mcpConfig on a bead passes schema validation; raw mcpConfig stored on ResolvedBead (not resolved at load time) | VERIFIED | `BeadSchema` has `mcpConfig: z.string().optional()`; `resolveBeadConfig` stores `bead.mcpConfig` as-is; `ResolvedBead` has `mcpConfig?: string` with explicit doc comment "Not resolved at load time" |
| 2 | allowedTools containing `mcp__atlassian__getConfluencePage` passes; `FakeUnknownTool` is rejected | VERIFIED | `validateAllowedTools` filters `!knownSet.has(t) && !t.startsWith('mcp__')` — mcp__ prefix accepted, non-mcp unknown tools rejected |
| 3 | Manifest with retry config loads; retry.retryFrom referencing nonexistent preceding bead is rejected | VERIFIED | `RetrySchema` defined in schema; `ManifestSchema.beads.superRefine` validates `retryFrom` against `names.slice(0, i)` |
| 4 | runBead receives prompt starting with INJECTION_MITIGATION_PREAMBLE when StandardBeadPlugin executes | VERIFIED | `standard-bead-plugin.ts` line 25: `INJECTION_MITIGATION_PREAMBLE + "\n---\n\n" + renderAgentTemplate(...)` |
| 5 | runBead receives mcpConfigPath resolved to absolute path when bead declares mcpConfig, after template rendering | VERIFIED | Lines 38-45: `renderAgentTemplate(ctx.currentBead.mcpConfig, ctx.variables)` then `path.isAbsolute` check before `path.join(ctx.agentDir, ...)` |
| 6 | A 3-bead pipeline where verify returns passed:false re-runs implement and then verify again | VERIFIED | Engine while-loop: `if (bead.retry && parsed.passed === false)` increments `retryCount`, finds `retryFromIndex`, calls `resetWorkDir`, jumps `i = retryFromIndex; continue` |
| 7 | On retry, implement bead's template variables contain retry_error with verify's error_details | VERIFIED | `ctx.variables.retry_error = String(errorDetails)` injected before `i = retryFromIndex` |
| 8 | `git reset --hard HEAD` is executed in workDir before each retry | VERIFIED | `resetWorkDir` method uses `spawnWithTimeout("git", ["reset", "--hard", "HEAD"], { cwd: workDir })`; called at line 242 |
| 9 | AgentRunResult.beadOutputs contains all executed bead outputs keyed by name | VERIFIED | `beadOutputs: Record<string, unknown>` initialized at line 150, populated at line 187, returned in both success (line 352) and failure (line 323) paths |

### Observable Truths (Plan 02)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 10 | `agents/code-agent/manifest.yaml` loads successfully through `AgentEngine.dryRun()` | VERIFIED | Integration test "manifest loads and passes dryRun validation" passes (72/72 tests green) |
| 11 | Running code-agent through AgentEngine with mocked runBead produces MR_CREATED outcome shape | VERIFIED | Integration test "pipeline produces MR_CREATED outcome shape" — `result.status === "SUCCESS"`, `beadOutputs.mr.outcome === "MR_CREATED"` |
| 12 | Running with mocked analyze returning NO_IMPROVEMENT — beadOutputs contains the analyze result | VERIFIED | Integration test "pipeline with NO_IMPROVEMENT analyze output" — `beadOutputs.analyze.result === "NO_IMPROVEMENT"` |
| 13 | All prompt templates resolve without undefined variable errors with manifest variables and config overrides | VERIFIED | `dryRun` validates all 6 prompts; test passes with TEST_CONFIG overrides |
| 14 | The code-agent directory can be loaded from a different agentsRoot without engine code changes | VERIFIED | Portability test: copies `agents/code-agent/` to tmpDir, runs `dryRun` with new `agentsRoot` — passes |
| 15 | Prompts use `{{beads.*}}` template variables instead of `{{handoff_file}}` or `{{analysis_file}}` | VERIFIED | `grep -n '{{handoff_file}}\|{{analysis_file}}' agents/code-agent/prompts/*.md` → zero results; `{{beads.*}}` used in implement.md, mr.md, log.md |
| 16 | Prompts output JSON code blocks to stdout instead of writing to files | VERIFIED | All prompts contain "Output the following JSON code block" instructions with no file-write instructions |

**Score:** 16/16 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/agent/manifest-schema.ts` | mcpConfig, retry fields; mcp__ pattern validation | VERIFIED | RetrySchema, mcpConfig/retry on BeadSchema, mcp__ filter in validateAllowedTools, retryFrom validation in ManifestSchema |
| `src/agent/manifest-types.ts` | mcpConfig, retry fields on ResolvedBead | VERIFIED | `mcpConfig?: string` and `retry?: { maxAttempts: number; retryFrom: string }` with doc comments |
| `src/agent/manifest-loader.ts` | mcpConfig raw string passthrough and retry field resolution | VERIFIED | `mcpConfig: bead.mcpConfig` and `retry: bead.retry ? {...} : undefined` in resolveBeadConfig |
| `src/agent/plugins/standard-bead-plugin.ts` | Preamble injection and mcpConfigPath forwarding | VERIFIED | INJECTION_MITIGATION_PREAMBLE import and prepend; mcpConfig rendered through template engine then resolved; mcpConfigPath passed to runBead |
| `src/agent/engine-types.ts` | beadOutputs field on AgentRunResult | VERIFIED | `beadOutputs?: Record<string, unknown>` at line 43 |
| `src/agent/engine.ts` | Bead-level retry loop with retryFrom, retry_error injection, git reset | VERIFIED | While-loop with retry state, resetWorkDir method, beadOutputs populated both paths |
| `agents/code-agent/manifest.yaml` | Full 6-bead pipeline (clone, analyze, implement, verify, mr, log) | VERIFIED | 6 beads present: clone (git-clone), analyze (standard), implement (standard), verify (standard with retry:3/implement), mr (standard), log (standard with mcpConfig template var) |
| `agents/code-agent/prompts/analyze.md` | Adapted for JSON code block output | VERIFIED | Uses `{{run_date}}`, `{{category}}`, `{{category_guidance}}`, `{{allowed_commands}}`; outputs JSON code block |
| `agents/code-agent/prompts/implement.md` | Using `{{beads.analyze.output.*}}` for analysis data | VERIFIED | `{{beads.analyze.output.selected.description}}`, `{{beads.analyze.output.selected.files}}`, `{{beads.analyze.output.selected.rationale}}`; `{{retry_error}}` present |
| `agents/code-agent/prompts/verify.md` | JSON code block output, non-zero logic on failure | VERIFIED | `{{allowed_commands}}`, JSON block with `passed`/`error_details`; no file writes |
| `agents/code-agent/prompts/mr.md` | Using `{{beads.analyze.output.*}}` for description | VERIFIED | Multiple `{{beads.analyze.output.*}}` references; JSON block with `outcome`/`mr_url` |
| `agents/code-agent/prompts/log.md` | Using `{{beads.*}}` for run record data | VERIFIED | `{{beads.analyze.output.categoryUsed}}`, `{{beads.mr.output.mr_url}}`, `{{beads.analyze.output.selected.description}}`; JSON block with `logged` |
| `tests/unit/code-agent-manifest.test.ts` | Integration test verifying manifest loads and pipeline runs | VERIFIED | 5 tests: dryRun, MR_CREATED pipeline, NO_IMPROVEMENT, portability, retry re-run; all pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `manifest-schema.ts` | `manifest-loader.ts` | BeadSchema parsed fields feed resolveBeadConfig | VERIFIED | `mcpConfig: bead.mcpConfig` and `retry: bead.retry ? {...}` confirmed in resolveBeadConfig |
| `manifest-loader.ts` | `manifest-types.ts` | resolveBeadConfig produces ResolvedBead with raw mcpConfig and retry | VERIFIED | Return type matches ResolvedBead interface with both optional fields |
| `standard-bead-plugin.ts` | `bead-runner.ts` | Plugin renders mcpConfig through template engine, resolves to absolute path, passes as mcpConfigPath to runBead | VERIFIED | renderAgentTemplate call on mcpConfig value, path.isAbsolute check, mcpConfigPath in runBead params |
| `engine.ts` | `engine-types.ts` | Engine populates beadOutputs on AgentRunResult | VERIFIED | `beadOutputs: Record<string, unknown>` initialized, populated per-bead, returned in both success and failure |
| `agents/code-agent/manifest.yaml` | `src/agent/engine.ts` | loadManifest → AgentEngine.run() | VERIFIED | Integration test confirms dryRun and run() both work with real agent directory |
| `agents/code-agent/prompts/*.md` | `src/agent/template.ts` | renderAgentTemplate resolves `{{beads.*}}` patterns | VERIFIED | `{{beads.analyze.output.*}}` in implement.md, mr.md, log.md; engine injects previousBeads into variables |
| `tests/unit/code-agent-manifest.test.ts` | `agents/code-agent/` | Real agent dir loaded by mocked engine | VERIFIED | `agentsRoot = path.resolve("agents/code-agent")` — hardcoded to real directory |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MIGR-01 | 09-01, 09-02 | Code-agent exists as `agents/code-agent/` with manifest.yaml and prompt files — no functionality lost from v1.0 | SATISFIED | Full 6-bead pipeline in agents/code-agent/; integration test proves pipeline runs with MR_CREATED outcome shape; dryRun validates all prompts; retry, mcpConfig, mcp__ tools all wired |

REQUIREMENTS.md maps `MIGR-01` exclusively to Phase 9 — no orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/agent/engine.ts` | 381-389 | `placeholderBuiltIns` variable name | Info | False positive — this is intentional placeholder text for dryRun validation, not an implementation stub |

No blockers or warnings found. The `placeholder` string in engine.ts is used for dryRun's synthetic built-in variable values (e.g., `"<task_id>"`) — correct behavior, not a stub.

### Pre-Existing Test Failures (Not Phase 09 Regressions)

The full test suite shows 68 failures, but all are pre-existing and outside phase 09 scope:

- `tests/unit/agent-pool.test.ts` — 4 failures: tests for old `code-agent` dispatch through `runCodeAgent` (v1.0 path, not yet migrated — Phase 10 work)
- `tests/unit/code-agent-runner.test.ts` — 20 failures: tests for legacy `runCodeAgentPipeline` (v1.0 runner, Phase 10 removes this)
- `tests/unit/scheduler.test.ts` — 15 failures: pre-existing since before phase 08
- `tests/integration/*.test.ts` — failures: pre-existing integration tests unrelated to agent engine

Confirmed pre-existing: these failures reproduce against the phase 08 commit (`8f3febe`) with no phase 09 changes present.

Phase 09 target tests (72 total): all pass.
- `tests/unit/manifest-schema.test.ts` — 20 passed
- `tests/unit/standard-bead-plugin.test.ts` — 13 passed
- `tests/unit/engine.test.ts` — 33 passed
- `tests/unit/code-agent-manifest.test.ts` — 5 passed (integration)

TypeScript compilation: `npx tsc --noEmit` exits 0 — no type errors.

### Human Verification Required

None required. All must-haves are verifiable programmatically:
- Schema validation: verified via test suite
- Prompt content and variable usage: verified by direct file inspection
- Retry loop logic: verified by direct source inspection and passing engine tests
- Integration: verified by code-agent-manifest.test.ts integration tests

## Gaps Summary

No gaps. All 16 truths verified across both plans. The phase goal is fully achieved:

1. `agents/code-agent/` exists as a self-contained directory loadable by `AgentEngine`
2. The manifest declares a complete 6-bead pipeline (clone → analyze → implement → verify → mr → log)
3. All prompt files use the new manifest template variable system (`{{beads.*}}`, `{{run_date}}`, `{{retry_error}}`)
4. No `{{handoff_file}}` or `{{analysis_file}}` references — v1.0 file-based handoff eliminated
5. Engine extensions (retry, mcpConfig, preamble, beadOutputs) are fully generic — zero code-agent-specific logic in engine.ts
6. MIGR-01 satisfied: code-agent is runnable by AgentEngine with no v1.0 functionality lost

---

_Verified: 2026-02-27T19:10:00Z_
_Verifier: Claude (gsd-verifier)_
