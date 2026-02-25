# Pitfalls Research

**Domain:** Pluggable agent architecture — adding agent templates, composable bead plugins, typed I/O, and generic engine to an existing hardcoded nightly automation pipeline
**Researched:** 2026-02-25
**Confidence:** HIGH (grounded in the existing codebase + authoritative sources on plugin system migration, schema evolution, agent security)

---

## Critical Pitfalls

### Pitfall 1: The `isCodeAgent` Boolean Stays Behind After Migration

**What goes wrong:**
The current dispatch path in `AgentPool.dispatch()` uses `task.isCodeAgent && this.codeAgentConfig` as a branch predicate. When v2.0 introduces a generic agent loader, the boolean flag is not removed — instead, new agent types get additional booleans (`isCustomAgent`, `isTemplateAgent`) or the flag's semantics silently shift. Code that checks `isCodeAgent` is now partially wrong everywhere it appears. The task queue, inbox reporter, notification system, and formatters all diverge silently because they each read the flag independently.

**Why it happens:**
Refactoring a live dispatch branch while preserving behaviour feels risky. The natural impulse is to leave `isCodeAgent` in place for the code-agent case and "just add the generic path alongside it." This creates a flag-based two-code-paths problem that Fowler calls the flag parameter anti-pattern: the dispatch point now encodes not just behaviour but identity, and any future agent type requires touching the same conditional everywhere it appears.

**How to avoid:**
Remove `isCodeAgent` from `NightShiftTask` entirely when adding the generic engine. Replace with an `agentType: "generic" | "code-agent"` discriminated union or, better, an `agentRef?: string` field that points to the agent directory. The dispatch path becomes a single lookup: resolve agent → run agent. The code-agent becomes agent type `code-agent` loaded from its directory manifest, not a flag.

**Warning signs:**
- `isCodeAgent` appears in more than two files after the migration starts.
- A new test for custom agents has to import `code-agent.ts` directly to verify it still works.
- The `AgentPool` constructor still accepts `codeAgentConfig` as a separate top-level option after the generic engine is added.

**Phase to address:**
Phase 1 (Generic Engine Foundation) — the flag must be retired before adding any new agent type, not after. Attempting to add a second agent type while `isCodeAgent` still exists locks in the anti-pattern.

---

### Pitfall 2: Bead I/O Contract Defined Only at Runtime (JSON Parse Failures Discovered Too Late)

**What goes wrong:**
The current handoff mechanism writes a JSON stub file before spawning the bead, then reads and parses whatever the bead wrote back. When a bead writes malformed JSON, a missing field, or the wrong shape (e.g., `passed` vs `PASSED`), the pipeline silently falls back — the stub's `{ "passed": false, "error_details": "pending" }` is never overwritten, and the pipeline treats it as a failed run rather than a contract violation. In a pluggable bead system, a user-authored bead can silently break the pipeline with no actionable error message.

**Why it happens:**
The current system is hardcoded to one pipeline where the orchestrator and the bead author are the same person. When beads become independently authored plugins, there is no shared contract enforced at a boundary. The Cloudflare Pipelines team documented the exact same failure: schema mismatches between pipeline steps were only discovered as dropped events at runtime, not at development time.

**How to avoid:**
Define each bead's output schema as a Zod schema in the bead manifest. Validate the handoff file against that schema immediately after the bead returns — before proceeding to the next bead. Report the Zod validation error as a `BEAD_CONTRACT_VIOLATION` outcome, not a silent `NO_IMPROVEMENT`. This catches contract breakage on the first integration test rather than in a nightly run.

**Warning signs:**
- A bead's JSON output shape is documented only in a comment inside the bead's prompt file, not enforced in code.
- The parse-failure catch block at line 121 in `code-agent-runner.ts` falls back silently when the handoff JSON doesn't match.
- User-authored beads are tested by running the full pipeline manually, not by unit-testing the handoff schema.

**Phase to address:**
Phase 2 (Bead Plugin Format) — define the manifest schema and typed handoff contracts before any user-authored bead can be registered. Retroactively defining contracts after multiple bead types exist is significantly harder.

---

### Pitfall 3: Config Schema Migration Breaks Existing `nightshift.yaml` Files

