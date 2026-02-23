# Feature Research

**Domain:** Notification-enabled autonomous code improvement daemon
**Researched:** 2026-02-23
**Confidence:** HIGH (for notification patterns), MEDIUM (for agent improvement UX), LOW (for some differentiator claims)

---

## Feature Landscape

### Table Stakes (Users Expect These)

These are features users assume exist in any notification-enabled automated agent system. Missing these makes the product feel incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Task-start notification | Any automated job sends a signal it began — confirms the cron fired and nothing was silently skipped | LOW | POST to ntfy.sh with task name, category, timestamp. Negligible implementation. |
| Task-end notification (success) | Users need to know work is ready to review in the morning — the entire value prop requires this signal | LOW | Include MR link, category, cost, brief summary. Key field: the MR URL as a clickable action. |
| Task-end notification (failure or skip) | Silent failures are worse than no automation — user must know if the agent found nothing or errored | LOW | "No improvement found" vs "agent errored" are distinct cases — both need distinct notifications. |
| Notification opt-in per task via config | Platform convention: not all tasks need notifications; coupling notifications to a specific task type is an anti-pattern | LOW | Add `notify: true/false` to `RecurringTaskSchema` in config.ts, with per-task topic override option. |
| MR link in completion notification | Developers check the notification, tap it, see the MR — without the link, the notification is noise | LOW | ntfy `X-Click` header carries the MR URL. The agent must surface the URL in its result output. |
| Distinct success vs failure notification priority | Failures should be higher priority (interrupt), successes can be low/default (informational) | LOW | Use ntfy priority 4 (high) for failure, priority 2 (low) for success — no noise on success. |
| Config-driven day-to-category mapping | Users want to control what the agent works on each day — without this, the agent is unpredictable | MEDIUM | Map weekday integer (0-6) to category string (tests, refactoring, docs, etc.) in nightshift.yaml. |
| Fresh repo clone per run | Any persistent checkout accumulates stale state, merge conflicts, and dirty working dirs — a fresh clone is the only reliable approach | MEDIUM | Clone to a temp dir, run the agent, clean up on exit (success or failure). |
| Agent creates branch + MR | The entire value prop is a ready-to-review MR in the morning — the agent must own the full git workflow | HIGH | `glab` CLI handles branch creation, push, MR creation. Agent receives glab invocations via allowed tools. |
| Zero-or-one MR constraint | Flooding the repo with half-baked MRs destroys trust in the automation — reviewers will turn it off | MEDIUM | Prompt engineering: agent is explicitly instructed to create an MR only if the improvement is meaningful and self-contained. |
| Confluence log update | Team visibility into what the agent did over time — without this, the automation is a black box | MEDIUM | Agent appends to a pre-existing Confluence page via MCP. The page ID comes from config. |
| Local log file | Safety net when Confluence is unavailable or the MCP call fails | LOW | Append a structured line per run to a local JSONL/Markdown file in the inbox directory. |

---

### Differentiators (Competitive Advantage)

