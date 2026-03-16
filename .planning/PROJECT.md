# Night-Shift Code Improvement Agent

## What This Is

A configurable nightly agent platform. Users define agents as directories (prompt files + manifest.yaml), compose sequential steps with typed inputs/outputs, add them to nightshift.yaml, and schedule them to run overnight. The built-in code-agent clones a GitLab repo, finds one small improvement per category rotation, and creates a merge request — but any agent can be built and shared the same way. The platform is fully E2E-tested with a mock harness covering daemon lifecycle, CLI, error scenarios, and external service boundaries.

## Core Value

Small, focused merge requests that appear in the morning — one coherent improvement per night, easy to review, never overwhelming.

## Requirements

### Validated

- ✓ Recurring task scheduling via cron expressions — v1.0
- ✓ Daemon with poll-based orchestration — v1.0
- ✓ Agent execution via `claude -p` with tool restrictions and budget caps — v1.0
- ✓ Inbox reports with YAML frontmatter — v1.0
- ✓ Config-driven `nightshift.yaml` with Zod validation — v1.0
- ✓ Graceful daemon lifecycle (start/stop/health) — v1.0
- ✓ CLI for submit, status, inbox, schedule — v1.0
- ✓ Ntfy push notifications as a platform feature (any task can opt in) — v1.0
- ✓ Notification on task start (task name, category) — v1.0
- ✓ Notification on task end (summary, MR link or "no improvement found") — v1.0
- ✓ Config-driven day-of-week to improvement category mapping in nightshift.yaml — v1.0
- ✓ Fresh clone of target GitLab repo per run (temp dir, cleaned up after) — v1.0
- ✓ Agent creates branch, commits improvement, pushes, creates MR via `glab` — v1.0
- ✓ Zero-or-one MR per run (skip if nothing meaningful found) — v1.0
- ✓ Category rotation: tests, refactoring, docs, and other categories — v1.0
- ✓ Update pre-existing Confluence page with running log of improvements — v1.0
- ✓ Local log file tracking past improvements — v1.0
- ✓ Well-crafted prompt that produces focused, reviewable MRs — v1.0
- ✓ Agents defined as directories with manifest.yaml and prompt files — v2.0
- ✓ Code-agent migrated from hardcoded to configured agent template — v2.0
- ✓ nightshift.yaml updated for generic agent references — v2.0
- ✓ Agents shareable as copyable directories — v2.0
- ✓ Generic AgentEngine drives any agent's step pipeline from manifest — v2.0
- ✓ Startup validation fails fast on broken agent manifests — v2.0
- ✓ CLI tooling: agent init, validate, list, show — v2.0
- ✓ Bead abstraction removed — AgentEngine executes steps inline — v3.0
- ✓ Human-readable ntfy notifications with task name, agent, duration, MR link — v3.0
- ✓ Codebase cleanup — dead code removed, error hierarchy collapsed, legacy remnants eliminated — v3.0
- ✓ Full E2E testing framework — daemon lifecycle, CLI, error scenarios, mocked externals — v3.0

### Active

(None — planning next milestone)

### Out of Scope

- Multiple MRs per night — one coherent improvement is the goal
- Multi-repo support — targets one specific repo, hardcoded in config
- Agent memory across runs beyond Confluence page + log file — no database
- Interactive review or approval before MR creation — fully autonomous
- Mobile app or web dashboard — Ntfy handles mobile notifications
- Offline mode — agent requires network for clone, push, and MR creation
- npm-publish agent packages — format needs to stabilize over 5+ real agents
- Docker/VM agent isolation — `allowedTools` + env allowlist sufficient for local tool
- GUI for building agent templates — engineers comfortable with YAML; `agent init` sufficient
- Agent-to-agent communication mid-pipeline — handoff files sufficient
- LLM-driven step ordering — non-deterministic ordering breaks manifest contract

## Context

Shipped v3.0 with 4,793 LOC TypeScript across 17 phases (v1.0 + v2.0 + v3.0) in 22 days total.
Tech stack: Node.js 22, TypeScript strict, ESM, Zod v4, vitest, Commander.
Agent execution via `claude -p` with `--allowedTools` restriction and `--dangerously-skip-permissions`.
GitLab operations via `glab` CLI (pre-authenticated). Confluence updates via MCP Atlassian tools.
Ntfy notifications via native `fetch` (zero new npm dependencies throughout all three milestones).