**What goes wrong:**
v2.0 replaces the top-level `code_agent:` block with a generic `agents:` list. Users who upgrade night-shift get an immediate `Invalid config` error because their existing YAML has `code_agent:` and the new Zod schema no longer accepts it. If the migration path is not defined in the config loader, v1.0 users are stranded on the old binary.

**Why it happens:**
Adding a new top-level key while removing an old one is a breaking change for every existing config file. The standard schema evolution pattern — expand (add new key), migrate (run automatically or document migration), contract (remove old key) — is skipped when teams treat config schema changes as pure TypeScript refactoring. Zod v4 also has a documented breaking behaviour: optional fields with `.default()` now always return the default, even if the key is absent. Combining a Zod version gap with a schema shape change compounds the risk.

**How to avoid:**
Use the expand-and-contract pattern:
1. In the Zod schema, accept BOTH `code_agent:` and `agents:` simultaneously during the transition.
2. In `mapConfig()`, if `code_agent:` is present and `agents:` is absent, auto-derive the equivalent `agents:` entry and emit a deprecation warning with the migration command.
3. Only remove `code_agent:` from the Zod schema in a subsequent release after the migration path has been validated against real configs.

Never remove a YAML key in the same commit that adds its replacement.

**Warning signs:**
- The Zod `ConfigSchema` no longer contains `code_agent` at all before any migration tooling exists.
- Running `nightshift config validate` on a v1.0 config file after the schema change exits with `Invalid config` rather than `Deprecated: use agents: instead`.
- No test covers the case where `code_agent:` is present but `agents:` is absent.

**Phase to address:**
Phase 1 (Generic Engine Foundation) or Phase 3 (Config Schema Update) — the deprecation shim must be implemented in the same commit that changes the Zod schema, not as a follow-up.

---

### Pitfall 4: Agent Template Directory Loading Enables Path Traversal

**What goes wrong:**
The generic engine loads agent templates by resolving a path from `nightshift.yaml` (e.g., `agent: ./my-agents/code-agent`). If path resolution is not canonicalized and validated against a safe root, a malicious or mistakenly authored config can reference `../../etc/passwd` or traverse outside the config directory to load arbitrary files as agent manifests. CVE-2025-53109 and CVE-2025-53110 in the MCP filesystem reference implementation demonstrated that simple path-prefix checks are bypassable via symlinks.

**Why it happens:**
`path.resolve(configDir, agentRef)` resolves `.` and `..` correctly, but does not prevent symlinks from escaping the intended root. The current `loadBeadPrompt` function already uses `path.resolve(configDir, templatePath)` without any subsequent containment check — this is safe today because prompt paths come from a trusted internal config, but user-authored agent directories are untrusted input.

**How to avoid:**
After calling `path.resolve()`, verify the resolved absolute path starts with `path.resolve(configDir)` (using `startsWith` on the normalized path). Additionally, use `fs.realpath()` to resolve symlinks before performing the prefix check. Reject any agent directory that resolves outside the config root.

```typescript
const resolved = await fs.realpath(path.resolve(configDir, agentRef));
const safeRoot = await fs.realpath(configDir);
if (!resolved.startsWith(safeRoot + path.sep)) {
  throw new ConfigError(`Agent path escapes config directory: ${agentRef}`);
}
```

**Warning signs:**
- The agent directory resolution uses `path.resolve()` but not `fs.realpath()`.
- Agent template paths are validated only by Zod type checking (string format), not filesystem containment.
- Tests for the agent loader do not include a symlink traversal test case.

**Phase to address:**
Phase 2 (Bead Plugin Format) — when the generic file loader for agent manifests is first written, containment validation must be part of the initial implementation, not a security hardening pass later.

---

### Pitfall 5: Hardcoded `buildBeadEnv` Allowlist Breaks When Beads Need Different Environment Variables

**What goes wrong:**
The current `buildBeadEnv` function maintains a static allowlist: `HOME`, `PATH`, `USER`, `LANG`, `SHELL`, `TERM`, and conditionally `GITLAB_TOKEN` for the `mr` bead. The bead name is a union type `"analyze" | "implement" | "verify" | "mr" | "log"`. When the generic engine introduces user-defined beads, this union type must expand — but the env allowlist logic is coupled to the fixed bead name. A new bead that legitimately needs a different env var (e.g., `JIRA_TOKEN` for a bead that creates Jira issues) either gets blocked or requires patching the core allowlist, defeating the purpose of a plugin system.

