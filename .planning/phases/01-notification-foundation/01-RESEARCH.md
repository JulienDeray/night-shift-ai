# Phase 1: Notification Foundation - Research

**Researched:** 2026-02-23
**Domain:** TypeScript config schema extension (Zod v4) + HTTP client (native fetch) for ntfy push notifications
**Confidence:** HIGH

## Summary

Phase 1 adds three self-contained concerns to an existing, well-structured TypeScript codebase: (1) extend the Zod config schema with two new optional top-level blocks (`ntfy` and `code_agent`), plus a `notify` field on each recurring task; (2) create a `NtfyClient` class that fires-and-forgets HTTP POST requests to ntfy; (3) update `NightShiftConfig` and `getDefaultConfigYaml()` to reflect the new schema.

The codebase already establishes the exact patterns to follow: Zod schemas live in `src/core/config.ts`, TypeScript interfaces live in `src/core/types.ts`, the YAML-to-camelCase mapping is handled by `mapConfig()`, and tests for config parsing live in `tests/unit/config.test.ts`. No new npm dependencies are needed — `zod` (v4.3.6), native `fetch` (Node 22), and `AbortSignal.timeout()` cover everything.

The main technical decision is where to place `NtfyClient`. Because the orchestrator will call it in Phase 2 (it already has a similar optional-client pattern with `BeadsClient`), a class in `src/notifications/ntfy-client.ts` mirrors that pattern cleanly. The category-schedule schema requires using a strict `z.object` with all seven days as optional fields — `z.record(z.enum(...), ...)` in Zod v4 requires ALL enum keys to be present (verified experimentally), which makes the strict-object approach mandatory.

**Primary recommendation:** Follow the `BeadsClient` pattern for `NtfyClient` (class, constructor takes config, single `send()` method). Place schemas, types, and mappers in the three existing core files. Use `AbortSignal.timeout(5000)` for the 5-second timeout — no custom abort logic needed.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Category schedule design
- Weekdays only (Monday–Friday) — no weekend runs
- Day names as YAML keys under `category_schedule`
- Each day maps to an array of categories (always array, even for one): `monday: [tests]`
- Free-form category strings (not a fixed enum) — allows easy extension without schema changes
- Default weekday categories: tests, refactoring, docs, error_handling, cleanup
- If multiple categories listed for a day, the agent picks the best fit from the list
- Day names validated by Zod — typos like "munday" cause a config error
- snake_case for all YAML keys within code_agent block (matches existing config convention)

#### Notification message shape
- NtfyClient exposes full Ntfy fields: title, body, priority, tags, actions
- Uses Ntfy's JSON publish API (POST with JSON body), not the headers-based API
- Token-only authentication (Bearer token), no username/password support
- Token field is optional in config — ntfy topics can be public
- Token read directly from YAML config (not environment variable)
- Topic is just the name (e.g. "night-shift"), not the full URL — client assembles URL from base_url + topic
- Default base_url is https://ntfy.sh (user uses public ntfy.sh)
- 5-second HTTP timeout on the POST request
- On failure (network error, 4xx, 5xx): log at warn level and move on — never throw, never retry

#### Config layering
- `ntfy` and `code_agent` blocks are top-level siblings in nightshift.yaml (alongside workspace, daemon, recurring, etc.)
- Both blocks are fully optional — daemon starts fine without either
- `ntfy` and `code_agent` are independent — code_agent can exist without ntfy
- If a task has `notify: true` but no ntfy block is configured: log warning at startup, don't fail
- `getDefaultConfigYaml()` (used by `nightshift init`) includes commented-out examples for both ntfy and code_agent blocks
- `repo_url` validated by Zod regex — must match SSH git URL pattern (git@host:org/repo.git)
- `confluence_page_id` is required (not optional), validated as non-empty string
- Day names in `category_schedule` validated against the 7 valid day names

