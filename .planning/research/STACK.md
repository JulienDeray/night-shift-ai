# Stack Research

**Domain:** Nightly code-improvement agent with push notifications and GitLab MR creation
**Researched:** 2026-02-23
**Confidence:** HIGH

## Context

This is an additive milestone on top of the existing night-shift framework (Node.js 20+, TypeScript strict, ESM, Commander, croner, Zod, yaml, vitest). The research below covers ONLY what needs to be added. Existing dependencies are not re-evaluated.

---

## New Stack Requirements

### 1. Ntfy Push Notifications

**Verdict: No new npm dependency needed.**

The Ntfy API is plain HTTP POST. Node.js 20+ ships `fetch` as a stable global (unflagged since Node 21, backported in Node 18+, fully stable in Node 20 LTS). The project already targets Node 20+. A single `fetch()` call covers everything:

```typescript
await fetch(`https://ntfy.sh/${topic}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`, // optional, for access-controlled topics
  },
  body: JSON.stringify({
    topic,
    title,
    message,
    priority: 3, // 1=min, 2=low, 3=default, 4=high, 5=max/urgent
    click: mrUrl, // optional URL opened on notification tap
  }),
});
```

**Why no library:** The community package `@cityssm/ntfy-publish` exists but adds a dependency for 5 lines of `fetch`. The Ntfy API is stable, has no SDK-specific quirks, and is fully documented. The existing codebase has no HTTP client library — adding one for Ntfy would be inconsistent with the project's zero-dependency philosophy for simple tasks.

**Auth pattern:** Bearer token stored in config (Zod-validated), passed as `Authorization: Bearer <token>` header. Topic name alone is sufficient for public/private-by-obscurity use; token auth is for self-hosted or access-controlled ntfy.sh accounts.

**Confidence:** HIGH — verified against official Ntfy docs at docs.ntfy.sh/publish.

---

### 2. Git Clone + Branch Operations

**Verdict: No new npm dependency needed.**

Git operations (clone, branch, commit, push) go through the system `git` binary via `child_process.spawn`. The existing `spawnWithTimeout()` utility in `src/utils/process.ts` already does exactly this pattern. All git operations should reuse it.

**Temp directory:** Use Node.js built-ins — `fs/promises.mkdtemp` + `os.tmpdir()`. Clean up in a `try/finally` block using `fs.rmSync(dir, { recursive: true, force: true })`.

```typescript
import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cloneDir = await mkdtemp(join(tmpdir(), "night-shift-clone-"));
try {
  await spawnWithTimeout("git", ["clone", "--depth", "1", repoUrl, cloneDir], { cwd: tmpdir() });
  // ... agent work ...
} finally {
  rmSync(cloneDir, { recursive: true, force: true });
}
```

**Why `--depth 1`:** Full clone history is not needed for a patch-sized improvement. Shallow clone is significantly faster on large repos.

**Confidence:** HIGH — uses existing project utility, no new technology introduced.

---

### 3. MR Creation via glab CLI

**Verdict: No new npm dependency needed. `glab` is an external binary assumed pre-installed.**

MR creation uses `glab mr create` via `spawnWithTimeout()`. The agent:
1. Creates a branch (`git checkout -b <branch-name>`)
2. Makes changes and commits
3. Pushes the branch (`git push -u origin <branch-name>`)
4. Creates the MR (`glab mr create --fill --yes --target-branch main`)

**Non-interactive invocation:**
```bash
glab mr create \
  --title "refactor: ..." \
  --description "..." \
  --target-branch main \
  --yes