**Why it happens:**
The allowlist was designed for exactly five known beads where the security boundary (GITLAB_TOKEN to mr bead only) was a first-class requirement. Extending it to user-defined beads without a principled model produces either: (a) over-permissive allowlists that leak tokens, or (b) over-restrictive allowlists that force users to work around the system.

**How to avoid:**
Move env var configuration into the bead manifest. Each bead declares which env vars it requires under a `requiredEnv` key. The engine validates that each declared var exists at load time, then constructs the bead env from the manifest declaration. The GITLAB_TOKEN-to-mr-bead invariant becomes a property of the code-agent's manifest, not a hardcoded condition in the engine.

```yaml
# In bead manifest
env:
  - GITLAB_TOKEN   # forwarded from host env if present
  - HOME
  - PATH
```

The engine never passes vars not declared in the manifest — preserving the structural safety that `buildBeadEnv` currently provides.

**Warning signs:**
- `buildBeadEnv` still has `beadName` as its first parameter after the generic engine is introduced.
- The `beadName` union type needs to include `string` to accommodate custom beads.
- A user asks how to pass a custom env var to their bead and the answer is "modify `bead-runner.ts`."

**Phase to address:**
Phase 2 (Bead Plugin Format) — define the manifest's env declaration at the same time as the manifest schema, so no bead is ever instantiated without a declared env contract.

---

### Pitfall 6: Template Variable Injection via User-Defined Variables

**What goes wrong:**
The current `renderTemplate` function replaces `{{varName}}` placeholders with values from a merged map of built-in vars and `config.variables`. When user-defined agent templates can declare arbitrary variables, a user's `variables:` block in `nightshift.yaml` can shadow built-in variables: setting `variables: { handoff_file: "/etc/passwd" }` replaces the built-in `handoff_file` with an attacker-controlled path. Even without malicious intent, a user variable named `category` accidentally overwrites the engine-injected category value.

**Why it happens:**
The current `buildBuiltInVars` function uses object spread `{ ...config.variables }` applied last, meaning user variables always win over built-ins. This is intentional for the current hardcoded agent (the author controls both), but becomes a vulnerability when the engine and the template author are different parties.

**How to avoid:**
Invert the merge order: built-in vars must take precedence over user-defined vars. Apply user vars first, then overlay built-ins:

```typescript
const merged = { ...userVars, ...builtInVars }; // built-ins win
```

Additionally, validate that user-declared variable names do not collide with the reserved built-in names. Expose the reserved name list in the manifest spec so template authors know what is off-limits.

**Warning signs:**
- The spread order is `{ ...buildBuiltInVars(...), ...config.variables }` anywhere in the codebase.
- There is no list of reserved variable names documented in the manifest spec.
- A test that sets `variables: { repo_url: "malicious" }` does not assert that `{{repo_url}}` resolves to the real repo URL.

**Phase to address:**
Phase 2 (Bead Plugin Format) / Phase 4 (Code-Agent Migration as Proof of Architecture) — fix the merge order before the first user-authored template is tested.

---

### Pitfall 7: The "Stub-File Before Spawn" Pattern Breaks With Concurrent Agent Execution

**What goes wrong:**
The current implementation writes a JSON stub file to `handoffDir` before spawning the bead, then reads the file after the bead completes. The handoff directory is named per-run but the stub file names are fixed (`analysis.json`, `verify.json`). If two code-agent tasks are dispatched concurrently (the pool allows `maxConcurrent > 1`), they collide: both beads write to the same stub file name, and the last write wins. The pipeline reads the wrong bead's output.

**Why it happens:**
The stub pattern was designed assuming one code-agent run at a time. The `maxConcurrent` config key exists in `NightShiftConfig` and can be set to values greater than one. Today the code-agent is only dispatched for its scheduled slot (one per night), but the generic engine changes this: multiple agent types could be dispatched in the same poll cycle, and the code-agent itself could be dispatched twice if a user configures two recurring tasks pointing to it.

**How to avoid:**
Handoff files must be scoped to the task ID (or a UUID), not to a fixed filename. Use a temp directory per task invocation (which the current `cloneRepo` call already does via `mkdtemp`), and write all handoff files inside that per-run temp directory. The pipeline context already carries `handoffDir` — the fix is to ensure stub filenames also include the task ID:

```typescript
const stubPath = path.join(ctx.handoffDir, `analysis-${ctx.taskId}.json`);
```

