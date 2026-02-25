# Project Research Summary

**Project:** night-shift v2.0 — Pluggable Agent Template System
**Domain:** Autonomous nightly automation daemon with composable bead pipeline and generic agent engine
**Researched:** 2026-02-25
**Confidence:** HIGH

## Executive Summary

Night-shift v2.0 transforms a hardcoded 4-bead code-agent pipeline into a directory-based agent template system, where each agent is a self-contained directory containing a `manifest.yaml` and prompt files. This is the universal pattern across the ecosystem (Google ADK, Semantic Kernel, Claude Skills): agent behavior is declared in data (YAML + markdown), not compiled TypeScript. The recommended approach is to implement a generic `AgentEngine` that reads any agent directory and drives its pipeline according to the manifest, replacing the hardcoded `runCodeAgentPipeline()` function. The existing stack (Node.js 22, TypeScript strict, Zod 4.3.x, yaml, croner) covers all v2.0 requirements without any new npm dependencies.

The most important design decision is that **the manifest is the keystone**: every other v2.0 feature either reads from it or is validated by it. The schema must be locked before the engine is written. The `AgentEngine` must be generic — free of any code-agent-specific logic. Category rotation, env var allowlists, per-bead model selection, and retry policies all move into the manifest, not into the engine. The code-agent migration from hardcoded to directory-based serves as the integration test that validates the architecture end-to-end.

The critical risks are: (1) the `isCodeAgent` boolean flag surviving into the new dispatch path, creating a two-code-paths anti-pattern that entrenches with every new agent; (2) bead handoff contracts being unenforced at runtime, causing silent wrong outputs rather than actionable errors; and (3) the existing `nightshift.yaml` `code_agent:` block breaking for current users if the config schema migration does not use the expand-and-contract pattern. All three risks are preventable by applying the right fixes in the right phase — before the generic engine is wired, not after.

---

## Key Findings

### Recommended Stack

All v2.0 capability is achieved by composing existing dependencies in new patterns. No new npm packages are required. The `yaml` package already in the project parses `manifest.yaml` files. Zod 4.3.x discriminated unions validate bead handoff schemas. Node.js 22 `fs.promises.readdir` with `{ withFileTypes: true }` discovers agent template directories without recursive glob. Adding `fast-glob`, `AJV`, `fs.promises.glob` (still experimental), or any dynamic-import mechanism would add complexity with no benefit.

**Core technologies:**
- `Node.js 22 fs.promises.readdir` — agent template directory discovery — stable built-in, no dependency needed
- `Zod 4.3.x` — manifest schema validation and typed bead I/O contracts — extends existing usage; discriminated unions are a v4 feature
- `yaml` (2.8.x) — `manifest.yaml` parsing — already in the project for `nightshift.yaml`
- TypeScript strict / ESM — all new engine files follow existing project conventions
- `croner` (10.x) — unchanged; schedules agent instances from the new `agents:` array
- `vitest` (3.x) — unchanged; covers new engine unit tests and manifest validation tests

**What NOT to add:** `fast-glob` (CVE-2025-64756 in the glob ecosystem, unnecessary for flat directory scan), `fs.promises.glob` (still emits ExperimentalWarning in Node 22), `AJV` (4ms startup cost, no TypeScript type inference, no benefit over existing Zod), dynamic `import()` for agent modules (agents are data and prompts, not compiled JS), dependency injection frameworks (plugins are YAML manifests, not TypeScript classes).

See [STACK.md](.planning/research/STACK.md) for full rationale.

### Expected Features

The pluggable architecture is only complete when all table-stakes features are present. Anything less means the engine still has hardcoded assumptions.