v3.0 consolidated the platform: bead abstraction eliminated (steps inline in AgentEngine), 8-class error hierarchy collapsed to single NightShiftError with code-based discrimination, dead code and legacy remnants removed, and a full 16-test E2E harness covering daemon lifecycle, CLI commands, error scenarios, and external service boundaries.

Known areas needing empirical validation after first real runs:
- Skip criteria thresholds in step prompts need tuning
- GIT_CONFIG_NOSYSTEM=1 credential blocking needs integration test on actual machine config
- Confluence macro-stripping workaround needs validation against real Confluence instance

## Constraints

- **Platform**: Node.js 20+, ESM throughout, TypeScript strict mode
- **Execution**: All agent work goes through `claude -p` — no direct API calls to Claude
- **Auth**: `glab` and Confluence MCP auth are pre-configured on the user's machine
- **Conventions**: Existing night-shift patterns (Zod config, atomic file writes, Commander CLI, structured logging)
- **MR size**: Each MR should be one coherent idea — reviewable in under 5 minutes

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Ntfy as platform feature, not prompt-baked | Reusable across all recurring tasks, cleaner separation | ✓ Good — clean opt-in via `notify: true` on any task |
| Fresh clone per run (not persistent checkout) | Avoids stale state, merge conflicts, dirty working dirs | ✓ Good — stateless by design, GIT_CONFIG_NOSYSTEM isolation |
| Config-driven category rotation (not agent-chosen) | Predictable, controllable, easy to adjust schedule | ✓ Good — resolveCategory frozen at dispatch time |
| Confluence page + local log for history | Visibility for team (Confluence) + safety net (local) | ✓ Good — JSONL append + MCP log bead |
| Zero-or-one MR per run | Quality over quantity — don't force improvements | ✓ Good — NO_IMPROVEMENT is a first-class result |
| Pre-existing Confluence page (agent doesn't create) | Simpler, avoids space/permission issues on first run | ✓ Good — page ID passed via config |
| Zero new npm dependencies | Keep dependency surface small, Node 22 covers fetch/AbortSignal | ✓ Good — entire project uses only built-in APIs |
| 4-step pipeline (analyze/implement/verify/mr) | Separation of concerns, structured handoff between stages | ✓ Good — retry and fallback operate at step level |
| GITLAB_TOKEN isolation (only MR step) | Belt-and-suspenders security, explicit env allowlist | ✓ Good — 4 dedicated tests verify invariant |
| buildStepEnv from allowlist (not process.env filter) | Cannot leak token even if deletion logic has a bug | ✓ Good — structurally safe |
| Agents as directories with manifest.yaml | Copyable, shareable, version-controllable agent definitions | ✓ Good — code-agent migrated successfully |
| Config schema hard break (not expand-and-contract) | Personal tool — clean break preferred over compat shim | ✓ Good — simpler config parsing |
| AgentEngine with zero agent-specific logic | Generic engine drives any manifest — code-agent is just data | ✓ Good — proven by code-agent migration |
| Startup validation before first poll tick | Fail fast at daemon start, not at 2am | ✓ Good — actionable errors on broken manifests |
| Per-step model/tools/env/timeout from manifest | Agents control their own execution parameters | ✓ Good — no engine defaults override agent intent |
| Inline step execution (no plugin system) | Bead abstraction added complexity without value — steps are simpler | ✓ Good — v3.0 removed BeadPlugin/Registry/Runner |
| Single NightShiftError with code field | 8-class hierarchy was over-engineered for a personal tool | ✓ Good — catch sites use err.code, simpler to reason about |
| NotificationService as injected dependency | Clean separation, testable, orchestrator doesn't know ntfy details | ✓ Good — pure-function formatters, mock-friendly |
| E2E via real daemon process (not in-process) | Tests prove the actual binary works, not just a simulated version | ✓ Good — 16 tests cover full lifecycle end-to-end |
| Mock Claude CLI via PATH shim | No network calls, deterministic responses, fast tests | ✓ Good — fixture response files control behavior |
| NTFY-04 (skip notification) dropped | No skip concept at platform level — user decision | — Accepted |

---
*Last updated: 2026-03-16 after v3.0 milestone*