**Warning signs:**
- `path.join(ctx.handoffDir, "analysis.json")` appears without a unique suffix.
- The test suite never runs two code-agent pipelines concurrently.
- `maxConcurrent: 2` in a test config causes intermittent flakiness in handoff file reads.

**Phase to address:**
Phase 1 (Generic Engine Foundation) — when the engine dispatches multiple agent types, concurrency safety must be a design criterion from the start. Do not wait for a production failure.

---

### Pitfall 8: Manifest Schema Validation Happens at Dispatch Time, Not Load Time

**What goes wrong:**
The agent manifest (`manifest.yaml`) is loaded and validated when the daemon dispatches a scheduled task — i.e., at 2am. If the manifest is malformed, the task fails silently: the JSONL log gets an error entry, Ntfy sends a failure notification, and the user wakes up to a broken run with no useful diagnosis. The user has no way to validate their agent template before deploying it.

**Why it happens:**
The current system validates `nightshift.yaml` eagerly on daemon start. Adding a separate agent directory with its own manifest introduces a second validation surface that is easy to forget to check at startup.

**How to avoid:**
Validate all referenced agent manifests at daemon startup and on `nightshift config validate`. If any manifest is missing, unreadable, or schema-invalid, report all errors before the daemon enters the poll loop. Never defer manifest validation to dispatch time.

Additionally, expose a `nightshift agent validate <path>` CLI command that validates a standalone agent directory without starting the daemon.

**Warning signs:**
- The daemon starts successfully even when `agents:` references a directory that does not exist.
- `nightshift config validate` only validates `nightshift.yaml`, not the agent manifests it references.
- There is no CLI subcommand for validating agent templates.

**Phase to address:**
Phase 3 (Config Schema Update and CLI) — manifest validation must be wired into the existing `validateConfig` flow in the same phase that adds manifest support.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Leave `isCodeAgent` flag in `NightShiftTask` and add generic path alongside it | Zero migration risk on dispatch | Every new agent type adds another branch; `AgentPool` becomes a dispatcher with N hardcoded cases | Never — retire before adding second agent type |
| Hardcode `code-agent` prompt paths in the generic engine as defaults | No breaking change for existing config | Generic engine is coupled to one agent's conventions; adding a second agent type requires touching the engine | Never |
| Use fixed handoff filenames (`analysis.json`) even in generic engine | Minimal code change | Silent data corruption with `maxConcurrent > 1` | Never |
| Skip `fs.realpath()` in agent directory resolution | Slightly simpler loader code | Path traversal via symlinks — documented CVE class (CVE-2025-53109/53110) | Never |
| Accept `agents:` and `code_agent:` simultaneously indefinitely | No migration pressure on users | Config parser complexity grows; two code paths for the same concept persist forever | Acceptable during the transition phase only; remove `code_agent:` in the next milestone after v2.0 |
| Merge user vars after built-ins (`{ ...builtIns, ...userVars }`) | User can override any built-in (flexibility) | Users can accidentally or maliciously override security-critical vars like `handoff_file` | Never for built-in security vars; consider a two-namespace approach |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Bead manifest loaded from user directory | Trusting `path.resolve(configDir, agentRef)` alone for containment | Follow with `fs.realpath()` + startsWith check to prevent symlink escape |
| Generic engine invoking code-agent | Assuming `config.codeAgent` is still the source of truth | Code-agent config must come from the agent manifest, not the top-level config block, or both paths diverge |
| Zod schema for manifests | Using `z.record(z.string())` for `variables:` without reserved-name validation | Add a `.refine()` check that variable names do not collide with the built-in reserved set |
| `buildBeadEnv` with user beads | Passing `beadName` as a string union that includes `string` for unknown types | Replace the union with a manifest-declared env allowlist; the function should not know bead names |
| CLI `nightshift config validate` | Only validating `nightshift.yaml` Zod schema | Must also resolve and validate all agent manifest files referenced in `agents:` |
| Handoff file reads after bead crash | Silently returning the stub value (e.g., `{ passed: false }`) when the file was never overwritten | Distinguish stub (never written) from bead failure (wrote invalid JSON) — different error paths |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading all agent manifests on every poll cycle | Daemon poll latency increases linearly with number of registered agents | Cache parsed manifests at daemon startup; reload only on SIGHUP or config change | More than ~10 agents registered |
| Re-reading prompt template files on every bead invocation | I/O overhead per bead; manifest directory read on every pipeline step | Cache prompt file contents keyed by resolved path + mtime; invalidate on file change | Large prompt templates (>100KB), high bead frequency |
| Validating agent directory existence at dispatch time | Dispatch latency spike when agent directory is on slow NFS or network path | Validate at startup, cache result, re-validate on manifest cache miss | Network-mounted config directories |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| User-defined bead declares `env: [GITLAB_TOKEN]` and the engine forwards it unconditionally | Token forwarded to analysis/verify beads that should never see it | Enforce an engine-level override: regardless of manifest declaration, GITLAB_TOKEN is never forwarded to beads unless the bead is the `mr` step of the code-agent pipeline |
| Template variable shadowing: `variables: { handoff_file: "attacker-path" }` | Bead reads/writes attacker-controlled path instead of engine-assigned temp path | Built-in vars injected by the engine must be applied after user vars so they cannot be overridden |
| Agent manifest `manifest.yaml` loaded from an untrusted directory | Malicious manifest can declare arbitrary tools, commands, or env vars | Zod-validate the manifest with strict schema (`.strict()`) before executing any field from it; reject unknown keys |
| Structural template injection via agent template content | Injecting `{{` / `}}` sequences in user-authored prompt templates to capture built-in var values | Escape or reject `{{` sequences in user-provided `variables:` values; these are data, not template syntax |
| Path traversal in agent directory reference | Arbitrary file read outside config root (documented CVE class via symlinks — CVE-2025-53109) | `fs.realpath()` + startsWith containment check on every agent directory resolution |

