---
phase: 16
slug: codebase-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/unit/engine.test.ts tests/unit/manifest-loader.test.ts --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~34 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 34 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | CLEAN-01, CLEAN-03 | build + audit | `npx tsc --noEmit && grep -r "bead\|agent-runner\|code-agent-runner" src/ tests/` | N/A | pending |
| 16-01-02 | 01 | 1 | CLEAN-01, CLEAN-02 | build | `npx tsc --noEmit` | N/A | pending |
| 16-01-03 | 01 | 1 | CLEAN-04 | full suite | `npx vitest run` | yes | pending |
| 16-02-01 | 02 | 2 | CLEAN-02 | unit | `npx vitest run tests/unit/engine.test.ts tests/unit/manifest-loader.test.ts tests/unit/startup-validation.test.ts` | yes | pending |
| 16-02-02 | 02 | 2 | CLEAN-04 | full suite | `npx vitest run` | yes | pending |
| 16-03-01 | 03 | 3 | CLEAN-01, CLEAN-02 | build | `npx tsc --noEmit` | N/A | pending |
| 16-03-02 | 03 | 3 | CLEAN-01, CLEAN-03 | audit | `grep -r "category\|max_budget_usd\|code-agent-runner" src/ tests/` | N/A | pending |
| 16-03-03 | 03 | 3 | CLEAN-04 | full suite | `npx vitest run` | yes | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

No new test files or frameworks needed. This phase deletes tests (prompt-loader.test.ts) but does not require new test files.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dead prompt .md files removed | CLEAN-03 | File deletion, not testable by unit tests | `ls src/agent/prompts/*.md` should return "no matches found" |
| Stale comments removed | CLEAN-03 | Comment content not covered by tests | `grep -r "code-agent-runner\|Phase 10 migration" src/` should return empty |
| agent-types.ts deleted | CLEAN-01 | File deletion | `test ! -f src/agent/agent-types.ts && echo "GONE"` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 34s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