Features that set this product apart from generic cron-based automation or basic notification scripts. Not required for the core to work, but meaningfully improve the experience.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Rich ntfy notification with category tag | Lets users filter/route notifications by improvement type on their phone (e.g. mute "docs" nights, never mute "security") | LOW | Use ntfy `X-Tags` with the category name. Tag maps to emoji on Android. |
| ntfy action button linking to MR | One-tap from notification to MR review — eliminates the friction of finding the link | LOW | ntfy `X-Actions: view, Review MR, https://gitlab.com/...` — only possible when MR was created. |
| Cost reporting in notification | Transparency builds trust — knowing each run costs $1.20 lets users tune budget caps confidently | LOW | `totalCostUsd` from `AgentExecutionResult` is already available — include in notification body. |
| Category rotation with override support | Lets users override a specific night (e.g. "force tests tonight") by editing config | LOW | Allow an optional `override_category` field in the code-improvement task config block. |
| Notification summary includes agent's own words | Instead of generic "improvement found," surface the first sentence of the agent's result — tells users what the improvement actually is | LOW | Parse first 150 chars of `AgentExecutionResult.result` for the notification body. |
| "No improvement found" as explicit signal, not silence | Distinguishes "ran and found nothing" from "failed" from "never ran" — three different states that all need distinct notifications | LOW | Agent returns a specific exit phrase when skipping. Orchestrator detects it and sends a distinct ntfy message. |
| Persistent run history in structured local log | JSONL format makes it easy to `jq` the log to see which categories produce the most MRs, what runs cost, etc. | LOW | One JSON line per run with: date, category, mrUrl (nullable), costUsd, durationMs, agentSummary. |
| Well-crafted system prompt for focused MRs | The quality of the MR is entirely determined by prompt quality — a poor prompt produces unfocused, large, or useless MRs | HIGH | Research shows AI MRs have 1.7x more defects than human ones when not carefully scoped. Investing in prompt quality is the highest-leverage differentiator. |
| Timeout handling with notification | If the agent times out, user gets a notification explaining what was being attempted — no silent hang | LOW | Orchestrator already tracks `timed-out` status. Extend notification hook to fire on timeout too. |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem useful but create problems that outweigh their value. Explicitly NOT building these.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Multiple MRs per night | "More improvements = more value" | Floods the review queue; each MR competes for reviewer attention; trust erodes quickly when volume overwhelms humans | Hard limit of one MR per run. Quality over quantity. |
| Agent-chosen category | "The agent knows what the code needs most" | Unpredictable; makes the schedule feel random; harder to explain to teammates; removes user control | Config-driven day-to-category mapping. User controls the schedule. |
| Persistent repo checkout between runs | "Faster startup; agent can see its own history" | Stale state, merge conflicts from main branch drift, dirty working dirs that confuse the agent | Fresh clone per run. Stateless by design. |
| Notification for every agent tool call | "Full observability" | Notification spam kills the value of notifications — users stop reading them entirely | Notify on start and end only. Logs capture the detail. |
| Real-time progress notifications mid-run | "I want to know if it's stuck" | ntfy.sh free tier rate limits; worse: creates false urgency for a background process; users can check daemon status via CLI | Single start notification. End notification carries all relevant info. |
| Interactive approval before MR creation | "I want to review before it's public" | Defeats the purpose of overnight automation; requires the user to be awake; turns async into sync | Fully autonomous. MR is the review artifact. User reviews the MR on GitLab at their convenience. |
| Custom MCP server config per improvement task | "Different categories need different tools" | Every task already inherits the user's Claude CLI MCP config; adding per-task MCP config creates maintenance burden and security surface | Use `--allowedTools` to scope which MCP tools the agent can use per category. |
| Database for run history | "Better querying than log files" | Adds operational complexity (migrations, backups, schema evolution) for a personal/team tool; overkill | JSONL local log + Confluence page. Both are human-readable and `jq`-queryable. |
| Auto-merge of agent MRs | "If CI passes, merge automatically" | AI-generated code has 1.7x more defects than human code (2025 research); auto-merge removes the human safety valve that justifies autonomous MR creation | Always require a human to merge. The MR is the review step, not an obstacle. |
| Multi-repo support | "I want to improve all my repos" | Scope creep; different repos have different contexts, standards, glab configs; hardcoded single-repo keeps the system predictable and debuggable | One repo, configured in nightshift.yaml. |

---

## Feature Dependencies

```
[Ntfy platform integration (config + HTTP client)]
    └──required by──> [Task-start notification]
    └──required by──> [Task-end notification (success/failure/skip/timeout)]
                          └──requires──> [Agent result parsing (MR URL extraction)]

[Config-driven day-to-category mapping]
    └──required by──> [Code improvement agent prompt construction]
                          └──required by──> [Fresh clone + branch + MR creation]
                                               └──required by──> [Confluence log update]
                                               └──required by──> [Local log file]

[MR URL available in agent result]
    └──enables──> [ntfy action button to MR] (enhances end notification)
    └──enables──> [MR link in Confluence log row]

[Agent result summary text]
    └──enables──> [Notification body with agent's own words] (enhances end notification)
    └──enables──> [Local log file entry]
```

### Dependency Notes

- **Ntfy integration requires config first:** The topic URL, optional token, and per-task opt-in must be in `nightshift.yaml` before any notification can fire. Ntfy config block is a prerequisite for all notification features.
- **MR URL extraction requires agent output parsing:** The agent's result text must contain the MR URL in a parseable location. Prompt must instruct the agent to output the URL on its own line or in a structured format.
- **Action button depends on MR URL availability:** The ntfy `X-Actions` view button can only be set if an MR was actually created. On skip/failure, the action button should be omitted.
- **Confluence update depends on MR outcome:** The log entry should record whether an MR was created, its URL, or that the run was skipped — requires parsing the agent result before calling Confluence MCP.
- **Category rotation is independent:** Day-to-category mapping does not depend on notifications — it feeds the prompt only. It can be built and tested without ntfy being in place.

---

## MVP Definition

### Launch With (v1)

Minimum to make the milestone useful and trustworthy.

- [ ] Ntfy config block in `nightshift.yaml` (`topic`, `token` optional, per-task `notify: true/false`) — without this, nothing else can be built
- [ ] HTTP client wrapper around ntfy.sh POST (reusable across all tasks) — platform feature, not task-specific
- [ ] Task-start notification with task name and category — confirms the cron fired
- [ ] Task-end notification (success) with MR link, category, cost, brief summary — the morning signal
- [ ] Task-end notification (failure/skip) with distinct message and high priority — required for trust
- [ ] Config-driven day-to-category mapping in nightshift.yaml — controls what runs each night
- [ ] Code improvement agent: fresh clone, find improvement, create branch + commit + MR via glab — the core value
- [ ] Zero-or-one MR constraint enforced via prompt — quality gate
- [ ] Local log file appended per run — safety net if Confluence is down