---

## "Looks Done But Isn't" Checklist

- [ ] **`isCodeAgent` retired:** The field no longer appears in `NightShiftTask`, `AgentPool`, or any dispatch path — verify with `grep -r isCodeAgent src/`.
- [ ] **Config backward compatibility tested:** A v1.0 `nightshift.yaml` with `code_agent:` passes `nightshift config validate` and produces a deprecation warning, not an error — verify with a dedicated integration test.
- [ ] **Manifest path containment:** Agent directory resolution uses `fs.realpath()` before the prefix check — verify with a symlink traversal unit test.
- [ ] **Bead output schema enforced:** Every bead's handoff JSON is validated against a Zod schema immediately after the bead returns — verify by intentionally writing bad JSON in a bead and confirming a `BEAD_CONTRACT_VIOLATION` outcome rather than a silent fallback.
- [ ] **User vars cannot shadow built-ins:** Setting `variables: { repo_url: "attacker" }` does not override the engine-injected `repo_url` — verify with a unit test on `buildBuiltInVars`.
- [ ] **Concurrent pipeline safety:** Two simultaneous code-agent runs produce two distinct handoff file paths — verify by dispatching two tasks concurrently and confirming neither reads the other's output.
- [ ] **Daemon startup fails on broken manifest:** Referencing a non-existent agent directory in `nightshift.yaml` prevents the daemon from starting (or emits a clear error) — verify with an integration test.
- [ ] **`nightshift agent validate` exists:** Users can validate an agent template directory without starting the daemon — verify the CLI command is implemented and returns a non-zero exit code on invalid manifests.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| `isCodeAgent` flag entrenched in dispatch logic | MEDIUM | Introduce a discriminated union type for agent dispatch strategy; migrate call sites one at a time; remove flag last |
| Existing `nightshift.yaml` breaks after schema migration | LOW | Emit `nightshift migrate-config` command that rewrites `code_agent:` to `agents:` in-place; test on user's own config before upgrading |
| Path traversal exploit via symlinked agent directory | MEDIUM | Reject all agent directories that fail the `fs.realpath()` check; rotate any credentials the agent had access to |
| Bead contract violation causes silent wrong output | LOW | Add Zod validation at the handoff read site; existing tests catch regressions with the validation in place |
| Two concurrent runs write to the same handoff file | LOW | Add task ID suffix to all handoff filenames; existing tests should catch the collision immediately |
| User vars shadow engine built-ins | LOW | Invert merge order in one line; add a reserved-name test that covers all built-in var names |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| `isCodeAgent` flag persists after migration | Phase 1: Generic Engine Foundation | `grep -r isCodeAgent src/` returns zero results after Phase 1 |
| Bead I/O contract unenforced at runtime | Phase 2: Bead Plugin Format | Unit test: bead writes bad JSON → expect `BEAD_CONTRACT_VIOLATION`, not `NO_IMPROVEMENT` |
| Config schema breaks existing YAML | Phase 1 or Phase 3: Config Schema Update | Integration test: v1.0 `nightshift.yaml` passes `config validate` with deprecation warning |
| Path traversal in agent directory loading | Phase 2: Bead Plugin Format | Unit test: symlinked agent dir outside config root → `ConfigError` |
| `buildBeadEnv` coupled to hardcoded bead names | Phase 2: Bead Plugin Format | Removing bead-name union from function signature compiles without errors |
| Template variable shadowing | Phase 2 or Phase 4: Code-Agent Migration | Unit test: `variables: { repo_url: "x" }` → `{{repo_url}}` resolves to real URL |
| Concurrent handoff file collision | Phase 1: Generic Engine Foundation | Integration test: two simultaneous agent runs → both read correct handoff files |
| Manifest validation deferred to dispatch | Phase 3: Config Schema Update and CLI | `nightshift daemon start` fails if any referenced agent directory does not exist |

