---
status: resolved
trigger: "agent init falsely reports config registration + --register flag missing"
created: 2026-03-09T00:00:00Z
updated: 2026-03-09T00:00:00Z
---

## Current Focus

hypothesis: Confirmed - two distinct root causes identified
test: Code reading, plan comparison, filesystem inspection
expecting: n/a - investigation complete
next_action: Report findings

## Symptoms

expected: (1) agent init should not claim config updated when no nightshift.yaml exists. (2) --register flag should work.
actual: (1) Prints "Added to nightshift.yaml" even though tester says no nightshift.yaml present. (2) --register is unknown option.
errors: "error: unknown option '--register'" for issue 2
reproduction: Run nightshift agent init in a folder without nightshift.yaml; run with --register flag
started: Since initial implementation (11-01)

## Eliminated

- hypothesis: "scaffoldAgent returns configUpdated=true even when nightshift.yaml is missing"
  evidence: "Code at scaffold.ts:130-159 correctly sets configUpdated=false in the catch block when fs.readFile fails. The CLI at agent.ts:42-44 only prints the success message when configUpdated is true. Logic is sound."
  timestamp: 2026-03-09

## Evidence

- timestamp: 2026-03-09
  checked: src/agent/scaffold.ts lines 129-159 (config update logic)
  found: scaffoldAgent reads nightshift.yaml via getConfigPath(base). If file missing, catch block fires, console.warn prints warning, configUpdated stays false. If file exists, it appends agent to arrays and sets configUpdated=true.
  implication: The scaffold logic correctly handles both cases.

- timestamp: 2026-03-09
  checked: src/cli/commands/agent.ts lines 42-44 (message printing)
  found: "Added to nightshift.yaml" message is gated by `if (result.configUpdated)`. Only prints when scaffold actually updated the file.
  implication: CLI correctly reflects scaffold result.

- timestamp: 2026-03-09
  checked: workbench/nightshift.yaml (filesystem)
  found: A nightshift.yaml EXISTS at workbench/nightshift.yaml and already contains `my-test-agent` in both agents and schedule arrays (lines 47-52). This proves the scaffold DID find and update this file.
  implication: The UAT tester likely ran the command from the workbench/ directory where nightshift.yaml exists. The tester incorrectly believed no config file was present.

- timestamp: 2026-03-09
  checked: 11-01-PLAN.md Task 1 step 8 and Task 2 item 1
  found: The plan specifies that agent init ALWAYS attempts config registration. No --register flag was ever designed. The plan says "If file does not exist, print a warning... and set configUpdated: false. If file exists, append entries."
  implication: --register was never part of the spec. The UAT test expectation is invalid.

- timestamp: 2026-03-09
  checked: src/cli/commands/agent.ts line 37 (option definitions)
  found: Only `.option("--force", "Overwrite existing agent directory")` is defined. No --register option.
  implication: Confirmed --register was never implemented because it was never planned.

## Resolution

root_cause: |
  **Issue 1 (Test 2 - False config registration message):**
  NOT A CODE BUG. The code is correct. The scaffold logic (scaffold.ts:130-159) properly
  handles both cases: returns configUpdated=true only when nightshift.yaml exists and was
  updated, returns false otherwise. The CLI (agent.ts:42-44) is correctly gated.

  The UAT observation is explained by: workbench/nightshift.yaml exists and already contains
  the my-test-agent entry (lines 47-52), proving the scaffold successfully found and updated
  it. The tester likely ran from the workbench/ directory and did not realize a nightshift.yaml
  was present there.

  File: workbench/nightshift.yaml (contains the evidence of successful registration)
  File: src/agent/scaffold.ts:130-159 (correct logic)
  File: src/cli/commands/agent.ts:42-44 (correct gating)

  **Issue 2 (Test 3 - --register flag missing):**
  INVALID TEST EXPECTATION, not a code bug. The --register flag was never part of the design.
  The 11-01-PLAN.md explicitly specifies that agent init ALWAYS attempts config registration
  (Task 1 step 8). There is no opt-in flag in the plan. The UAT test expectation for
  `nightshift agent init another-agent --register` tests a feature that was never specified
  or designed.

  File: src/cli/commands/agent.ts:37 (only --force option defined, as per plan)
  File: 11-01-PLAN.md Task 1 step 8 (always-register design, no flag)

fix: N/A (research only)
verification: N/A
files_changed: []