### Add After Validation (v1.x)

Add once core is working and run history shows the agent is producing quality MRs.

- [ ] Rich ntfy notification with category emoji tag — after confirming basic notifications work reliably
- [ ] ntfy action button linking to MR — add once MR URL extraction from agent output is confirmed reliable
- [ ] Confluence log update — add after local log is confirmed working; Confluence MCP adds external dependency
- [ ] Cost reporting in notification body — easy add-on once core notification is stable
- [ ] Notification on timeout — extend existing hook once the happy path is solid

### Future Consideration (v2+)

Defer until the tool has proven its value over weeks of real runs.

- [ ] Category override support in config — "force tests tonight" — only needed if users actually want to deviate from the weekly schedule
- [ ] Notification summary from agent's own words — requires reliable parsing; better done after studying real agent outputs
- [ ] Structured run analytics (success rate per category, avg cost, MR acceptance rate) — only meaningful after 20+ runs of data

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Ntfy config + HTTP client | HIGH | LOW | P1 |
| Task-start notification | MEDIUM | LOW | P1 |
| Task-end notification (success + fail) | HIGH | LOW | P1 |
| Day-to-category config mapping | HIGH | LOW | P1 |
| Fresh clone per run | HIGH | MEDIUM | P1 |
| Agent creates branch + MR via glab | HIGH | HIGH | P1 |
| Zero-or-one MR constraint (prompt) | HIGH | MEDIUM | P1 |
| Local log file | MEDIUM | LOW | P1 |
| Well-crafted system prompt | HIGH | HIGH | P1 |
| Confluence log update | MEDIUM | MEDIUM | P2 |
| ntfy action button (MR link) | MEDIUM | LOW | P2 |
| Rich tags + emoji in notification | LOW | LOW | P2 |
| Cost in notification body | LOW | LOW | P2 |
| Timeout notification | MEDIUM | LOW | P2 |
| Category override support | LOW | LOW | P3 |
| Notification body from agent text | LOW | MEDIUM | P3 |
| Run analytics / reporting | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for milestone launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

No direct competitors exist for this exact combination (personal daemon + ntfy + autonomous MR creation). Closest analogies are:

| Feature | Healthchecks.io / Cronitor (cron monitors) | CodeRabbit / Qodo (AI code review bots) | Our Approach |
|---------|---------------------------------------------|------------------------------------------|--------------|
| Task lifecycle notifications | Start + end ping, email/Slack on failure | PR comment on trigger, no proactive push | Ntfy push (mobile), start+end, actionable |
| Notification fatigue prevention | Alert deduplication, configurable thresholds | Comment batching | Low priority for success, high for failure |
| MR/PR creation | None (monitoring only) | Review comments on existing PRs | Fully autonomous: clone, branch, commit, push, MR |
| Category/scope control | None | Prompt in PR trigger | Config-driven day-to-category rotation |
| History/audit | Dashboard, 12-month retention | PR history | Local JSONL + Confluence page |
| Human-in-the-loop gate | None needed (monitoring) | Human triggers review | Human reviews and merges MR; never auto-merge |

---

## Sources

- ntfy.sh official docs (publish API, priorities, actions): https://docs.ntfy.sh/publish/ — HIGH confidence
- ntfy.sh integrations list: https://docs.ntfy.sh/integrations/ — HIGH confidence
- State of AI code quality 2025, Qodo: https://www.qodo.ai/reports/state-of-ai-code-quality/ — MEDIUM confidence (industry report)
- Best AI coding agents 2026, Faros AI: https://www.faros.ai/blog/best-ai-coding-agents-2026 — MEDIUM confidence (aggregated reviews)
- Cron job monitoring patterns 2026, Better Stack: https://betterstack.com/community/comparisons/cronjob-monitoring-tools/ — MEDIUM confidence
- Agent Experience best practices, marmelab: https://marmelab.com/blog/2026/01/21/agent-experience.html — MEDIUM confidence
- Enhancing code quality at scale with AI, Microsoft Engineering: https://devblogs.microsoft.com/engineering-at-microsoft/enhancing-code-quality-at-scale-with-ai-powered-code-reviews/ — HIGH confidence
- night-shift codebase (types.ts, config.ts, orchestrator.ts, agent-runner.ts): direct inspection — HIGH confidence

---

*Feature research for: notification-enabled autonomous code improvement daemon (night-shift milestone)*
*Researched: 2026-02-23*
