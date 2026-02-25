# Feature Research

**Domain:** Pluggable agent template system with composable bead pipeline and generic engine
**Researched:** 2026-02-25
**Confidence:** HIGH (table stakes derived from existing codebase + ecosystem patterns), MEDIUM (differentiators), LOW (agent sharing UX without prior art in this exact domain)

---

## Context

This is a **subsequent milestone** (v2.0) on top of shipped v1.0. The existing system has:
- A hardcoded 4-bead pipeline (analyze/implement/verify/mr) in `src/agent/`
- A single `codeAgent` config block in `nightshift.yaml` wired to `runCodeAgent()`
- Beads = task-tracking units in the external `bd` CLI (NOT pipeline stages), plus "bead" is reused in v1.0 as the term for each pipeline stage invocation of `claude -p`
- Zero plugin architecture — pipeline stages, prompts, and runner are all tightly coupled

The v2.0 goal: transform the hardcoded code-agent pipeline into a directory-based agent template system where prompts, bead definitions (pipeline stages), and agent metadata live together in a copyable directory, and `nightshift.yaml` lists multiple such agents by path.

**Important terminology note:** The word "bead" in this codebase carries two meanings:
1. External beads CLI (`bd` tool) — task tracking and queue management. This is unchanged.
2. v1.0 "bead" = a single `claude -p` subprocess invocation in the pipeline. This is the "composable bead" the v2.0 feature extends.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that the v2.0 pluggable architecture must have to be considered complete. Missing any of these means the architecture is still hardcoded.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Agent defined as a directory | Any plugin/template system is directory-based — this is the universal pattern (ADK, Claude Skills, .agents spec, Semantic Kernel all use directory-based templates). Without this, agents cannot be shared or versioned independently. | MEDIUM | Directory = `manifest.yaml` + prompt files. Similar to Claude's `.claude/skills/` structure. |
| `manifest.yaml` declares bead pipeline | The manifest is the contract between the agent directory and the engine. It lists which beads exist, in what order, with what prompt file, model, tools, and output schema. Without this, the engine cannot load an agent without hardcoded knowledge of it. | MEDIUM | Mirrors Semantic Kernel YAML template format and Google ADK agent config. |
| Generic engine that loads and executes any agent directory | Without a generic engine, you still have a hardcoded runner. The engine must accept a path to an agent directory and drive the pipeline based on the manifest — not based on code knowledge of what analyze/implement/verify/mr means. | HIGH | This is the core architectural shift. The existing `code-agent-runner.ts` becomes a manifest-driven engine. |
| Code-agent migrated from hardcoded to directory-based | Migration is proof that the architecture works. If code-agent cannot be expressed as a directory template without loss of functionality, the architecture has gaps. | HIGH | All hardcoded CATEGORY_GUIDANCE, FALLBACK_ORDER, prompt paths, bead names must move to the directory or manifest. |
| `nightshift.yaml` updated to reference agent directories | The config file is the user's control surface. Multi-agent scheduling means listing multiple agent directories with their schedules. Without config schema change, users cannot add new agents. | MEDIUM | `codeAgent:` block replaced with `agents:` list. Each agent entry has `path:`, `schedule:`, and agent-specific vars. |
| Typed bead input/output via handoff files | Beads already communicate via JSON handoff files (analysis.json, verify.json). This must be formalized: the manifest declares the output schema of each bead, so the engine can validate handoffs and the next bead knows what it receives. Without typing, every bead has implicit contracts that break silently when the agent is refactored. | MEDIUM | JSON Schema or Zod inline schema in manifest. Runtime validation on handoff file content. |
| Prompt template variable injection from manifest | Prompt files already use `{{variable}}` substitution (via `src/utils/template.ts`). The manifest must declare which variables a bead expects, and the engine must supply built-in vars plus agent-specific vars from config. | LOW | Already exists in `buildBuiltInVars()`. Formalize what is built-in vs manifest-declared vs user-provided. |
| Agent shareable as a copyable directory | This is the distribution UX. A user should be able to `cp -r agents/code-agent ~/my-agents/my-custom-agent` and point nightshift at it. The agent must be self-contained — no references to absolute paths in the install, no reliance on code constants. | LOW | No npm publish needed. Just directory copy + path reference in config. This is the minimum viable sharing story. |

---

### Differentiators (Competitive Advantage)