**Must have for v2.0 (table stakes):**
- `manifest.yaml` schema that declares the full bead pipeline (bead name, type, prompt, model, tools, env, output schema, timeout) — the contract between agent directory and engine
- Generic `AgentEngine` that loads any agent directory and drives its pipeline from the manifest with no agent-specific code in the engine
- Code-agent migrated from hardcoded `code-agent-runner.ts` to an `agents/code-agent/` directory — proves the architecture works without loss of functionality
- `nightshift.yaml` `agents:` list replacing `code_agent:` block — each entry references an agent by name with its schedule and static variables
- Backward compatibility shim: `code_agent:` block accepted with deprecation warning during transition
- Typed bead handoff validation: engine validates bead output against manifest-declared Zod schema before passing to next bead
- Per-bead model, allowed tools, env vars, and timeout declared in manifest — replaces hardcoded constants in `code-agent-runner.ts`
- Prompt template variable injection with engine-injected built-in vars taking precedence over user-defined vars

**Should have after core validation (v2.x):**
- `nightshift agent init <name>` scaffold command — creates a starter agent directory with manifest and placeholder prompts
- `nightshift agents list` CLI command — shows configured agents with bead count and last run outcome
- Manifest-configurable fallback category order — moves `FALLBACK_ORDER` constant from TypeScript to YAML
- Manifest validation at daemon startup (not just dispatch time) — fail before 2am, not at 2am
- `nightshift agent validate <path>` CLI command — validates an agent directory without starting the daemon

**Defer to v3+:**
- Cross-agent bead reuse — shared bead definitions referenced across multiple agent directories; requires path resolution and variable contract compatibility
- Agent registry / discovery — community agent index; premature until 10+ real agents exist
- Bead output caching — cache analyze bead output across runs; adds state management complexity
- Parallel bead execution — current sequential pipeline is correct by design; DAG executor is overkill

See [FEATURES.md](.planning/research/FEATURES.md) for the full prioritization matrix and anti-features list.

### Architecture Approach

The architecture is a clean plugin system with a manifest-declared pipeline. The existing poll loop, `AgentRunner` for generic recurring tasks, `BeadsClient`, and `Orchestrator.tick()` are all preserved unchanged. Only the dispatch path for agent-templated tasks changes: `AgentPool.dispatch()` routes tasks with an `agentName` field to the new `AgentEngine` instead of the hardcoded `runCodeAgentTask()` branch. The `isCodeAgent: boolean` flag on `NightShiftTask` is fully retired in favor of `agentName?: string`.

**Major components:**
1. `AgentEngine` (`src/agent/engine/index.ts`) — loads manifest, iterates bead pipeline in sequence, validates handoffs against declared schemas, aggregates cost and duration; the core new component
2. `AgentTemplateLoader` (`src/agent/engine/loader.ts`) — reads and Zod-validates `manifest.yaml` with strict mode; path containment via `fs.realpath()` prevents symlink traversal
3. `BeadRegistry` (`src/agent/engine/registry.ts`) — maps bead type strings from manifests to plugin factory functions; `"standard"` (claude -p) and `"git-clone"` (harness-side) are the two built-in types
4. `BeadPlugin<TInput, TOutput>` interface (`src/agent/engine/types.ts`) — typed plugin contract; shared mutable `PipelineContext` carries state between beads
5. `agents/code-agent/` directory — migrated code-agent with `manifest.yaml` plus 5 prompt files; validates that no functionality is lost in migration
6. Modified `AgentPool`, `Scheduler`, `Orchestrator` — minimal changes to wire the new dispatch path; existing generic `AgentRunner` path is preserved unchanged

**Build order is strict (8 phases):** Types and config schema, then plugin interfaces and registry, then template loader, then bead plugins, then `AgentEngine`, then code-agent migration, then daemon wiring, then config migration cleanup. Do not attempt to run against a real repo before Phase 6 unit tests pass.

See [ARCHITECTURE.md](.planning/research/ARCHITECTURE.md) for full component map, data flow diagrams, and anti-patterns to avoid.

### Critical Pitfalls

Research identified 8 pitfalls; the five most likely to cause project failure:

