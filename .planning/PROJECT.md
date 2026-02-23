# Night-Shift Code Improvement Agent

## What This Is

An extension of the night-shift framework that adds push notifications (Ntfy) as a platform feature and ships a nightly code improvement agent. The agent clones a specific GitLab repo each night, finds one small, reviewable improvement (tests, refactoring, docs, etc.) based on a config-driven category rotation, and creates a merge request via `glab` CLI. Results are logged to a Confluence page and a local file.

## Core Value

Small, focused merge requests that appear in the morning — one coherent improvement per night, easy to review, never overwhelming.

## Requirements

### Validated

<!-- Existing capabilities from the night-shift codebase -->

- ✓ Recurring task scheduling via cron expressions — existing
- ✓ Daemon with poll-based orchestration — existing
- ✓ Agent execution via `claude -p` with tool restrictions and budget caps — existing
- ✓ Inbox reports with YAML frontmatter — existing
- ✓ Config-driven `nightshift.yaml` with Zod validation — existing
- ✓ Beads integration for task tracking with file-queue fallback — existing
- ✓ Graceful daemon lifecycle (start/stop/health) — existing
- ✓ CLI for submit, status, inbox, schedule — existing

### Active

- [ ] Ntfy push notifications as a platform feature (any task can opt in)
- [ ] Notification on task start (task name, category)
- [ ] Notification on task end (summary, MR link or "no improvement found")
- [ ] Config-driven day-of-week to improvement category mapping in nightshift.yaml
- [ ] Fresh clone of target GitLab repo per run (temp dir, cleaned up after)
- [ ] Agent creates branch, commits improvement, pushes, creates MR via `glab`
- [ ] Zero-or-one MR per run (skip if nothing meaningful found)
- [ ] Category rotation: tests, refactoring, docs, and other categories
- [ ] Update pre-existing Confluence page with running log of improvements
- [ ] Local log file tracking past improvements
- [ ] Well-crafted prompt that produces focused, reviewable MRs

### Out of Scope

- Multiple MRs per night — one coherent improvement is the goal
- Multi-repo support — targets one specific repo, hardcoded in config
- Agent memory across runs beyond Confluence page + log file — no database
- Interactive review or approval before MR creation — fully autonomous
- Custom MCP server config per task — uses inherited Claude CLI config
- Mobile app or web dashboard — Ntfy handles mobile notifications

## Context

- Night-shift is an existing local-first framework for autonomous AI agent tasks
- The agent will use `glab` CLI (already installed and authenticated) for GitLab operations
- Confluence MCP tools are available in the user's Claude CLI config for page updates
- The target Confluence page will be pre-created; the agent receives its ID via config
- The agent runs as a `claude -p` process with `--dangerously-skip-permissions` — safety comes from `--allowedTools`
- Ntfy is a simple HTTP-based push notification service (POST to `https://ntfy.sh/<topic>`)

## Constraints

- **Platform**: Node.js 20+, ESM throughout, TypeScript strict mode
- **Execution**: All agent work goes through `claude -p` — no direct API calls to Claude
- **Auth**: `glab` and Confluence MCP auth are pre-configured on the user's machine
- **Conventions**: Existing night-shift patterns (Zod config, atomic file writes, Commander CLI, structured logging)
- **MR size**: Each MR should be one coherent idea — reviewable in under 5 minutes

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Ntfy as platform feature, not prompt-baked | Reusable across all recurring tasks, cleaner separation | — Pending |
| Fresh clone per run (not persistent checkout) | Avoids stale state, merge conflicts, dirty working dirs | — Pending |
| Config-driven category rotation (not agent-chosen) | Predictable, controllable, easy to adjust schedule | — Pending |
| Confluence page + local log for history | Visibility for team (Confluence) + safety net (local) | — Pending |
| Zero-or-one MR per run | Quality over quantity — don't force improvements | — Pending |
| Pre-existing Confluence page (agent doesn't create) | Simpler, avoids space/permission issues on first run | — Pending |

---
*Last updated: 2026-02-23 after initialization*
