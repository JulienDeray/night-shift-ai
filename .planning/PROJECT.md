# Night-Shift Code Improvement Agent

## What This Is

An extension of the night-shift framework that ships push notifications (Ntfy) as a reusable platform feature and a nightly code improvement agent. The agent clones a specific GitLab repo each night, finds one small, reviewable improvement (tests, refactoring, docs, etc.) based on a config-driven category rotation, creates a merge request via `glab` CLI, and logs results to both a local JSONL file and a Confluence page via MCP.

## Core Value

Small, focused merge requests that appear in the morning — one coherent improvement per night, easy to review, never overwhelming.

## Requirements

### Validated

- ✓ Recurring task scheduling via cron expressions — existing
- ✓ Daemon with poll-based orchestration — existing
- ✓ Agent execution via `claude -p` with tool restrictions and budget caps — existing
- ✓ Inbox reports with YAML frontmatter — existing
- ✓ Config-driven `nightshift.yaml` with Zod validation — existing
- ✓ Beads integration for task tracking with file-queue fallback — existing
- ✓ Graceful daemon lifecycle (start/stop/health) — existing
- ✓ CLI for submit, status, inbox, schedule — existing
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

### Active

(No active requirements — next milestone not yet planned)

### Out of Scope

- Multiple MRs per night — one coherent improvement is the goal
- Multi-repo support — targets one specific repo, hardcoded in config
- Agent memory across runs beyond Confluence page + log file — no database
- Interactive review or approval before MR creation — fully autonomous
- Mobile app or web dashboard — Ntfy handles mobile notifications
- Offline mode — agent requires network for clone, push, and MR creation

## Context

Shipped v1.0 with 9,068 LOC TypeScript across 4 phases in 3 days.
Tech stack: Node.js 22, TypeScript strict, ESM, Zod v4, vitest, Commander.
Agent execution via `claude -p` with `--allowedTools` restriction and `--dangerously-skip-permissions`.
GitLab operations via `glab` CLI (pre-authenticated). Confluence updates via MCP Atlassian tools.
Ntfy notifications via native `fetch` (zero new npm dependencies throughout milestone).

Known areas needing empirical validation after first real runs:
- Skip criteria thresholds in bead prompts need tuning
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
| Zero new npm dependencies | Keep dependency surface small, Node 22 covers fetch/AbortSignal | ✓ Good — entire milestone used only built-in APIs |
| 4-bead pipeline (analyze/implement/verify/mr) | Separation of concerns, structured handoff between stages | ✓ Good — retry and fallback operate at bead level |
| GITLAB_TOKEN isolation (only MR bead) | Belt-and-suspenders security, explicit env allowlist | ✓ Good — 4 dedicated tests verify invariant |
| buildBeadEnv from allowlist (not process.env filter) | Cannot leak token even if deletion logic has a bug | ✓ Good — structurally safe |

---
*Last updated: 2026-02-25 after v1.0 milestone*