1. **`isCodeAgent` boolean survives the migration** — retire the flag entirely in Phase 1 before any new agent type is added; replace with `agentName?: string` on `NightShiftTask`; verify with `grep -r isCodeAgent src/` returning zero results after Phase 1.

2. **Bead I/O contracts unenforced at runtime** — define Zod handoff schemas in the manifest and validate immediately after each bead returns; report `BEAD_CONTRACT_VIOLATION` instead of silent `NO_IMPROVEMENT`; schemas must be defined in Phase 2 before any user-authored bead can exist.

3. **Config schema migration breaks existing `nightshift.yaml`** — use expand-and-contract: accept both `code_agent:` and `agents:` simultaneously in the Zod schema during the transition; auto-derive the `agents:` equivalent from `code_agent:` with a deprecation warning; never remove the old key in the same commit that adds the replacement.

4. **Path traversal via symlinked agent directory** — after `path.resolve()`, call `fs.realpath()` then verify the resolved path starts with the config root (`startsWith(safeRoot + path.sep)`); reject any agent directory that escapes; add a symlink traversal unit test; implement in Phase 2 when the file loader is first written.

5. **Template variable shadowing: user vars overriding engine built-ins** — invert the merge order so built-ins win (`{ ...userVars, ...builtInVars }`); validate that user variable names do not collide with the reserved set; implement in Phase 2 or Phase 5 before the first user-authored template is tested.

Additional pitfalls: concurrent handoff file collision when `maxConcurrent > 1` (add task ID suffix to all handoff filenames), and manifest validation deferred to dispatch time rather than daemon startup (validate all referenced manifests eagerly at startup).

See [PITFALLS.md](.planning/research/PITFALLS.md) for full pitfall descriptions, warning signs, recovery strategies, and phase-to-pitfall mapping.

---

## Implications for Roadmap

The architecture research defines a strict 8-phase build order with concrete prerequisites at each phase boundary. The suggested roadmap phases map directly onto this build order, grouped by deliverable scope.

### Phase 1: Type System and Dispatch Foundation
**Rationale:** `isCodeAgent` must be retired before any new agent type is added or the anti-pattern is locked in permanently. Config schema extension is non-breaking at this phase (types only, no behavior change). Concurrent handoff safety must be designed in from the start.
**Delivers:** `NightShiftTask.agentName` replacing `isCodeAgent`, `AgentConfig` interface, `agents:` array in config schema, `RecurringTaskConfig.agent` field, handoff file naming with task ID suffix.
**Addresses:** Table stakes — `nightshift.yaml agents:` list structure; mandatory pitfall prevention — `isCodeAgent` retirement and concurrent handoff collision fix.
**Avoids:** Pitfall 1 (`isCodeAgent` persists), Pitfall 7 (concurrent handoff file collision).

### Phase 2: Bead Plugin Interfaces and Security Boundaries
**Rationale:** The manifest schema, plugin interface, bead registry, and all security contracts (path containment, env allowlist, variable merge order) must be defined together before any plugin code is written. These are interdependent — the engine cannot be written without the plugin interface, and safe plugin loading cannot be written without the path containment logic.
**Delivers:** `BeadPlugin<TInput, TOutput>` interface, `PipelineContext`, `BeadRegistry`, `AgentTemplateLoader` with Zod manifest schema and `fs.realpath()` path containment, manifest-declared env allowlist replacing `buildBeadEnv` bead-name union.
**Addresses:** Typed bead handoff schema and validation; per-bead model, tools, env, and timeout in manifest; path traversal prevention; template variable shadowing fix; `buildBeadEnv` decoupled from bead names.
**Avoids:** Pitfall 2 (I/O contracts unenforced), Pitfall 4 (path traversal), Pitfall 5 (`buildBeadEnv` coupled to hardcoded bead names), Pitfall 6 (template variable shadowing).

