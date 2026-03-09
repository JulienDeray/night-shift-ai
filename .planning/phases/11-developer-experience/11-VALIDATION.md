---
phase: 11
slug: developer-experience
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.1.0 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/unit/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/unit/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | DX-01 | unit | `npx vitest run tests/unit/scaffold.test.ts` | No — W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | DX-01 | integration | `npx vitest run tests/integration/agent-commands.test.ts` | No — W0 | ⬜ pending |
| 11-01-03 | 01 | 1 | DX-02 | integration | `npx vitest run tests/integration/agent-commands.test.ts` | No — W0 | ⬜ pending |
| 11-01-04 | 01 | 1 | DX-03 | integration | `npx vitest run tests/integration/agent-commands.test.ts` | No — W0 | ⬜ pending |
| 11-01-05 | 01 | 1 | DX-03 | unit | `npx vitest run tests/unit/scaffold.test.ts` | No — W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/integration/agent-commands.test.ts` — integration tests for DX-01, DX-02, DX-03
- [ ] `tests/unit/scaffold.test.ts` — scaffold logic unit tests + validate env var warning behavior

*These test stubs must exist before Wave 1 execution begins.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| README.md quality and completeness | DX docs | Content quality requires human review | Read docs/agents.md and README.md; verify they are sufficient for an AI agent to create a new agent from scratch |
| Scaffold next-steps output is helpful | DX-01 | UX quality check | Run `nightshift agent init test-agent`, verify printed next steps are actionable |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
