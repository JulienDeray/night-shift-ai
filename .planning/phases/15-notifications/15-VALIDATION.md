---
phase: 15
slug: notifications
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.1.0 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- --reporter=dot` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --reporter=dot tests/unit/notification-formatter.test.ts tests/unit/orchestrator.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | NTFY-01 | unit | `npm test -- --reporter=dot tests/unit/notification-formatter.test.ts` | ❌ W0 | ⬜ pending |
| 15-01-02 | 01 | 1 | NTFY-02 | unit | `npm test -- --reporter=dot tests/unit/notification-formatter.test.ts` | ❌ W0 | ⬜ pending |
| 15-01-03 | 01 | 1 | NTFY-03 | unit | `npm test -- --reporter=dot tests/unit/notification-formatter.test.ts` | ❌ W0 | ⬜ pending |
| 15-02-01 | 02 | 1 | NTFY-01 | unit | `npm test -- --reporter=dot tests/unit/orchestrator.test.ts` | ✅ (update) | ⬜ pending |
| 15-02-02 | 02 | 1 | NTFY-02 | unit | `npm test -- --reporter=dot tests/unit/orchestrator.test.ts` | ✅ (update) | ⬜ pending |
| 15-02-03 | 02 | 1 | NTFY-03 | unit | `npm test -- --reporter=dot tests/unit/orchestrator.test.ts` | ✅ (update) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/notification-formatter.test.ts` — stubs for NTFY-01, NTFY-02, NTFY-03 formatter pure functions

*Existing `tests/unit/orchestrator.test.ts` requires updates but already exists.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