Features that make this system meaningfully better than "just restructure the code."

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Bead-level retry and fallback declared in manifest | Category fallback (try tests → refactoring → docs) is currently hardcoded in `code-agent-runner.ts`. If this is manifest-configurable, any agent can define its own fallback chain without writing TypeScript. | HIGH | This is complex because fallback is stateful — the engine must track which categories were tried and reset repo state between attempts. Expressing this declaratively in YAML is not trivial. |
| Per-bead model selection in manifest | v1.0 hardcodes opus-4-6 for analyze/implement and sonnet-4-6 for verify/mr/log. Making this manifest-configurable lets users trade cost vs quality per bead. | LOW | Simple manifest field: `model: claude-sonnet-4-6`. Engine reads it. Big user value, tiny implementation cost. |
| Per-bead allowed tools declared in manifest | Different beads need different tool sets (analyze: Bash+Read; mr: Bash+Read+Write+glab; log: MCP Atlassian tools). Manifest-declared tools mean the engine enforces isolation without hardcoding it in TypeScript. | LOW | Just moves `allowedTools` arrays from constants in code to manifest YAML. High security value. |
| Per-bead timeout declared in manifest | Some beads (analyze, implement) need longer timeouts than others (verify, log). Currently all beads share the task-level timeout. Manifest-level per-bead timeout gives agents fine-grained control. | LOW | Manifest field: `timeoutMs: 120000`. Engine applies it per bead. |
| Env var allowlist declared in manifest | `buildBeadEnv()` currently has a hardcoded allowlist + special-case for GITLAB_TOKEN on mr bead. Manifest can declare `env` per bead, keeping the security invariant without hardcoded bead-name conditionals. | MEDIUM | Security-critical: must preserve the invariant that tokens only reach the bead that needs them. Engine must validate against manifest allowlist, not bead name. |
| Category schedule inherited from agent manifest | The `categorySchedule` config is currently inside the `codeAgent` block. For multi-agent, each agent in `nightshift.yaml` may want its own schedule. Manifest can declare category-related defaults while the config overrides per-deployment. | LOW | Separation: manifest declares supported categories, config declares the rotation schedule. |
| Plugin-style bead composition (reuse beads across agents) | An agent can reference a bead type defined elsewhere (e.g., a shared `log-bead` that handles Confluence updates for any agent, not just code-agent). This prevents copy-pasting prompt files across agent directories. | HIGH | This is a v3 feature. The cost of getting shared-bead reference resolution right (path resolution, variable contract compatibility) is high. Start with self-contained agent directories, add cross-agent bead references later. Flag as DEFER. |
| `nightshift agents list` CLI command | Users with multiple agents configured need to see what agents are loaded, their bead counts, schedule, and last run outcome at a glance. | LOW | Reads `agents:` list from config, resolves manifests, formats a table. Low code cost, high discoverability value. |

---

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| npm-publish agent packages | "Make agents installable like npm packages." Looks like a clean distribution story. | Adds version management complexity, registry maintenance, and `node_modules` bloat. Most agents are personal tools or team-specific. Premature abstraction before the format is stable. | Directory copy + path reference in config. Let the format stabilize over 5+ real agents before standardizing on a registry. |
| Agent runtime isolation (Docker/VM) | "Each agent runs in its own sandbox for security." | Enormous operational complexity. The existing `buildBeadEnv()` allowlist + `GIT_CONFIG_NOSYSTEM=1` already provides meaningful isolation without containers. Containers add startup latency (10-60s) that undermines the nightly run budget. | `--allowedTools` restriction + env var allowlist declared in manifest. This is the right isolation boundary for a local tool. |
| GUI for building agent templates | "I don't want to write YAML." | A GUI generates YAML that users don't understand and can't debug. The user base for night-shift is engineers who are comfortable with YAML config. A GUI adds a frontend build surface for near-zero marginal users. | Good documentation with examples. A `nightshift agent init <name>` scaffold CLI command that writes a starter directory is sufficient. |
| Dynamic bead registration at runtime | "Load new bead types from npm without restarting." | Hot-loading arbitrary code at runtime is a security surface. Night-shift runs with the user's full credentials. Any bead loaded dynamically has those credentials. | Manifests declare known, static bead pipelines. New bead types require a night-shift version bump. |
| Agent-to-agent communication mid-pipeline | "Have the analyze agent ask the implement agent a question." | Cross-agent communication during a pipeline run requires message-passing infrastructure (queues, shared state) that massively exceeds the complexity budget of a personal tool. | Handoff files are sufficient: beads communicate via structured JSON files in the handoff directory. No real-time messaging needed. |
| LLM-driven bead ordering | "Let the model decide which beads to run and in what order." | This is the orchestration trap: using LLMs for what YAML is good at — sequencing, counting, routing. Non-deterministic ordering makes debugging impossible and breaks the manifest contract. | Fixed sequential bead order declared in the manifest, with optional per-bead skip conditions (e.g., "skip implement if analyze returns NO_IMPROVEMENT"). |
| Parallel bead execution | "Run verify and analyze simultaneously for speed." | The existing pipeline is sequential by design: each bead's output is the next bead's input. Parallel execution with handoff dependencies requires a DAG executor, which is overkill. | Keep sequential pipeline. If a future agent genuinely needs parallel stages, that's a separate feature request backed by evidence. |

