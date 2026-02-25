# Roadmap: Night-Shift Code Improvement Agent

## Overview

This milestone extends the existing night-shift daemon with two additions: a reusable Ntfy push notification platform feature wired into the orchestrator lifecycle, and a nightly code improvement agent that clones a GitLab repo, finds one focused improvement per day-of-week category, and creates a merge request. The phases follow a strict dependency order — config schema and NtfyClient first, orchestrator hooks second, agent prompt and security third, and the full git harness last — so each phase delivers value and validates the next.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Notification Foundation** - NtfyClient, config schema extension, per-task opt-in
- [x] **Phase 2: Orchestrator Hooks** - Wire start/end notifications into daemon lifecycle for all tasks (completed 2026-02-24)
- [x] **Phase 3: Agent Prompt and Security** - Prompt template, category rotation, credential isolation guards (completed 2026-02-25)
- [ ] **Phase 4: Git Harness and Logging** - Clone, branch, push, MR creation, local log, Confluence update

## Phase Details

### Phase 1: Notification Foundation
**Goal**: Any recurring task can send Ntfy push notifications via a simple opt-in config flag
**Depends on**: Nothing (first phase)
**Requirements**: NTFY-01, NTFY-02, NTFY-06, CONF-01, CONF-02
**Success Criteria** (what must be TRUE):
  1. A `ntfy` block can be added to nightshift.yaml with topic, optional token, and optional base_url — daemon starts without error with or without the block
  2. NtfyClient sends an HTTP POST to the configured topic and does not throw or crash the daemon if the POST fails
  3. A recurring task with `notify: true` in its config is recognised; a task without the field defaults to no notification
  4. A `code_agent` block with repo URL, Confluence page ID, and day-of-week category schedule can be added to nightshift.yaml and passes Zod validation
**Plans:** 2/2 plans complete

Plans:
- [x] 01-01-PLAN.md — Config schema extensions (ntfy, code_agent, notify opt-in)
- [x] 01-02-PLAN.md — NtfyClient class (fire-and-forget HTTP POST)

### Phase 2: Orchestrator Hooks
**Goal**: The daemon fires start and end notifications for any task that opts in, with distinct success, skip, and failure messages
**Depends on**: Phase 1
**Requirements**: NTFY-03, NTFY-04, NTFY-05, CONF-03
**Success Criteria** (what must be TRUE):
  1. A notification arrives on the Ntfy topic when the daemon dispatches a task that has `notify: true`, containing the task name and category
  2. A notification arrives when a task completes successfully, containing the MR link (or "no improvement found"), cost, and summary
  3. A notification with higher priority arrives when a task fails or is skipped, with a distinct message that distinguishes it from a success notification
  4. The daemon resolves today's improvement category from the code_agent day-of-week schedule and injects it into the task context
**Plans:** 2/2 plans complete

Plans:
- [ ] 02-01-PLAN.md — NightShiftTask type extension + category resolution (TDD)
- [ ] 02-02-PLAN.md — Orchestrator notification hooks (TDD)

### Phase 3: Agent Prompt and Security
**Goal**: The agent has a well-crafted, secure prompt that produces focused, reviewable improvements and explicitly skips when nothing meaningful is found
**Depends on**: Phase 2
**Requirements**: AGENT-05, AGENT-06, AGENT-07, AGENT-08, AGENT-09
**Success Criteria** (what must be TRUE):
  1. The agent outputs `NO_IMPROVEMENT` and creates no MR when no meaningful improvement is found for the day's category — confirmed against a scratch repo with no eligible changes
  2. The agent prompt includes an explicit injection mitigation preamble and category-specific skip criteria (minimum complexity thresholds)
  3. The GITLAB_TOKEN never appears in the agent prompt string, agent output, or any log — it is passed only as an environment variable
  4. The agent's allowedTools is restricted to the minimum set (Bash for git/glab, Read, Write) and cannot call arbitrary shell commands
**Plans:** 2/2 plans complete

Plans:
- [ ] 03-01-PLAN.md — Config schema extension + prompt loader + 4 bead prompt templates
- [ ] 03-02-PLAN.md — Code agent runner pipeline (bead-runner + 4-bead orchestration with retry and fallback)

### Phase 4: Git Harness and Logging
**Goal**: The agent clones a fresh repo, creates a branch, commits an improvement, pushes, and opens a merge request — with unconditional cleanup and a full run record in the local log and Confluence
**Depends on**: Phase 3
**Requirements**: AGENT-01, AGENT-02, AGENT-03, AGENT-04, LOG-01, LOG-02
**Success Criteria** (what must be TRUE):
  1. The agent clones the configured GitLab repo to a temp directory and the directory is removed unconditionally after the run, even if the agent crashes or times out
  2. The agent creates a feature branch with a unique name, commits the improvement, pushes the branch, and opens a MR via glab with a descriptive title and body
  3. A local log file is appended with a new entry per run containing date, category, MR URL or null, cost, duration, and agent summary
  4. The pre-existing Confluence page is updated with a new row for each run, appending to the existing page body without destroying previous entries
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Notification Foundation | 2/2 | Complete    | 2026-02-23 |
| 2. Orchestrator Hooks | 2/2 | Complete    | 2026-02-24 |
| 3. Agent Prompt and Security | 2/2 | Complete   | 2026-02-25 |
| 4. Git Harness and Logging | 0/? | Not started | - |