```

Using `--title` and `--description` explicitly (instead of `--fill`) gives the agent control over the MR message. `--yes` skips confirmation prompts. There is no `--no-editor` flag; omitting `--description "-"` avoids opening an editor.

**Version requirement:** glab 1.x (latest 1.85.2 as of Feb 2026). Requires GitLab 16.0+. Auth is pre-configured via `glab auth login` on the user's machine — no config work needed.

**Confidence:** HIGH — verified against official GitLab CLI docs at docs.gitlab.com/cli/mr/create.

---

### 4. Config-Driven Day-of-Week Rotation

**Verdict: Extend existing Zod config schema. No new library needed.**

The day-of-week category rotation is a new config section in `nightshift.yaml`, validated with Zod (already a dependency). No new library is needed — `croner` (already a dependency) can report current day of week, and a simple object lookup handles the rotation.

```typescript
// Zod schema extension
const CodeAgentSchema = z.object({
  repo: z.string().url(),
  target_branch: z.string().default("main"),
  confluence_page_id: z.string(),
  ntfy_topic: z.string().optional(),
  ntfy_token: z.string().optional(),
  schedule: z.record(
    z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
    z.string(), // category name: "tests", "refactoring", "docs", etc.
  ),
});
```

**Confidence:** HIGH — pattern is identical to existing config schema extension approach.

---

## Recommended Stack (New Additions Summary)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `node:fetch` (built-in) | Node 20+ (stable) | Ntfy HTTP POST | Zero-dep, already available, Ntfy API is 5 lines of fetch |
| `node:fs/promises.mkdtemp` (built-in) | Node 20+ | Temp clone directory | Built-in, correct async pattern, matches existing ESM style |
| `node:os.tmpdir` (built-in) | Node 20+ | OS-appropriate temp path | Built-in, cross-platform |
| `git` (system binary) | any | Clone, branch, commit, push | Via existing `spawnWithTimeout`, no new code pattern |
| `glab` (system binary) | 1.x (1.85.2 latest) | MR creation | Pre-installed, authenticated, non-interactive via `--title --description --yes` |
| Zod schema extension | 4.3.0 (existing) | Config validation for new fields | Same pattern as existing config, no version bump needed |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@cityssm/ntfy-publish` or any ntfy npm package | Wraps 5 lines of `fetch`; adds dep for zero benefit | Native `fetch` |
| `simple-git` or `nodegit` | Heavy npm wrappers for git; adds 100+ KB for zero benefit over `spawn('git', ...)` | `spawnWithTimeout('git', args)` using existing utility |
| `axios` or `node-fetch` | `fetch` is stable in Node 20+; adding an HTTP client contradicts the project's lean dependency philosophy | `globalThis.fetch` |
| `tmp` or `temp` npm packages | `fs/promises.mkdtemp` + `os.tmpdir()` is idiomatic Node 20 ESM with no ceremony | Node.js built-ins |
| Custom GitLab API calls (REST/GraphQL) | `glab` handles auth, MR creation, and GitLab-specific logic; reimplementing would require token management | `glab` CLI |

---

## Installation

No new npm dependencies required. All new capabilities use:
- Node.js 20+ built-ins (`fetch`, `fs/promises`, `os`, `path`)
- Existing project utilities (`spawnWithTimeout` in `src/utils/process.ts`)
- External system binaries (`git`, `glab`) assumed pre-installed and authenticated

```bash
# Verify system binaries are present and authenticated
git --version
glab auth status
```

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `node:fetch` (Node 20 built-in) | Node 20+, 22+ | Stable global, no import needed; project already requires Node 20+ |
| `glab` 1.x | GitLab 16.0+ | Uses `--yes` and explicit `--title`/`--description` flags for non-interactive mode |
| Zod 4.3.0 | Existing schema | New `code_agent` section added alongside existing schema — no breaking changes |

---

## Integration Points in Existing Code

| New Feature | Hooks Into | How |
|-------------|-----------|-----|
| Ntfy client | `src/daemon/orchestrator.ts` | Called on task start/end events; task config opts in via `ntfy: true` |
| Ntfy config | `src/core/config.ts` | New top-level `ntfy` section in Zod schema (`topic`, `token`) |
| Clone/cleanup | New `src/agents/code-improver/` module | Uses `spawnWithTimeout` + `mkdtemp` + `rmSync` |
| glab MR create | New `src/agents/code-improver/` module | Uses `spawnWithTimeout('glab', ['mr', 'create', ...])` |
| Day-of-week rotation | New `code_agent` config section | Zod-validated, read at runtime by the recurring task prompt builder |

---

## Sources

- https://docs.ntfy.sh/publish/ — Ntfy HTTP API, JSON body format, headers, Bearer auth (HIGH confidence, official docs)
- https://docs.gitlab.com/cli/mr/create/ — `glab mr create` flags including `--yes`, `--title`, `--description`, `--target-branch` (HIGH confidence, official docs)
- https://nodejs.org/api/fs.html — `fs/promises.mkdtemp`, `fs.rmSync` built-in APIs (HIGH confidence, official docs)
- https://github.com/gitlabhq/cli — glab CLI source, version 1.85.2 latest (MEDIUM confidence, WebSearch)
- https://www.mankier.com/1/glab-mr-create — glab mr create man page with full flag list (MEDIUM confidence, mirrors official)

---

*Stack research for: night-shift code improvement agent milestone*
*Researched: 2026-02-23*