### Phase 3: Config Schema Migration and Startup Validation
**Rationale:** The config migration must happen before the engine is wired into the daemon so the daemon can accept the new `agents:` format. The backward compatibility shim for `code_agent:` must be in the same commit as the schema change — never as a follow-up.
**Delivers:** Zod `ConfigSchema` accepting both `code_agent:` (deprecated with warning) and `agents:` simultaneously; `nightshift config validate` extended to validate all referenced agent manifests at startup; daemon start fails on broken manifest references.
**Addresses:** `nightshift.yaml` migration compatibility; manifest validation at load time rather than dispatch time.
**Avoids:** Pitfall 3 (config schema migration breaks existing configs), Pitfall 8 (manifest validation deferred to dispatch).

### Phase 4: AgentEngine and Bead Plugin Implementations
**Rationale:** This is the core implementation phase. All prerequisites (types, interfaces, loader, config schema) are ready. The engine can be written and unit-tested with mock plugins before the code-agent migration.
**Delivers:** `AgentEngine` class with linear pipeline execution, handoff validation, cost and duration accumulation, cleanup via try/finally; `StandardBeadPlugin` wrapping existing `runBead()`; `GitCloneBeadPlugin` wrapping existing `cloneRepo()`.
**Addresses:** Generic engine that loads and executes any agent directory.
**Uses:** Zod 4.3.x discriminated unions for bead output schemas; existing `bead-runner.ts` and `git-harness.ts` unchanged (plugins wrap them with no interface change).
**Avoids:** Anti-pattern of the generic engine growing code-agent-specific logic.

### Phase 5: Code-Agent Migration to Directory Template
**Rationale:** Migration is the integration test that proves the engine works end-to-end without loss of functionality. Do not ship the engine without migrating the code-agent — migration validates no information is lost when going from hardcoded to manifest-driven.
**Delivers:** `agents/code-agent/manifest.yaml` with the full 6-bead pipeline declared; all 5 prompt files migrated from config-path locations; category schedule declared in manifest; output schemas for analyze and verify beads; diff of code-agent output via new engine vs old `runCodeAgentPipeline()` confirms parity.
**Addresses:** Code-agent migrated from hardcoded to directory-based; agent shareable as copyable directory.
**Avoids:** Anti-pattern of prompt content baked into the engine.

### Phase 6: Daemon Wiring and Legacy Cleanup
**Rationale:** Wire the new dispatch path only after Phase 5 unit tests pass and the code-agent manifest produces equivalent output. Remove old files last, not first.
**Delivers:** `AgentPool.dispatch()` routes `agentName` tasks to `AgentEngine`; `Scheduler` passes `agentName` from config; `Orchestrator` constructs `AgentEngine`; `code-agent.ts` and `code-agent-runner.ts` removed; all existing integration tests still pass on the new dispatch path.
**Addresses:** Full wiring of the generic engine into the daemon with backward-compatible dispatch.
**Avoids:** Pitfall 1 final verification — `grep -r isCodeAgent src/` returns zero results.

### Phase 7: Developer Experience and Observability
**Rationale:** After the core architecture is validated with a real run of the migrated code-agent, add the tooling that makes agent authoring discoverable and debuggable. These features have high user value and low implementation cost but zero functional dependency on the core runtime.
**Delivers:** `nightshift agent init <name>` scaffold command; `nightshift agents list` CLI command; `nightshift agent validate <path>` CLI command; manifest-configurable fallback category order in code-agent manifest.
**Addresses:** v2.x "should have" features from FEATURES.md; users discovering manifest errors at 2am rather than at development time.

### Phase Ordering Rationale