---

## Feature Dependencies

```
[manifest.yaml format]
    └──required by──> [Generic engine]
                          └──required by──> [Code-agent migration]
                          └──required by──> [Multi-agent config in nightshift.yaml]

[Typed handoff schema in manifest]
    └──required by──> [Runtime handoff validation]
    └──required by──> [Next-bead input contract]

[Per-bead env allowlist in manifest]
    └──replaces──> [buildBeadEnv() hardcoded GITLAB_TOKEN logic]
    └──required by──> [Security invariant preserved in generic engine]

[Per-bead model in manifest]
    └──replaces──> [hardcoded "claude-opus-4-6" / "claude-sonnet-4-6" in code-agent-runner.ts]

[Per-bead allowed tools in manifest]
    └──replaces──> [hardcoded LOG_BEAD_ALLOWED_TOOLS, default ["Bash", "Read", "Write"]]

[Code-agent migrated to directory]
    └──enables──> [Agent shareable as copyable directory]
    └──validates──> [Generic engine works end-to-end]

[nightshift.yaml agents: list]
    └──requires──> [Generic engine]
    └──enables──> [Multiple agents with different schedules]
    └──enables──> [nightshift agents list CLI command]
```

### Dependency Notes

- **manifest.yaml is the keystone:** Every other v2.0 feature either reads from or is validated by the manifest. It must be designed first and the schema locked before the engine is written.
- **Generic engine requires manifest to be stable:** If the manifest schema changes during engine development, both must be updated together. Lock the schema in Phase 1, implement the engine in Phase 2.
- **Code-agent migration is the integration test for the engine:** Do not ship the engine without migrating code-agent. Migration validates that no information is lost when going from hardcoded to manifest-driven.
- **nightshift.yaml schema change is a breaking change:** The existing `codeAgent:` block must either be deprecated with a migration path, or the old schema accepted alongside the new `agents:` list. Migration strategy must be decided before Phase 1.
- **Per-bead env allowlist replaces a security-critical code path:** The current `buildBeadEnv()` bead-name conditional is tested by 4 unit tests. Any manifest-driven replacement must have equivalent test coverage.

---

## MVP Definition

### Launch With (v2.0)

Minimum to validate the pluggable architecture and migrate the existing code-agent.

- [ ] `manifest.yaml` schema — declares bead pipeline (ordered list of beads with name, prompt file, model, allowedTools, env vars, timeoutMs, output schema) — this is the format everything else depends on
- [ ] Generic engine (`src/agent/engine.ts`) — loads a manifest from a directory, drives beads in order, handles handoff files, accumulates cost/duration — replaces hardcoded `code-agent-runner.ts`
- [ ] Code-agent directory (`agents/code-agent/`) — manifest + prompt files + category guidance — migration of the existing hardcoded implementation
- [ ] Handoff file validation — engine validates bead output against manifest-declared schema before passing to next bead; invalid output is logged and treated as bead failure
- [ ] nightshift.yaml `agents:` list — replaces `codeAgent:` block; each entry has `path`, `schedule`, and agent-specific variables; Zod schema validates
- [ ] `nightshift.yaml` migration compatibility — old `codeAgent:` block accepted with a deprecation warning; users get a clear message pointing to the new format

### Add After Validation (v2.x)

After the first real run with the migrated code-agent confirms end-to-end operation.

- [ ] `nightshift agent init <name>` scaffold command — creates a starter agent directory with manifest.yaml and placeholder prompt files
- [ ] `nightshift agents list` CLI command — lists configured agents with bead count, schedule, and last run outcome
- [ ] Per-bead fallback categories in manifest — moves the `FALLBACK_ORDER` constant from TypeScript to manifest YAML; configurable per agent

### Future Consideration (v3+)

Defer until multiple real agents have been built and the format has stabilized.

