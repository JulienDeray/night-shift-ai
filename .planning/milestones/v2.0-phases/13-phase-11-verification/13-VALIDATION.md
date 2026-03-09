---
phase: 13
slug: phase-11-verification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.1.0 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/unit/scaffold.test.ts tests/integration/agent-commands.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/unit/scaffold.test.ts tests/integration/agent-commands.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | DX-01 | unit + integration | `npx vitest run tests/unit/scaffold.test.ts tests/integration/agent-commands.test.ts` | Yes | pending |
| 13-01-02 | 01 | 1 | DX-02 | integration | `npx vitest run tests/integration/agent-commands.test.ts` | Yes | pending |
| 13-01-03 | 01 | 1 | DX-03 | integration | `npx vitest run tests/integration/agent-commands.test.ts` | Yes | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files or frameworks needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Verification report format matches Phases 5-10 | All | Document structure not testable | Compare 11-VERIFICATION.md sections against 10-VERIFICATION.md |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