### Claude's Discretion
- NtfyClient design: class with constructor vs stateless function — pick based on how the orchestrator will use it in Phase 2
- What happens when the agent runs on a day with no category assigned (e.g. Saturday trigger) — pick the most sensible edge-case behavior

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NTFY-01 | Ntfy config block in nightshift.yaml with topic URL, optional auth token, and optional base_url override | Zod `z.object().optional()` pattern verified; `base_url` defaults to `https://ntfy.sh` |
| NTFY-02 | Reusable NtfyClient class that sends HTTP POST notifications (fire-and-forget, never blocks daemon) | Native `fetch` + `AbortSignal.timeout(5000)` + `void` return pattern. Never throws. |
| NTFY-06 | Per-task `notify: true/false` opt-in in recurring task config | `z.boolean().optional()` on `RecurringTaskSchema`; maps to `notify?: boolean` on `RecurringTaskConfig` |
| CONF-01 | `code_agent` config block in nightshift.yaml with target repo URL, Confluence page ID, and category schedule | Strict `z.object()` for days, SSH regex for repo_url, non-empty string for confluence_page_id |
| CONF-02 | Day-of-week to improvement category mapping (e.g. monday: tests, tuesday: refactoring) | Strict Zod object with all 7 days as optional array fields; `.strict()` rejects typos like "munday" |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.3.6 (installed) | Config schema validation | Already used project-wide; all schema patterns follow existing `config.ts` conventions |
| native fetch | Node 22 built-in | HTTP POST to ntfy API | Project decision: zero new npm deps; `AbortSignal.timeout()` handles the 5-second timeout cleanly |
| yaml | 2.8.0 (installed) | YAML parsing | Already used in `loadConfig()` |
| typescript | 5.7.0 (installed) | Type definitions | All new interfaces go into `src/core/types.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 3.1.0 (installed) | Unit tests | All new code tested in `tests/unit/` following existing test patterns |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| native fetch | node-fetch / axios | Not needed — Node 22 built-in fetch is stable and available |
| AbortSignal.timeout() | manual AbortController + setTimeout | More verbose, no benefit in Node 22 |
| z.object().strict() for days | z.record(z.enum(...), ...) | `z.record` with enum key in Zod v4 requires ALL enum keys present (verified); strict object with optional fields is correct |

**Installation:** No new dependencies required.

---

## Architecture Patterns

### Existing Project Structure (relevant files)
```
src/
├── core/
│   ├── config.ts        # Zod schemas + loadConfig + getDefaultConfigYaml
│   ├── types.ts         # TypeScript interfaces (NightShiftConfig, RecurringTaskConfig, etc.)
│   ├── errors.ts        # Custom error classes
│   ├── logger.ts        # Logger class (warn/info/error methods)
│   └── paths.ts         # Path resolution helpers
├── daemon/
│   ├── orchestrator.ts  # Main daemon: holds config, beads, logger — Phase 2 calls NtfyClient here
│   └── scheduler.ts     # Recurring task evaluation
├── beads/
│   └── client.ts        # BeadsClient — model for NtfyClient design
└── notifications/       # NEW: create this directory
    └── ntfy-client.ts   # NEW: NtfyClient class

tests/
├── unit/
│   ├── config.test.ts   # Model for new config tests
│   └── ntfy-client.test.ts  # NEW: NtfyClient unit tests
```

### Pattern 1: Optional Top-Level Config Block (Zod v4)

**What:** A top-level YAML block that is fully optional — daemon starts fine when absent.
**When to use:** `ntfy` and `code_agent` blocks in Phase 1.

```typescript
// Source: verified in Node 22 + zod 4.3.6
const NtfyConfigSchema = z.object({
  topic: z.string().min(1),
  token: z.string().optional(),
  base_url: z.string().default("https://ntfy.sh"),
}).optional();

// Result when absent: undefined (not null, not default object)
// Result when present without base_url: { topic: "night-shift", base_url: "https://ntfy.sh" }
```

### Pattern 2: Category Schedule Schema (Zod v4 — strict object required)

**What:** Validates day-of-week keys with free-form category arrays; rejects typos.
**When to use:** `code_agent.category_schedule` in CONF-01/CONF-02.

**Critical finding:** `z.record(z.enum([...dayNames]), z.array(...))` in Zod v4 requires ALL enum keys to be present (verified experimentally — `{monday: ['tests']}` fails because tuesday through sunday are missing). Use `z.object` with all days optional + `.strict()` instead:

```typescript
// Source: verified in Node 22 + zod 4.3.6
const CategoryScheduleSchema = z.object({
  monday:    z.array(z.string().min(1)).optional(),
  tuesday:   z.array(z.string().min(1)).optional(),
  wednesday: z.array(z.string().min(1)).optional(),
  thursday:  z.array(z.string().min(1)).optional(),
  friday:    z.array(z.string().min(1)).optional(),
  saturday:  z.array(z.string().min(1)).optional(),
  sunday:    z.array(z.string().min(1)).optional(),
}).strict();
// .strict() rejects unknown keys ("munday") with "Unrecognized key: munday"
```

### Pattern 3: SSH Git URL Regex Validation

```typescript
// Source: verified in Node 22 + zod 4.3.6
const CodeAgentSchema = z.object({
  repo_url: z.string().regex(
    /^git@[a-zA-Z0-9._-]+:[a-zA-Z0-9._\/-]+\.git$/,
    "repo_url must be an SSH git URL (git@host:org/repo.git)"
  ),
  confluence_page_id: z.string().min(1),
  category_schedule: CategoryScheduleSchema,
}).optional();
```

### Pattern 4: NtfyClient (class, fire-and-forget)

**What:** Mirrors `BeadsClient` — class with config in constructor, single method returning `Promise<void>`, never throws.
**When to use:** Orchestrator holds instance in `Phase 2`; Phase 1 just implements the class.

```typescript
// Source: ntfy JSON publish API (https://docs.ntfy.sh/publish/) + Node 22 native fetch
export interface NtfyMessage {
  title?: string;
  body?: string;        // maps to ntfy "message" field
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  actions?: NtfyAction[];
}