---

## Sources

- Existing night-shift codebase analysis (`src/daemon/agent-pool.ts`, `src/agent/bead-runner.ts`, `src/agent/code-agent-runner.ts`, `src/core/config.ts`) — HIGH confidence, primary source
- [Cloudflare Pipelines Typed Bindings Changelog (Feb 2026)](https://developers.cloudflare.com/changelog/post/2026-02-24-typed-bindings-setup-improvements-error-metrics/) — HIGH confidence, direct parallel: schema mismatches discovered as dropped events at runtime, not at development time
- [OWASP Path Traversal Attack](https://owasp.org/www-community/attacks/Path_Traversal) — HIGH confidence, official OWASP guidance
- [CVE-2025-53109/53110: MCP Filesystem Server Symlink Escape (Anthropic reference implementation)](https://www.ikangai.com/the-complete-guide-to-sandboxing-autonomous-agents-tools-frameworks-and-safety-essentials/) — HIGH confidence, directly relevant to agent file system sandboxing
- [AWS SSM Agent Path Traversal via Plugin IDs (The Hacker News, 2025)](https://thehackernews.com/2025/04/amazon-ec2-ssm-agent-flaw-patched-after/) — HIGH confidence, plugin ID path traversal class identical to agent directory loading risk
- [Automating Agent Hijacking via Structural Template Injection (arxiv.org, Feb 2026)](https://arxiv.org/html/2602.16958v1) — HIGH confidence, peer-reviewed study of template injection in agent pipelines
- [LangChain CVE-2025-68664: PromptTemplate → Arbitrary Code Execution via Jinja2 (Cyata)](https://cyata.ai/blog/langgrinch-langchain-core-cve-2025-68664/) — HIGH confidence, direct precedent for user-defined template format leading to RCE
- [Feature Flag Anti-Patterns: Boolean Coupling (Harness.io)](https://www.harness.io/resources/feature-flagging-anti-patterns-avoiding-pitfalls-in-modern-software-delivery) — MEDIUM confidence, well-established engineering pattern; `isCodeAgent` is a textbook example
- [Remove Control Flag (Refactoring Guru)](https://refactoring.guru/remove-control-flag) — MEDIUM confidence, canonical refactoring reference
- [Schema Evolution Without Breaking Consumers (Data Lakehouse Hub, Feb 2026)](https://datalakehousehub.com/blog/2026-02-de-best-practices-05-schema-evolution/) — MEDIUM confidence, confirms expand-and-contract pattern for config schema migrations
- [Zod v4 Breaking Change: Optional Fields with Defaults (GitHub Issue #4883)](https://github.com/colinhacks/zod/issues/4883) — HIGH confidence, confirmed behavior change affecting `nightshift.yaml` config mapping
- [Backward Compatibility in Schema Evolution (DataExpert.io)](https://www.dataexpert.io/blog/backward-compatibility-schema-evolution-guide) — MEDIUM confidence, industry-standard schema evolution guidance

---
*Pitfalls research for: v2.0 pluggable agent architecture migration — adding agent templates, composable bead plugins, typed I/O, and generic engine to existing night-shift nightly automation platform*
*Researched: 2026-02-25*
