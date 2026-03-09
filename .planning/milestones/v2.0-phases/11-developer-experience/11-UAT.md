---
status: diagnosed
phase: 11-developer-experience
source: 11-01-SUMMARY.md, 11-02-SUMMARY.md, 11-03-SUMMARY.md
started: 2026-03-09T19:00:00Z
updated: 2026-03-09T19:20:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running nightshift daemon. Run `npx nightshift` or the main entry point from scratch. The CLI boots without errors, shows help or usage output, and `npx nightshift agent list` returns without crashing.
result: pass

### 2. Scaffold New Agent
expected: Run `npx nightshift agent init my-test-agent`. Creates `agents/my-test-agent/` directory containing manifest.yaml, preamble.md, clone-stub.md, and analyze.md. The manifest.yaml is valid YAML with agent name, model, beads pipeline, and template variables.
result: issue
reported: "nightshift agent init my-test-agent returned: Added to nightshift.yaml with schedule: 0 2 * * * but no nightshift.yaml is present in the folder"
severity: major

### 3. Scaffold with Config Registration
expected: Run `npx nightshift agent init another-agent --register`. Creates agent directory as above AND adds an entry for "another-agent" in nightshift.yaml under the agents array.
result: issue
reported: "returned error: unknown option '--register'"
severity: major

### 4. Validate Agent
expected: Run `npx nightshift agent validate code-agent` (or whatever built-in agent exists). Output shows schema validation pass, prompt file checks, template variable checks. Missing env vars shown as warnings (not errors).
result: pass

### 5. List Agents
expected: Run `npx nightshift agent list`. Displays a table showing discovered agents with columns for name, bead count, schedule info, and last run.
result: pass

### 6. Show Agent Details
expected: Run `npx nightshift agent show code-agent`. Displays manifest summary, bead pipeline listing, schedule configuration, and recent run history for the agent.
result: pass

### 7. Test Suite Passes
expected: Run `npx vitest run`. All tests pass including the 21 new Phase 11 tests (12 scaffold unit tests + 9 agent CLI integration tests). No regressions in existing tests.
result: pass

### 8. README Reflects v2.0
expected: Open README.md. It describes the v2.0 pluggable agent architecture, includes agent CLI commands (init, validate, list, show), and links to docs/agents.md. No references to deprecated code_agent: or recurring: config keys.
result: pass

### 9. Agent Reference Documentation
expected: Open docs/agents.md. It documents every manifest field with type/default/required, template variable system, output schema contracts, environment variable isolation, and includes a troubleshooting section.
result: pass

## Summary

total: 9
passed: 7
issues: 2
pending: 0
skipped: 0

## Gaps

- truth: "Scaffold init correctly reports config registration status"
  status: failed
  reason: "User reported: nightshift agent init my-test-agent returned: Added to nightshift.yaml with schedule: 0 2 * * * but no nightshift.yaml is present in the folder"
  severity: major
  test: 2
  root_cause: "Not a code bug. The code at src/agent/scaffold.ts:130-159 correctly gates configUpdated behind successful file read/write. The message only prints when src/cli/commands/agent.ts:42-44 sees configUpdated=true. A nightshift.yaml existed at workbench/nightshift.yaml and was correctly updated (agent entry visible at lines 47-52). User likely ran from workbench/ directory where config exists."
  artifacts:
    - path: "src/agent/scaffold.ts"
      issue: "Logic is correct — configUpdated only set true after successful write"
    - path: "src/cli/commands/agent.ts"
      issue: "Gating is correct — message only shown when configUpdated=true"
    - path: "workbench/nightshift.yaml"
      issue: "Contains my-test-agent registration — proof scaffold worked"
  missing: []
  debug_session: ".planning/debug/agent-init-config-register.md"

- truth: "agent init supports --register flag for config registration"
  status: failed
  reason: "User reported: returned error: unknown option '--register'"
  severity: major
  test: 3
  root_cause: "Invalid test expectation. The --register flag was never designed or specified. Per 11-01-PLAN.md Task 1 step 8, agent init ALWAYS attempts config registration (no opt-in flag). The only option defined is --force (src/cli/commands/agent.ts:37). This is working as designed."
  artifacts:
    - path: "src/cli/commands/agent.ts"
      issue: "Only --force defined — correct per plan specification"
    - path: ".planning/phases/11-developer-experience/11-01-PLAN.md"
      issue: "Plan specifies always-register design, no --register flag"
  missing: []
  debug_session: ".planning/debug/agent-init-config-register.md"