export class NtfyClient {
  private readonly url: string;
  private readonly token?: string;

  constructor(config: NtfyConfig) {
    // Assemble URL: base_url + "/" + topic
    this.url = `${config.baseUrl}/${config.topic}`;
    this.token = config.token;
  }

  async send(message: NtfyMessage, logger: Logger): Promise<void> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }

      const response = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: message.title,
          message: message.body,
          priority: message.priority,
          tags: message.tags,
          actions: message.actions,
        }),
        signal: AbortSignal.timeout(5000),  // 5-second timeout
      });

      if (!response.ok) {
        logger.warn("Ntfy notification failed", {
          status: response.status,
          url: this.url,
        });
      }
    } catch (err) {
      // Network error, timeout, etc. — log and move on
      logger.warn("Ntfy notification error", {
        error: err instanceof Error ? err.message : String(err),
        url: this.url,
      });
    }
  }
}
```

### Pattern 5: YAML-to-camelCase Mapping (existing convention)

```typescript
// Pattern from mapConfig() in src/core/config.ts
// YAML: snake_case keys → TypeScript: camelCase properties
// base_url → baseUrl
// repo_url → repoUrl
// confluence_page_id → confluencePageId
// category_schedule → categorySchedule
// notify (boolean) → notify (boolean, no rename needed)
```

### Pattern 6: Startup Warning for Misconfigured notify: true

```typescript
// In Orchestrator.start() — after loading config:
const hasNotifyTasks = this.config.recurring.some(r => r.notify);
if (hasNotifyTasks && !this.config.ntfy) {
  this.logger.warn(
    "Some recurring tasks have notify: true but no ntfy block is configured — notifications will be skipped"
  );
}
```

### Pattern 7: getDefaultConfigYaml() Extension

```typescript
// Add after the recurring block example, before one_off_defaults:
// # ntfy:
// #   topic: night-shift
// #   token: tk_abc123        # optional
// #   base_url: https://ntfy.sh  # optional, defaults to ntfy.sh
//
// # code_agent:
// #   repo_url: git@gitlab.com:team/repo.git
// #   confluence_page_id: "123456"
// #   category_schedule:
// #     monday: [tests]
// #     tuesday: [refactoring]
// #     wednesday: [docs]
// #     thursday: [error_handling]
// #     friday: [cleanup]
```

### Anti-Patterns to Avoid

- **Throwing in NtfyClient.send():** Decision is explicit: catch all errors, log at warn, return void. Never propagate.
- **Using z.record() with z.enum() key for partial maps:** In Zod v4, this validates presence of ALL enum keys — use `z.object(...all days optional...).strict()` instead.
- **Adding ntfy/code_agent to NightShiftConfig without marking optional:** Both fields must be `?: NtfyConfig` and `?: CodeAgentConfig` to allow daemon startup without either block.
- **Putting NtfyMessage.body as "body" in the fetch payload:** The ntfy JSON API uses `"message"` as the field name for the notification body, not `"body"`.
- **Using a module-level `fetch` import:** Node 22 has `fetch` as a global — no import needed.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP timeout | Manual AbortController + setTimeout logic | `AbortSignal.timeout(5000)` | One-liner, handles cleanup automatically, Node 18+ |
| YAML day-key validation | String split + includes check at runtime | Zod `.strict()` on object schema | Validated at config load time, error message includes the bad key |
| Auth header formatting | Custom string concatenation | Standard `Authorization: Bearer ${token}` header | Already the ntfy standard per official docs |

**Key insight:** The ntfy client is genuinely simple — the risk is over-engineering it. Keep `send()` as a single `fetch` call with no retry logic, no queue, no exponential backoff.

---

## Common Pitfalls

### Pitfall 1: z.record with Enum Key Requires All Keys (Zod v4)
**What goes wrong:** `z.record(z.enum(['monday','tuesday',...]), z.array(z.string()))` fails validation when only `monday` is present because Zod v4 treats this as a full record schema requiring all enum keys.
**Why it happens:** Zod v4 changed how enum keys work in `z.record` — it validates as an exhaustive record.
**How to avoid:** Use `z.object({ monday: ..., tuesday: ..., ... }).strict()` with all days as `.optional()`.
**Warning signs:** Validation failure saying "Invalid input: expected array, received undefined" for days not present in the YAML.

### Pitfall 2: Ntfy JSON Body Field Name
**What goes wrong:** Sending `{ body: "message text" }` — ntfy ignores it, notification shows no body.
**Why it happens:** The ntfy JSON API uses `message` as the field for the notification body text, not `body`.
**How to avoid:** Map `NtfyMessage.body` → `message` in the JSON payload. The interface uses `body` for clarity, but the wire format uses `message`.
**Warning signs:** Notification arrives with empty body on mobile.

### Pitfall 3: AbortError vs TimeoutError on Fetch Abort
**What goes wrong:** Catching only `Error` without handling `AbortError` separately, causing misleading log messages.
**Why it happens:** `AbortSignal.timeout()` throws a `DOMException` with `name === 'TimeoutError'` (not `AbortError`) on timeout. Network failures throw `TypeError`.
**How to avoid:** The catch-all `err instanceof Error ? err.message : String(err)` pattern already used throughout the codebase handles both correctly.
**Warning signs:** Not an issue with the current approach — the generic catch is intentional.

### Pitfall 4: NtfyConfig Optional vs CodeAgentConfig Required Fields
**What goes wrong:** Making `confluence_page_id` optional in the Zod schema.
**Why it happens:** Decision states it is required (non-empty string). Easy to accidentally add `.optional()`.
**How to avoid:** `confluence_page_id: z.string().min(1)` — no `.optional()`.
**Warning signs:** Config validates but `confluencePageId` is `undefined` at runtime in Phase 4.

### Pitfall 5: mapConfig() Incomplete Mapping
**What goes wrong:** Adding fields to the Zod schema but forgetting to map them in `mapConfig()`, leaving them out of `NightShiftConfig`.
**Why it happens:** `mapConfig()` is a manual mapping function — adding schema fields does not automatically propagate.
**How to avoid:** For each new Zod schema field, add corresponding interface field to `types.ts` AND map it in `mapConfig()`.
**Warning signs:** TypeScript compiler catches this if `NightShiftConfig` has required fields not set in `mapConfig()`.

---

## Code Examples

Verified patterns from official sources and existing codebase:

### Ntfy JSON Publish API
```typescript
// Source: https://docs.ntfy.sh/publish/
// POST to base_url/topic (assembled by client)
// Response 200 = success, 4xx/5xx = failure (log warn, don't throw)
// Authentication: Authorization: Bearer <token> header
const response = await fetch("https://ntfy.sh/night-shift", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer tk_abc123",  // only if token configured
  },
  body: JSON.stringify({
    title: "Night-shift completed",
    message: "Code agent finished — see MR for details",
    priority: 3,
    tags: ["white_check_mark"],
  }),
  signal: AbortSignal.timeout(5000),
});
// response.ok = status 200-299
// response.status 401 = bad token, 429 = rate limit, 403 = unauthorized topic
```

### Adding Optional Block to Existing ConfigSchema
```typescript
// Source: existing src/core/config.ts pattern, extended for ntfy
const ConfigSchema = z.object({
  // ... existing fields ...
  ntfy: z.object({
    topic: z.string().min(1),
    token: z.string().optional(),
    base_url: z.string().default("https://ntfy.sh"),
  }).optional(),
  code_agent: z.object({
    repo_url: z.string().regex(/^git@[a-zA-Z0-9._-]+:[a-zA-Z0-9._\/-]+\.git$/),
    confluence_page_id: z.string().min(1),
    category_schedule: z.object({
      monday:    z.array(z.string().min(1)).optional(),
      tuesday:   z.array(z.string().min(1)).optional(),
      wednesday: z.array(z.string().min(1)).optional(),
      thursday:  z.array(z.string().min(1)).optional(),
      friday:    z.array(z.string().min(1)).optional(),
      saturday:  z.array(z.string().min(1)).optional(),
      sunday:    z.array(z.string().min(1)).optional(),
    }).strict(),
  }).optional(),
  recurring: z.array(
    z.object({
      // ... existing fields ...
      notify: z.boolean().optional(),  // ADD THIS
    })
  ).default([]),
});
```

### NtfyClient Claude's Discretion Resolution
The user left NtfyClient design to Claude's discretion. **Recommendation: class with constructor.** Rationale:
- Orchestrator already uses the class+constructor pattern for `BeadsClient` (`private beads: BeadsClient | null = null`)
- A class allows storing assembled URL and token once at startup instead of per-call
- Phase 2 will hold `private ntfy: NtfyClient | null = null` in the Orchestrator, mirroring `this.beads`
- A stateless function would require passing config on every call — inconsistent with BeadsClient pattern

### Edge Case: Agent Runs on Day with No Category Assigned
The user left this to Claude's discretion. **Recommendation: return `undefined` from a `getCategoryForToday()` helper; caller logs and skips the agent run.** Rationale:
- Saturday/Sunday are valid days to have no category (decisions say "weekdays only" for default)
- Skipping is safer than picking an arbitrary category
- Caller in Phase 3 decides how to handle: log info "no category scheduled for today, skipping code_agent run"
- This is out of scope for Phase 1 but the `CategoryScheduleConfig` type should model it as `Record<DayName, string[] | undefined>`

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| node-fetch for HTTP | Native `fetch` global | Node 18+ | No npm dep needed |
| Manual timeout with AbortController + setTimeout | `AbortSignal.timeout(ms)` | Node 17.3+ | Single-line 5-second timeout |
| `z.record(z.enum(...), ...)` for partial maps | `z.object({...optionals}).strict()` | Zod v4 (breaking change) | Must use object pattern — record with enum key requires all keys |

**Deprecated/outdated:**
- `node-fetch`: No longer needed in Node 22 — built-in fetch is stable
- `z.record(z.enum([...]), ...)` for sparse maps: Works in Zod v3 but changed semantics in v4

---

## Open Questions

1. **NtfyClient.send() signature — should `logger` be injected per-call or held in constructor?**
   - What we know: Logger is instantiated async in Orchestrator (`Logger.createDaemonLogger()`) after construction
   - What's unclear: Whether NtfyClient is constructed before or after the logger in Phase 2
   - Recommendation: Pass logger per-call to `send(logger, message)` — avoids the ordering dependency. Consistent with how BeadsClient operations don't hold a logger (errors are caught by the caller in orchestrator.ts).

2. **Should `NtfyConfig` be a top-level named export from `types.ts` or defined inline in `config.ts`?**
   - What we know: `BeadsConfig`, `DaemonConfig`, `RecurringTaskConfig` are all in `types.ts`
   - Recommendation: Put `NtfyConfig`, `CodeAgentConfig`, `CategoryScheduleConfig` in `types.ts` to match the convention.

---

## Sources

### Primary (HIGH confidence)
- Zod 4.3.6 installed in project — `z.record` behavior with enum key verified experimentally in Node 22
- Node 22.19.0 (project runtime) — `fetch`, `AbortController`, `AbortSignal.timeout` verified present
- `src/core/config.ts` — existing schema pattern, `mapConfig()` convention, `getDefaultConfigYaml()` structure
- `src/core/types.ts` — existing interface conventions and naming patterns
- `src/daemon/orchestrator.ts` — BeadsClient optional-client pattern, logger usage
- `tests/unit/config.test.ts` — test structure and patterns for config unit tests

### Secondary (MEDIUM confidence)
- https://docs.ntfy.sh/publish/ — official ntfy JSON API documentation (field names, authentication, status codes)

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already installed; versions confirmed from `node_modules`
- Architecture: HIGH — patterns copied directly from existing source files in the same codebase
- Pitfalls: HIGH — Zod v4 `z.record` behavior verified experimentally; ntfy field names from official docs
- Zod v4 behavior: HIGH — verified in-process with installed version

**Research date:** 2026-02-23
**Valid until:** 2026-05-23 (Zod v4 is stable; ntfy API is stable; Node fetch API is stable)