- **Retire the flag before adding any new agent type** (Phase 1 first): Once a second agent type is added alongside `isCodeAgent`, every subsequent change must touch two code paths. This becomes exponentially more expensive to fix.
- **Security contracts before functionality** (Phase 2 before Phase 4): Path containment, env allowlist, and variable merge order are not security hardening passes applied after the fact — they are part of the initial loader and plugin design. Retrofitting them after user-authored templates exist is substantially harder and riskier.
- **Config migration in the same commit as schema change** (Phase 3 constraint): The backward compatibility shim for `code_agent:` is not a follow-up item. It ships in the same diff that changes the Zod schema. This is a hard constraint from Pitfall 3.
- **Migration before wiring** (Phase 5 before Phase 6): The engine must be integration-tested against a real code-agent manifest before being wired into the daemon's live dispatch path. Migration proves no functionality is lost.
- **DX features last** (Phase 7): Scaffold, list, and validate commands have high user value but depend on nothing else and can safely be deferred until the architecture is stable.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 2 (Bead plugin interface generics):** The `BeadPlugin<TInput, TOutput>` interface with shared mutable `PipelineContext` involves non-trivial TypeScript generics. The risk of over-engineering the type system is real. Before finalizing the interface, read the two known plugin implementations (`StandardBeadPlugin` and `GitCloneBeadPlugin`) and design the minimal interface that satisfies both without requiring any lookahead.
- **Phase 5 (Category rotation in manifest):** Moving `FALLBACK_ORDER` and `category_schedule` from `scheduler.ts` into the code-agent manifest requires deciding whether category rotation is a manifest-level variable injection or an engine-level scheduling mechanism. This design choice is not fully resolved in the architecture research. Read the current `resolveCategory()` implementation in `scheduler.ts` before designing the manifest representation.

Phases with standard patterns (skip research-phase during planning):