- [ ] Cross-agent bead reuse — reference a shared bead definition from multiple agent directories; requires path resolution and variable contract compatibility
- [ ] Agent registry / discovery — a way to find and install community agent templates; only justified after 10+ community agents exist
- [ ] Bead output caching — cache analyze bead output across runs to avoid re-analysis when implementation failed; adds state management complexity

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| manifest.yaml schema design | HIGH | LOW | P1 |
| Generic engine | HIGH | HIGH | P1 |
| Code-agent migrated to directory | HIGH | MEDIUM | P1 |
| nightshift.yaml `agents:` list | HIGH | MEDIUM | P1 |
| nightshift.yaml migration compat | HIGH | LOW | P1 |
| Typed handoff schema + validation | MEDIUM | MEDIUM | P1 |
| Per-bead model in manifest | HIGH | LOW | P1 |
| Per-bead allowedTools in manifest | HIGH | LOW | P1 |
| Per-bead env allowlist in manifest | HIGH | MEDIUM | P1 |
| Per-bead timeout in manifest | MEDIUM | LOW | P2 |
| `nightshift agent init` scaffold | MEDIUM | LOW | P2 |
| `nightshift agents list` command | MEDIUM | LOW | P2 |
| Manifest-configurable fallback order | MEDIUM | MEDIUM | P2 |
| Cross-agent bead reuse | LOW | HIGH | P3 |
| Agent registry / discovery | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v2.0 milestone launch
- P2: Should have, add after core pipeline is validated
- P3: Nice to have, defer to v3+

---

## Ecosystem Analysis

No direct competitors exist for this exact combination (local daemon + directory-based agent templates + composable bead pipeline). Relevant analogies:

| Feature | Google ADK (plugins) | Semantic Kernel (templates) | Claude Skills | Our Approach |
|---------|---------------------|----------------------------|---------------|--------------|
| Agent definition format | Python class + YAML config | YAML with template vars | `SKILL.md` with YAML frontmatter | `manifest.yaml` + prompt files directory |
| Plugin/bead composition | Runner-registered callbacks applied globally | Kernel function chaining | Single-skill invocations | Sequential bead pipeline declared in manifest |
| Typed IO between stages | OpenTelemetry traces, Zod params | KernelArguments typed | Not specified | JSON handoff files with manifest-declared schema |
| Distribution | Python packages / Vertex AI | NuGet / pip | Copy `.claude/skills/` directory | Copy agent directory, reference in config |
| Model per stage | Not native (per-agent config) | Yes, per-function model override | Yes, frontmatter `model:` | Yes, per-bead `model:` in manifest |
| Tool restrictions per stage | ADK plugin hooks | No native per-function restriction | Yes, frontmatter `allowed-tools:` | Yes, per-bead `allowedTools:` in manifest |

**Key insight from ecosystem analysis:** Claude's own Skills system (directory + SKILL.md + YAML frontmatter) is the closest analogy and validates the directory-based approach. The critical difference: night-shift beads are autonomous subprocess invocations of `claude -p`, not interactive skill activations. The manifest must encode the subprocess configuration that `SKILL.md` frontmatter encodes for interactive sessions.

---

## Sources

- Existing night-shift v1.0 codebase: `src/agent/bead-runner.ts`, `src/agent/code-agent-runner.ts`, `src/agent/code-agent.ts`, `src/core/types.ts` — HIGH confidence (direct analysis)
- Claude Agent Skills spec: [Claude Agent Skills: A First Principles Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/) — MEDIUM confidence
- `.agents/` folder specification: [github.com/agentsfolder/spec](https://github.com/agentsfolder/spec) — MEDIUM confidence (emerging standard)
- Semantic Kernel agent templates: [learn.microsoft.com/semantic-kernel/frameworks/agent/agent-templates](https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/agent-templates) — HIGH confidence (official docs)
- Google ADK plugin architecture: [google.github.io/adk-docs/plugins](https://google.github.io/adk-docs/plugins/) — HIGH confidence (official docs)
- Composable agent pipelines, Tribe AI: [Inside the Machine: How Composable Agents Are Rewiring AI Architecture in 2025](https://www.tribe.ai/applied-ai/inside-the-machine-how-composable-agents-are-rewiring-ai-architecture-in-2025) — MEDIUM confidence
- Orkes Conductor schema validation: [Input/Output Schema Validation](https://orkes.io/content/developer-guides/schema-validation) — MEDIUM confidence
- Multi-agent orchestration patterns: [AI Agent Orchestration Patterns, Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) — HIGH confidence (official Microsoft docs)
- Skywork AI handoff best practices: [Best Practices for Multi-Agent Orchestration and Reliable Handoffs](https://skywork.ai/blog/ai-agent-orchestration-best-practices-handoffs/) — MEDIUM confidence

---

*Feature research for: pluggable agent template system, composable bead pipeline, generic engine (night-shift v2.0 milestone)*
*Researched: 2026-02-25*
