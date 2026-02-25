# Phase 4: Git Harness and Logging - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Clone a fresh GitLab repo, create a feature branch, commit the agent's improvement, push, and open a merge request — with unconditional temp directory cleanup. Log each run to a local JSONL file and update a pre-existing Confluence page with a new table row. Covers AGENT-01 through AGENT-04 and LOG-01 through LOG-02.

</domain>

<decisions>
## Implementation Decisions

### Local run log
- JSONL format: one JSON object per line in `.nightshift/logs/code-agent-runs.jsonl`
- Required fields only: date, category, mr_url (or null), cost_usd, duration_seconds, summary
- No rotation — one entry per day, file grows indefinitely (~365 lines/year)
- Written by the Node.js harness (not by an agent bead)

### Confluence page layout
- Table format with one row per run
- Newest-first ordering: new rows inserted at the top of the table
- Columns mirror the local log: Date | Category | MR Link | Cost | Duration | Summary
- Append-only: fetch current page body, insert row at top of table, push updated body

### Confluence update mechanism
- New 5th "log" bead in the pipeline: analyze → implement → verify → mr → log
- The log bead uses the locally configured MCP Atlassian tools (no custom Confluence API client)
- Runs after MR bead regardless of outcome (records NO_IMPROVEMENT runs too)

### Claude's Discretion
- Branch naming convention and commit message format
- MR title/body template content
- Clone depth (shallow vs full)
- Error recovery strategy for partial failures (e.g., push succeeds but MR creation fails)
- Log bead prompt content and MCP tool usage details
- Temp directory location and cleanup implementation

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for the git mechanics and MR formatting.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-git-harness-and-logging*
*Context gathered: 2026-02-25*