- **Phase 1:** Config schema extension with Zod follows the exact same additive pattern validated in v1.0. Task type changes are mechanical TypeScript refactoring. No uncertainty.
- **Phase 3:** The expand-and-contract config migration pattern is documented with precise implementation steps in PITFALLS.md. No design decisions needed.
- **Phase 4:** `StandardBeadPlugin` and `GitCloneBeadPlugin` are thin adapters over existing `runBead()` and `cloneRepo()` — no novel design decisions, just wrapping in the interface.
- **Phase 6:** Dispatch wiring is mechanical substitution of `isCodeAgent` branch with `agentName` lookup. Follows the data flow diagram in ARCHITECTURE.md exactly.
- **Phase 7:** CLI scaffold and list commands follow existing Commander.js patterns already in the codebase.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All v2.0 capabilities achieved with existing deps; no new packages; verified against official Node.js, Zod, and yaml docs; `fs.promises.glob` experimental status confirmed via official Node.js issue tracker |
| Features | HIGH (table stakes), MEDIUM (differentiators) | Table stakes derived from direct codebase analysis plus ecosystem comparison (ADK, Semantic Kernel, Claude Skills); differentiator priority order is judgment-based with reasonable confidence |
| Architecture | HIGH | Based on direct read of every relevant v1.0 source file; build order grounded in actual coupling points in the live codebase, not abstraction; integration point analysis validated against `.planning/codebase/ARCHITECTURE.md` |
| Pitfalls | HIGH | Grounded in codebase analysis plus CVE references (CVE-2025-53109/53110 for symlink traversal), confirmed Zod v4 breaking change docs (GitHub issue #4883), Cloudflare Pipelines parallel (typed bindings schema mismatches), and peer-reviewed template injection research |

**Overall confidence:** HIGH

### Gaps to Address

- **Category rotation design:** The architecture research states that `category_schedule` should move into the code-agent manifest but does not fully specify whether this is a manifest-level variable injection or an engine-level scheduling mechanism. Resolve during Phase 5 planning by reading `resolveCategory()` in `scheduler.ts` and determining the minimal manifest representation that preserves current behavior.
- **`AgentRunResult` alignment with `AgentExecutionResult`:** The architecture creates a new `AgentRunResult` type but the engine must emit the same shape that `writeReport()` expects (`AgentExecutionResult` in `inbox/reporter.ts`). Verify field alignment at the start of Phase 4 by reading `inbox/reporter.ts` before designing the `AgentRunResult` interface.
- **MCP config injection for log bead:** The `log` bead uses MCP Atlassian tools with `mcp_config` sourced from a manifest variable. Whether `bead-runner.ts` already supports MCP config injection for `claude -p` invocations needs verification. If not, Phase 4 or Phase 5 must add it.

---

## Sources

### Primary (HIGH confidence)
- Night-shift v1.0 codebase (direct analysis): `src/daemon/agent-pool.ts`, `src/daemon/orchestrator.ts`, `src/daemon/scheduler.ts`, `src/agent/code-agent.ts`, `src/agent/code-agent-runner.ts`, `src/agent/bead-runner.ts`, `src/core/types.ts`, `src/core/config.ts`, `.planning/codebase/ARCHITECTURE.md`
- [Zod v4 Release Notes](https://zod.dev/v4) — discriminated union composition, optional field default breaking change (issue #4883)
- [Node.js fs API docs](https://nodejs.org/api/fs.html) — `readdir` with `withFileTypes`, stable since Node 10.10
- [Node.js fs.promises.glob experimental status](https://github.com/nodejs/node/issues/58343) — ExperimentalWarning confirmed in Node 24
- [CVE-2025-53109/53110: MCP Filesystem Server Symlink Escape](https://www.ikangai.com/the-complete-guide-to-sandboxing-autonomous-agents-tools-frameworks-and-safety-essentials/) — agent file system sandboxing patterns
- [Cloudflare Pipelines Typed Bindings (Feb 2026)](https://developers.cloudflare.com/changelog/post/2026-02-24-typed-bindings-setup-improvements-error-metrics/) — schema mismatches discovered as dropped events at runtime
- [OWASP Path Traversal Attack](https://owasp.org/www-community/attacks/Path_Traversal) — path containment implementation patterns
- [Semantic Kernel agent templates](https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/agent-templates) — manifest format validation approach
- [Google ADK plugin architecture](https://google.github.io/adk-docs/plugins/) — directory-based agent conventions

### Secondary (MEDIUM confidence)
- [agentsfolder/spec](https://github.com/agentsfolder/spec) — emerging open specification for shareable agent directory structure with `manifest.yaml`
- [AJV vs Zod comparison](https://betterstack.com/community/guides/scaling-nodejs/typebox-vs-zod/) — performance and TypeScript integration tradeoffs
- [Schema Evolution Without Breaking Consumers](https://datalakehousehub.com/blog/2026-02-de-best-practices-05-schema-evolution/) — expand-and-contract pattern for config schema migrations
- [Feature Flag Anti-Patterns (Harness.io)](https://www.harness.io/resources/feature-flagging-anti-patterns-avoiding-pitfalls-in-modern-software-delivery) — `isCodeAgent` boolean coupling classification
- [Automating Agent Hijacking via Structural Template Injection (arxiv.org, Feb 2026)](https://arxiv.org/html/2602.16958v1) — peer-reviewed study of template injection in agent pipelines
- [LangChain CVE-2025-68664: PromptTemplate RCE via Jinja2](https://cyata.ai/blog/langgrinch-langchain-core-cve-2025-68664/) — precedent for user-defined template format leading to arbitrary code execution
- [glob CVE-2025-64756](https://medium.com/@balazs.csaba.diy/whats-this-glob-npm-madness-suddenly-every-node-js-image-is-vulnerable-but-why-1ba1b0cbad97) — security vulnerability in glob package ecosystem

### Tertiary (LOW confidence)
- [Claude Agent Skills deep dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/) — `SKILL.md` format as analogy for manifest design; night-shift beads are autonomous subprocess invocations, not interactive skills — analogy is directional only

---

*Research completed: 2026-02-25*
*Ready for roadmap: yes*
