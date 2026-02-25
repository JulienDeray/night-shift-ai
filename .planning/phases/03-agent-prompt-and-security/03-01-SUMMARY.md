---
phase: 03-agent-prompt-and-security
plan: 01
subsystem: agent
tags: [zod, vitest, prompt-engineering, injection-mitigation, template]

# Dependency graph
requires:
  - phase: 02-orchestrator-hooks
    provides: "NtfyClient and orchestrator hooks that the agent pipeline will use for notifications"
provides:
  - "Extended CodeAgentSchema with prompts, reviewer, allowed_commands, max_tokens, variables"
  - "CodeAgentConfig interface updated with all new fields in camelCase"
  - "src/agent/types.ts with AnalysisCandidate, AnalysisResult, BeadResult, CodeAgentOutcome, CodeAgentRunResult"
  - "src/agent/prompt-loader.ts with hardcoded INJECTION_MITIGATION_PREAMBLE prepend and renderTemplate-based variable substitution"
  - "4 bead prompt templates (analyze, implement, verify, mr) with category guidance, command whitelist, and structured output instructions"
affects: [03-02, 04-git-harness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injection mitigation preamble hardcoded in prompt-loader — cannot be accidentally removed by user config"
    - "Template paths resolved relative to configDir (not process.cwd()) — avoids path confusion with multi-repo setups"
    - "Explicit vars allowlist passed to renderTemplate — process.env never spread into prompt variables"
    - "Zod v4 default factories use arrow functions (() => ({})) for objects and arrays"

key-files:
  created:
    - src/agent/types.ts
    - src/agent/prompt-loader.ts
    - src/agent/prompts/analyze.md
    - src/agent/prompts/implement.md
    - src/agent/prompts/verify.md
    - src/agent/prompts/mr.md
    - tests/unit/prompt-loader.test.ts
  modified:
    - src/core/config.ts
    - src/core/types.ts

key-decisions:
  - "INJECTION_MITIGATION_PREAMBLE exported as a named constant for test assertions but hardcoded — not configurable"
  - "configDir parameter resolves relative template paths to avoid Pitfall 5 (stale cwd assumption)"
  - "Zod v4 requires arrow function factories for .default() on objects/arrays — .default({}) is not assignable"
  - "z.record(z.string(), z.string()) required in Zod v4 for Record<string, string> (two-arg form)"

patterns-established:
  - "Bead prompt files are Markdown with {{variable}} placeholders substituted by renderTemplate"
  - "All bead prompts include a command whitelist section and a structured JSON output section"
  - "NO_IMPROVEMENT is a first-class result from the Analyze bead, not an error condition"

requirements-completed: [AGENT-06, AGENT-07, AGENT-09]

# Metrics
duration: 4min
completed: 2026-02-25
---

# Phase 3 Plan 01: Agent Prompt and Security Summary

**Zod v4 CodeAgentSchema extended with 5 new fields, injection-mitigation prompt-loader with hardcoded preamble, and 4 bead prompt templates (analyze/implement/verify/mr) with command whitelists and structured JSON output**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-25T09:57:31Z
- **Completed:** 2026-02-25T10:00:53Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Extended CodeAgentSchema with prompts (4 paths with defaults), reviewer, allowed_commands, max_tokens, variables fields; updated mapConfig() and CodeAgentConfig interface to match
- Created src/agent/types.ts with all inter-bead communication types (AnalysisCandidate, AnalysisResult, BeadResult, CodeAgentRunResult)
- Created src/agent/prompt-loader.ts with hardcoded INJECTION_MITIGATION_PREAMBLE prepend (cannot be removed), configDir-relative path resolution, and explicit vars allowlist
- Authored 4 bead prompt templates with category guidance, ~100-line diff cap constraint, command whitelist, and structured JSON output instructions
- 31 unit tests pass (18 config + 13 prompt-loader)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend CodeAgentSchema and types for 4-bead pipeline config** - `72d7ea7` (feat)
2. **Task 2: Create prompt loader with injection preamble and 4 bead templates** - `b592357` (feat)

## Files Created/Modified

- `src/core/config.ts` - Extended CodeAgentSchema with 5 new fields; updated mapConfig() and getDefaultConfigYaml()
- `src/core/types.ts` - Extended CodeAgentConfig interface with prompts, reviewer, allowedCommands, maxTokens, variables
- `src/agent/types.ts` - New file: AnalysisCandidate, AnalysisResult, BeadResult, CodeAgentOutcome, CodeAgentRunResult
- `src/agent/prompt-loader.ts` - New file: loadBeadPrompt with hardcoded preamble prepend and renderTemplate substitution
- `src/agent/prompts/analyze.md` - Analyze bead template (89 lines): repo scan, candidate ranking, handoff JSON, NO_IMPROVEMENT handling
- `src/agent/prompts/implement.md` - Implement bead template (46 lines): apply selected candidate, retry context via verify_error
- `src/agent/prompts/verify.md` - Verify bead template (42 lines): run build+tests, pass/fail JSON, no code changes
- `src/agent/prompts/mr.md` - MR bead template (73 lines): branch naming, squash commit, glab mr create with labels and reviewer
- `tests/unit/prompt-loader.test.ts` - New file: 13 tests for preamble prepend, substitution, path resolution, security invariants

## Decisions Made

- INJECTION_MITIGATION_PREAMBLE exported as named constant for test assertions but is not configurable — enforces locked decision from CONTEXT.md
- configDir parameter resolves relative template paths against the config file's directory, not process.cwd() — avoids stale working directory issues in multi-repo setups
- Zod v4 requires arrow function factories for `.default()` on objects/arrays (`.default(() => ({}))` not `.default({})`); also requires two-arg `z.record(z.string(), z.string())` for `Record<string, string>` typing

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Zod v4 .default({}) and z.record() TypeScript errors**
- **Found during:** Task 1 (Extend CodeAgentSchema)
- **Issue:** `.default({})` on prompts z.object() is not assignable in Zod v4 (requires full value or factory); `z.record(z.string())` infers `Record<string, unknown>` not `Record<string, string>`; `z.array(z.string()).default([...])` requires factory
- **Fix:** Changed `.default({})` to `.default(() => ({ analyze: ..., implement: ..., verify: ..., mr: ... }))`, used `.default(() => [...])` for array, used `z.record(z.string(), z.string())` for variables
- **Files modified:** src/core/config.ts
- **Verification:** `npx tsc --noEmit` passes cleanly; all 18 config tests pass
- **Committed in:** `72d7ea7` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — Zod v4 type compatibility bugs)
**Impact on plan:** Fix was necessary for TypeScript compilation. No scope creep.

## Issues Encountered

None beyond the Zod v4 `.default()` and `z.record()` typing issues documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Prompt infrastructure complete: schema, types, loader, and 4 templates ready for Plan 02 (code-agent-runner)
- Plan 02 can import `loadBeadPrompt` from `src/agent/prompt-loader.ts` and types from `src/agent/types.ts`
- Templates use {{category_guidance}}, {{handoff_file}}, {{analysis_file}}, {{build_commands}}, {{reviewer}}, {{short_description}} variables that Plan 02's runner will populate

---
*Phase: 03-agent-prompt-and-security*
*Completed: 2026-02-25*
