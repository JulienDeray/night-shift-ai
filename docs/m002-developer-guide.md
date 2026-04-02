# Night-Shift M002 — Developer Guide

> What changed, what it means for your agents, and how to use the new features.

This guide covers the five features shipped in M002 (Quality of Life). Each section explains what the feature does, how to configure it, and shows real-world usage examples.

---

## Table of Contents

1. [Human-Readable Logging](#1-human-readable-logging)
2. [Notification Redesign](#2-notification-redesign)
3. [Pipeline Early Exit](#3-pipeline-early-exit)
4. [Persistent State Directories](#4-persistent-state-directories)
5. [Cross-Agent Imports](#5-cross-agent-imports)
6. [Step Name Validation](#6-step-name-validation)
7. [Migration Checklist](#7-migration-checklist)

---

## 1. Human-Readable Logging

### Before

Daemon logs were raw JSON:

```
{"timestamp":"2026-04-02T02:00:05.123Z","level":"info","message":"Step started","data":{"step":"analyze","runId":"abc123"}}
```

### After

Daemon logs are structured text by default:

```
2026-04-02 02:00:05 [INFO] Step started step=analyze runId=abc123
```

The format is: `YYYY-MM-DD HH:MM:SS [LEVEL] Message key=value key2=value2`

- Timestamps are simplified (no `T`, no sub-second precision, no `Z`)
- Log level is uppercased in brackets
- Data fields are appended as `key=value` pairs
- String values containing spaces are double-quoted: `summary="Added input validation"`
- Empty data is omitted — no trailing whitespace

### Tailing daemon logs

```bash
tail -f logs/daemon-2026-04-02.log
```

Output is now human-readable without piping through `jq`.

### Getting JSON output (opt-in)

If you need machine-parseable logs (for a log aggregator, for example), pass `format: "json"` when constructing a Logger:

```typescript
import { Logger } from "./core/logger.js";

// Text format (default — you don't need to specify it)
const textLogger = new Logger({ stdout: true });

// JSON format (opt-in)
const jsonLogger = new Logger({ stdout: true, format: "json" });
```

Both factory methods (`createDaemonLogger()` and `createCliLogger()`) use the text default. No configuration change is needed — the readable format is automatic.

### The `LogFormat` type

A `LogFormat` type is exported for consumers:

```typescript
import type { LogFormat } from "./core/logger.js";

const format: LogFormat = "text"; // "text" | "json"
```

---

## 2. Notification Redesign

### Before

Notifications contained JSON blobs and inconsistent formats.

### After

All four notification types follow a consistent pattern:

| Event | Title | Body | Priority |
|-------|-------|------|----------|
| Start | `🕐 gardener-v2 ▸ nightly-review` | `Task started` | 3 |
| Success | `✅ gardener-v2 ▸ nightly-review` | `3m 42s · Applied input validation` | 3 |
| Failure | `❌ gardener-v2 ▸ nightly-review` | `Step 'verify' failed`<br>`Build error: missing import` | 4 |
| Early Exit | `⏭️ gardener-v2 ▸ nightly-review` | `12s · Nothing to do` | 3 |

**Title pattern:** `{emoji} {agentName} ▸ {taskName}` — consistent across all events.

**Body conventions:**
- **Start:** Minimal — the title says it all
- **Success:** `{duration} · {summary}` — the morning notification tells you what happened
- **Failure:** Step label + cleaned error, no duration — error context matters most
- **Early Exit:** `{duration} · {reason}` — confirms the agent ran and found nothing to do

The agent name is resolved from `task.agentName`, then `result.agentName`, falling back to `"unknown-agent"`.

### No action needed

The notification redesign is automatic. If you have `notify: true` on an agent or schedule entry, you'll see the new format on your next run.

---

## 3. Pipeline Early Exit

This is the biggest new feature. It saves wasted model calls when an agent has nothing to do.

### The problem

Without early exit, an agent like `gardener-v2` runs all 6 steps even when the first step determines there's nothing to review. That's 5 unnecessary Claude invocations (~$0.50+ wasted per empty run).

### The solution

Declare `earlyExit.when` on a step. When that step's JSON output matches the declared conditions, the pipeline stops immediately. Remaining steps are marked `SKIPPED`, overall status is `SUCCESS`, and an ⏭️ notification is sent.

### Manifest syntax

```yaml
steps:
  - name: check_inbox
    prompt: prompts/check_inbox.md
    earlyExit:
      when:
        result: "NOTHING_TO_DO"      # match this key-value in step output
      reason: "No pending reviews"   # optional — appears in notification
    outputSchema:
      type: object
      properties:
        result:
          type: string
          enum: [FOUND_WORK, NOTHING_TO_DO]
      required: [result]

  - name: analyze
    prompt: prompts/analyze.md
    outputSchema: ...

  - name: implement
    prompt: prompts/implement.md
    outputSchema: ...
```

If `check_inbox` returns `{ "result": "NOTHING_TO_DO" }`, the engine:

1. Records `check_inbox` as `SUCCESS`
2. Marks `analyze` and `implement` as `SKIPPED` (with `durationMs: 0`)
3. Returns overall status `SUCCESS` with `earlyExitReason: "No pending reviews"`
4. Sends an ⏭️ notification: `⏭️ gardener-v2 ▸ nightly-review` / `12s · No pending reviews`

### How matching works

The `when` field is a `Record<string, unknown>`. Every key-value pair must match the step's parsed JSON output. Matching uses `JSON.stringify()` deep equality — this handles primitives, arrays, and nested objects:

```yaml
earlyExit:
  when:
    status: "EMPTY"              # string match
    count: 0                     # number match
    tags: ["none"]               # array match (deep equality)
```

All conditions must match (logical AND). If any condition doesn't match, the pipeline continues normally.

### Auto-generated reason

If you omit `reason`, the engine generates one from the matched conditions:

```
status: "EMPTY", count: 0
```

Provide `reason` for a cleaner notification body.

### Interaction with retry

Early exit takes precedence over retry triggers. If a step has both `earlyExit.when` and `retry` configured, and the output matches `earlyExit.when`, the pipeline exits — retry is not evaluated.

### Schema validation

The `earlyExit` field is Zod-validated with `.strict()`:

- `when` is **required** — it's the whole point
- `reason` is **optional** — falls back to auto-generated text
- Unknown fields are **rejected** at manifest load time

### What the result looks like

```typescript
const result = await engine.run(agentDir, agentsRoot, taskId);

if (result.earlyExitReason) {
  // Pipeline exited early — result.status is "SUCCESS"
  console.log(`Skipped: ${result.earlyExitReason}`);
  // result.perStep shows: check_inbox=SUCCESS, analyze=SKIPPED, implement=SKIPPED
}
```

---

## 4. Persistent State Directories

Agents can now declare a persistent directory that survives across runs.

### The problem

Agents that track state (learnings, memory, processed items) needed hardcoded absolute paths or manual directory creation. No framework support existed for persistent, framework-managed directories.

### Manifest syntax

```yaml
name: gardener-feedback
description: Reviews MR statuses and extracts learnings

stateDir: memory    # relative to agent directory

steps:
  - name: review
    prompt: prompts/review.md
    outputSchema: ...
```

### What happens at runtime

1. **Manifest load:** `stateDir: memory` is resolved to an absolute path: `/path/to/agents/gardener-feedback/memory`
2. **Security check:** The resolved path is validated to stay within the agent directory (directory-traversal protection)
3. **Engine start:** `ensureDir()` creates the directory if it doesn't exist
4. **Template injection:** `{{state_dir}}` is available in all prompt templates with the absolute path

### Using `{{state_dir}}` in prompts

```markdown
## Your Memory

Read the learnings file at {{state_dir}}/learnings.yaml to understand past decisions.
After processing, update {{state_dir}}/learnings.yaml with any new insights.
```

The engine injects `state_dir` at built-in precedence — you can't override it with a user variable of the same name (it's a reserved name).

### Reserved variable names

The following names are reserved and cannot be used for user variables or import variable names:

- `task_id`, `run_date`, `agent_name`, `repo_path` (built-ins)
- `state_dir` (injected when stateDir is declared)

Declaring a variable with any of these names causes a `ManifestError` at load time.

### Path containment

The `stateDir` must be a **relative** path (no leading `/`). Absolute paths are rejected at schema validation time. The resolved path is checked to ensure it stays within the agent directory — `../../../etc/passwd` style paths are blocked.

---

## 5. Cross-Agent Imports

Multi-agent workflows can now reference each other's state directories through `imports`.

### The problem

Agent B (e.g., `gardener-v2`) needs to read Agent A's (e.g., `gardener-feedback`) learnings directory. Previously this required hardcoding paths or using shell variables outside the framework.

### Manifest syntax

**Agent A** (`gardener-feedback`) declares a `stateDir`:

```yaml
name: gardener-feedback
stateDir: memory
steps: ...
```

**Agent B** (`gardener-v2`) imports it:

```yaml
name: gardener-v2
imports:
  gardener_memory: "gardener-feedback/memory"
steps:
  - name: check_learnings
    prompt: prompts/check_learnings.md
    outputSchema: ...
```

### How it resolves

The import value `gardener-feedback/memory` follows the pattern `agentName/dirName`:

1. At daemon startup, the orchestrator resolves it: `{agents_root}/gardener-feedback/memory`
2. The absolute path is injected as `{{gardener_memory}}` in all prompt templates
3. The resolved path is available at template built-in precedence

### Using imports in prompts

```markdown
## Gardener Learnings

Read the learnings from: {{gardener_memory}}/learnings.yaml
These were generated by the gardener-feedback agent.
```

### Startup validation

All imports are validated at daemon startup (or `nightshift run`) **before any agent runs**:

1. **Agent exists:** The referenced agent (`gardener-feedback`) must be declared in `nightshift.yaml`
2. **Directory exists:** The resolved path must exist on disk
3. **Name collision:** The variable name (`gardener_memory`) must not collide with reserved names

Validation errors are collected and reported together:

```
Startup validation failed — 2 error(s) across agent(s):

  [1] Agent 'gardener-v2': import 'gardener_memory' references agent 'gardener-feedback' 
      which is not declared in config.agents

  [2] Agent 'gardener-v2': import 'feedback_dir' references directory 
      '/path/to/agents/nonexistent-agent/memory' which does not exist
```

This means broken import references fail fast at startup — not at 2am when the agent runs.

### Import value pattern

Import values must match `agentName/dirName` — exactly one slash, no leading/trailing slashes:

```yaml
imports:
  gardener_memory: "gardener-feedback/memory"    # ✅ valid
  bad_import: "gardener-feedback/a/b"            # ❌ rejected (multiple slashes)
  also_bad: "/gardener-feedback/memory"          # ❌ rejected (leading slash)
```

---

## 6. Step Name Validation

Step names are now validated at manifest load time to prevent silent template failures.

### The problem

Step names like `pick-item` are valid YAML but fail silently in template references:

```yaml
# In manifest:
- name: pick-item       # contains a hyphen

# In a prompt:
{{steps.pick-item.output.result}}
# ↑ The template engine sees this as: steps.pick MINUS item.output.result
# Result: template variable is not resolved, prompt has literal {{steps.pick-item.output.result}}
```

### The rule

Step names must match `/^[a-zA-Z][a-zA-Z0-9_]*$/`:

- Start with a letter
- Followed by letters, digits, or underscores
- **No hyphens, no spaces, no special characters**

### What happens on violation

```
Manifest validation failed:
  manifest.yaml: steps.0.name: Step name 'pick-item' contains unsupported characters.
  Use 'pick_item' instead.
```

The error includes:
1. The invalid name verbatim
2. A suggested snake_case replacement (hyphens → underscores, leading digits prefixed with `_`)

### Valid step names

```yaml
steps:
  - name: analyze        # ✅
  - name: step_one       # ✅
  - name: checkMR        # ✅ (camelCase is valid but snake_case is conventional)
  - name: step2          # ✅
  - name: a              # ✅

  - name: pick-item      # ❌ hyphen
  - name: step one       # ❌ space
  - name: 1step          # ❌ starts with digit
  - name: _private       # ❌ starts with underscore
```

### Migration

If your existing agents use hyphenated step names:

1. Rename step names in `manifest.yaml` (e.g., `pick-item` → `pick_item`)
2. Update any `{{steps.pick-item.output.*}}` references in prompts to `{{steps.pick_item.output.*}}`
3. Run `nightshift agent validate <name>` to confirm

---

## 7. Migration Checklist

### Breaking changes

- **Step names with hyphens are now rejected.** If any of your agents use step names like `pick-item`, `run-tests`, or `create-mr`, you must rename them to snake_case (`pick_item`, `run_tests`, `create_mr`) and update all prompt template references.

### Non-breaking changes (automatic)

- **Logging** switches to human-readable text format — no action needed
- **Notifications** use the new emoji+agent+task format — no action needed
- **`stateDir`** is a new optional field — existing manifests work unchanged
- **`imports`** is a new optional field — existing manifests work unchanged
- **`earlyExit`** is a new optional field on steps — existing manifests work unchanged

### Recommended adoption order

1. **Fix step names** (if you have any with hyphens) — this is the only required migration
2. **Add `earlyExit`** to agents that sometimes have nothing to do — save model costs
3. **Add `stateDir`** to agents that track state across runs — replace hardcoded paths
4. **Add `imports`** if you have multi-agent workflows sharing directories

### Quick validation

```bash
# Validate all agents at once
for agent in agents/*/; do
  name=$(basename "$agent")
  echo "--- Validating $name ---"
  nightshift agent validate "$name"
done
```

---

## Appendix: Complete Manifest Example

Here's a complete manifest using all M002 features:

```yaml
name: gardener_v2
description: Implements reviewer-requested changes on existing MRs

model: claude-sonnet-4-6
timeout: 15m

stateDir: memory

imports:
  feedback_memory: "gardener-feedback/memory"

variables:
  repo_url: ""
  allowed_commands: "git, glab"

steps:
  - name: check_inbox
    prompt: prompts/check_inbox.md
    earlyExit:
      when:
        result: "NOTHING_TO_DO"
      reason: "No pending reviews"
    outputSchema:
      type: object
      properties:
        result:
          type: string
          enum: [FOUND_WORK, NOTHING_TO_DO]
        mr_url:
          type: string
          nullable: true
      required: [result]

  - name: analyze_feedback
    prompt: prompts/analyze_feedback.md
    model: claude-opus-4-6
    outputSchema:
      type: object
      properties:
        changes_needed:
          type: array
          items:
            type: object
            properties:
              file: { type: string }
              description: { type: string }
      required: [changes_needed]

  - name: implement_changes
    prompt: prompts/implement_changes.md
    model: claude-opus-4-6
    env:
      - GITLAB_TOKEN
    outputSchema:
      type: object
      properties:
        status:
          type: string
          enum: [IMPLEMENTED]
      required: [status]

  - name: verify
    prompt: prompts/verify.md
    retry:
      maxAttempts: 2
      retryFrom: implement_changes
    outputSchema:
      type: object
      properties:
        passed: { type: boolean }
        error_details: { type: string }
      required: [passed]

  - name: push_update
    prompt: prompts/push_update.md
    env:
      - GITLAB_TOKEN
    outputSchema:
      type: object
      properties:
        outcome:
          type: string
          enum: [PUSHED, FAILED]
      required: [outcome]
```

This agent:
- Has a persistent `memory/` directory (created automatically)
- Reads the `gardener-feedback` agent's memory directory via `{{feedback_memory}}`
- Exits early if `check_inbox` finds nothing to do (1 model call instead of 5)
- Gets a ⏭️ notification on skip, ✅ on success, ❌ on failure
- Uses snake_case step names throughout
