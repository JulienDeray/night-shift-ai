# Phase 1: Notification Foundation - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Config schema extensions (ntfy block, code_agent block, per-task notify opt-in) and a reusable NtfyClient class. This phase delivers the plumbing — Phase 2 wires it into the daemon lifecycle, Phase 3 builds the agent prompt, Phase 4 builds the git harness.

</domain>

<decisions>
## Implementation Decisions

### Category schedule design
- Weekdays only (Monday–Friday) — no weekend runs
- Day names as YAML keys under `category_schedule`
- Each day maps to an array of categories (always array, even for one): `monday: [tests]`
- Free-form category strings (not a fixed enum) — allows easy extension without schema changes
- Default weekday categories: tests, refactoring, docs, error_handling, cleanup
- If multiple categories listed for a day, the agent picks the best fit from the list
- Day names validated by Zod — typos like "munday" cause a config error
- snake_case for all YAML keys within code_agent block (matches existing config convention)

### Notification message shape
- NtfyClient exposes full Ntfy fields: title, body, priority, tags, actions
- Uses Ntfy's JSON publish API (POST with JSON body), not the headers-based API
- Token-only authentication (Bearer token), no username/password support
- Token field is optional in config — ntfy topics can be public
- Token read directly from YAML config (not environment variable)
- Topic is just the name (e.g. "night-shift"), not the full URL — client assembles URL from base_url + topic
- Default base_url is https://ntfy.sh (user uses public ntfy.sh)
- 5-second HTTP timeout on the POST request
- On failure (network error, 4xx, 5xx): log at warn level and move on — never throw, never retry

### Config layering
- `ntfy` and `code_agent` blocks are top-level siblings in nightshift.yaml (alongside workspace, daemon, recurring, etc.)
- Both blocks are fully optional — daemon starts fine without either
- `ntfy` and `code_agent` are independent — code_agent can exist without ntfy (logging still works via Confluence/local file)
- If a task has `notify: true` but no ntfy block is configured: log warning at startup, don't fail
- `getDefaultConfigYaml()` (used by `nightshift init`) includes commented-out examples for both ntfy and code_agent blocks
- `repo_url` validated by Zod regex — must match SSH git URL pattern (git@host:org/repo.git)
- `confluence_page_id` is required (not optional), validated as non-empty string
- Day names in `category_schedule` validated against the 7 valid day names

### Claude's Discretion
- NtfyClient design: class with constructor vs stateless function — pick based on how the orchestrator will use it in Phase 2
- What happens when the agent runs on a day with no category assigned (e.g. Saturday trigger) — pick the most sensible edge-case behavior

</decisions>

<specifics>
## Specific Ideas

- SSH-only for repo URL — no HTTPS URLs accepted
- Categories: tests, refactoring, docs, error_handling, cleanup (one per weekday by default)
- Example config shape:
  ```yaml
  ntfy:
    topic: night-shift
    token: tk_abc123        # optional
    base_url: https://ntfy.sh  # optional, defaults to ntfy.sh

  code_agent:
    repo_url: git@gitlab.com:team/repo.git
    confluence_page_id: "123456"
    category_schedule:
      monday: [tests]
      tuesday: [refactoring]
      wednesday: [docs]
      thursday: [error_handling]
      friday: [cleanup]
  ```

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-notification-foundation*
*Context gathered: 2026-02-23*
