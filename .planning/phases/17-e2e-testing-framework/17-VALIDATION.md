---
phase: 17
slug: e2e-testing-framework
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.1.0 |
| **Config file** | `vitest.e2e.config.ts` — Wave 0 gap (must be created) |
| **Quick run command** | `npx vitest run --config vitest.e2e.config.ts --reporter=verbose tests/e2e/lifecycle.test.ts` |
| **Full suite command** | `npm run test:e2e` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --config vitest.e2e.config.ts --reporter=verbose tests/e2e/lifecycle.test.ts`
- **After every plan wave:** Run `npm run test:e2e`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | TEST-01 | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/lifecycle.test.ts` | W0 | pending |
| 17-01-02 | 01 | 1 | TEST-05 | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/lifecycle.test.ts` | W0 | pending |
| 17-02-01 | 02 | 1 | TEST-02 | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/happy-path.test.ts` | W0 | pending |
| 17-02-02 | 02 | 1 | TEST-05 | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/happy-path.test.ts` | W0 | pending |
| 17-03-01 | 03 | 2 | TEST-03 | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/cli-commands.test.ts` | W0 | pending |
| 17-04-01 | 04 | 2 | TEST-04 | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/error-scenarios.test.ts` | W0 | pending |
| 17-04-02 | 04 | 2 | TEST-04 | e2e | `npx vitest run --config vitest.e2e.config.ts tests/e2e/error-scenarios.test.ts` | W0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `vitest.e2e.config.ts` — root-level vitest config for E2E suite
- [ ] `package.json` `test:e2e` script — `vitest run --config vitest.e2e.config.ts`
- [ ] `tests/e2e/helpers/daemon.ts` — daemon lifecycle helper (startDaemon, waitForReady, stopDaemon, killDaemon)
- [ ] `tests/e2e/helpers/ntfy-server.ts` — localhost HTTP mock server helper
- [ ] `tests/e2e/fixtures/mock-claude/claude` — shell script shim (chmod +x)
- [ ] `tests/e2e/fixtures/mock-claude/responses/success.json` — canned success response
- [ ] `tests/e2e/fixtures/mock-claude/responses/failure.json` — canned semantic failure response
- [ ] `tests/e2e/fixtures/agents/happy-path-agent/` — full agent directory with manifest.yaml + prompt
- [ ] `tests/e2e/fixtures/agents/multi-step-failure-agent/` — multi-step agent with failure step
- [ ] `tests/e2e/fixtures/agents/retry-agent/` — agent with retry config in manifest

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| No real `claude` binary called | TEST-05 | Verified by PATH shim interception — if shim is on PATH, real binary is unreachable | Confirm shim invocation log shows calls; check no network activity |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
