import { describe, it, expect } from "vitest";
import {
  formatStartNotification,
  formatSuccessNotification,
  formatFailureNotification,
  formatEarlyExitNotification,
} from "../../src/notifications/notification-formatter.js";
import type { NightShiftTask } from "../../src/core/types.js";
import type { AgentRunResult } from "../../src/agent/engine-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<NightShiftTask> = {}): NightShiftTask {
  return {
    id: "task-1",
    name: "nightly-refactor",
    origin: "recurring",
    prompt: "Do something",
    status: "running",
    timeout: "30m",
    notify: true,
    agentName: "code-agent",
    ...overrides,
  };
}

function makeResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    runId: "run-1",
    agentName: "code-agent",
    status: "SUCCESS",
    finalOutput: "Created MR !42\nWith details",
    perStep: [
      { name: "init", status: "SUCCESS", durationMs: 100 },
      { name: "execute", status: "SUCCESS", durationMs: 200 },
    ],
    totalDurationMs: 222000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatStartNotification
// ---------------------------------------------------------------------------

describe("formatStartNotification", () => {
  it("returns correct title with agent and task names", () => {
    const task = makeTask({ name: "nightly-refactor", agentName: "code-agent" });
    const msg = formatStartNotification(task);
    expect(msg.title).toBe("🕐 code-agent ▸ nightly-refactor");
  });

  it("returns correct body with plain text", () => {
    const task = makeTask({ agentName: "code-agent" });
    const msg = formatStartNotification(task);
    expect(msg.body).toBe("Task started");
  });

  it("returns priority 3", () => {
    const task = makeTask();
    const msg = formatStartNotification(task);
    expect(msg.priority).toBe(3);
  });

  it("returns tags array with at least one emoji tag", () => {
    const task = makeTask();
    const msg = formatStartNotification(task);
    expect(msg.tags).toBeDefined();
    expect(Array.isArray(msg.tags)).toBe(true);
    expect((msg.tags as string[]).length).toBeGreaterThan(0);
  });

  it("falls back to 'unknown-agent' when agentName is undefined", () => {
    const task = makeTask({ agentName: undefined });
    const msg = formatStartNotification(task);
    expect(msg.title).toBe("🕐 unknown-agent ▸ nightly-refactor");
    expect(msg.body).toBe("Task started");
  });

  it("includes variables in body when task has variables", () => {
    const task = makeTask({ variables: { repo_url: "https://gitlab.com/repo.git", category: "tests" } });
    const msg = formatStartNotification(task);
    expect(msg.body).toContain("Task started");
    expect(msg.body).toContain("repo_url=https://gitlab.com/repo.git");
    expect(msg.body).toContain("category=tests");
  });
});

// ---------------------------------------------------------------------------
// formatSuccessNotification
// ---------------------------------------------------------------------------

describe("formatSuccessNotification", () => {
  it("returns correct title with agent and task names", () => {
    const task = makeTask({ name: "nightly-refactor", agentName: "code-agent" });
    const result = makeResult({ agentName: "code-agent" });
    const msg = formatSuccessNotification(task, result);
    expect(msg.title).toBe("✅ code-agent ▸ nightly-refactor");
  });

  it("body contains duration and summary separated by ·", () => {
    const task = makeTask({ agentName: "code-agent" });
    const result = makeResult();
    const msg = formatSuccessNotification(task, result);
    expect(msg.body).toContain("3m 42s");
    expect(msg.body).toContain(" · ");
  });

  it("body contains human-friendly duration (minutes + seconds)", () => {
    const task = makeTask();
    const result = makeResult({ totalDurationMs: 222000 }); // 3m 42s
    const msg = formatSuccessNotification(task, result);
    expect(msg.body).toContain("3m 42s");
  });

  it("body contains first line of finalOutput string only", () => {
    const task = makeTask();
    const result = makeResult({ finalOutput: "Created MR !42\nWith details" });
    const msg = formatSuccessNotification(task, result);
    expect(msg.body).toContain("Created MR !42");
    expect(msg.body).not.toContain("With details");
    expect(msg.body).toBe("3m 42s · Created MR !42");
  });

  it("returns priority 3", () => {
    const task = makeTask();
    const result = makeResult();
    const msg = formatSuccessNotification(task, result);
    expect(msg.priority).toBe(3);
  });

  it("returns tags with at least one emoji tag", () => {
    const task = makeTask();
    const result = makeResult();
    const msg = formatSuccessNotification(task, result);
    expect(msg.tags).toBeDefined();
    expect(Array.isArray(msg.tags)).toBe(true);
    expect((msg.tags as string[]).length).toBeGreaterThan(0);
  });

  it("extracts summary field from object finalOutput", () => {
    const task = makeTask();
    const result = makeResult({ finalOutput: { summary: "Refactored 3 files" } });
    const msg = formatSuccessNotification(task, result);
    expect(msg.body).toContain("Refactored 3 files");
  });

  it("extracts result field from object finalOutput when no summary", () => {
    const task = makeTask();
    const result = makeResult({ finalOutput: { result: "Fixed bug" } });
    const msg = formatSuccessNotification(task, result);
    expect(msg.body).toContain("Fixed bug");
  });

  it("falls back to JSON stringify for unknown object finalOutput", () => {
    const task = makeTask();
    const result = makeResult({ finalOutput: { foo: "bar" } });
    const msg = formatSuccessNotification(task, result);
    expect(msg.body).toContain("foo");
  });

  it("truncates JSON stringify fallback to 200 chars", () => {
    const task = makeTask();
    const longObj = { data: "x".repeat(500) };
    const result = makeResult({ finalOutput: longObj });
    const msg = formatSuccessNotification(task, result);
    // The summary part of the body (after " · ") should not exceed 200 chars
    const parts = (msg.body ?? "").split(" · ");
    const summaryPart = parts.slice(1).join(" · ");
    expect(summaryPart.length).toBeLessThanOrEqual(200);
  });

  it("formats duration as hours + minutes for long runs", () => {
    const task = makeTask();
    const result = makeResult({ totalDurationMs: 3700000 }); // 1h 1m 40s
    const msg = formatSuccessNotification(task, result);
    expect(msg.body).toContain("1h 1m");
  });

  it("formats duration as seconds-only for short runs", () => {
    const task = makeTask();
    const result = makeResult({ totalDurationMs: 45000 }); // 45s
    const msg = formatSuccessNotification(task, result);
    expect(msg.body).toContain("45s");
  });

  it("uses agentName from result when task.agentName is undefined", () => {
    const task = makeTask({ agentName: undefined });
    const result = makeResult({ agentName: "code-agent" });
    const msg = formatSuccessNotification(task, result);
    expect(msg.title).toBe("✅ code-agent ▸ nightly-refactor");
  });

  it("includes variables in body when task has variables", () => {
    const task = makeTask({ variables: { env: "staging" } });
    const result = makeResult();
    const msg = formatSuccessNotification(task, result);
    expect(msg.body).toContain("env=staging");
  });
});

// ---------------------------------------------------------------------------
// formatFailureNotification
// ---------------------------------------------------------------------------

describe("formatFailureNotification", () => {
  it("returns correct title with FAILED marker", () => {
    const task = makeTask({ name: "nightly-refactor", agentName: "code-agent" });
    const result = makeResult({
      status: "FATAL",
      error: "TypeError: x is not a function\n    at foo.ts:12\n    at bar.ts:34",
      failedStepIndex: 1,
    });
    const msg = formatFailureNotification(task, result);
    expect(msg.title).toBe("❌ code-agent ▸ nightly-refactor");
  });

  it("body contains the failed step name", () => {
    const task = makeTask();
    const result = makeResult({
      status: "FATAL",
      error: "TypeError: x is not a function\n    at foo.ts:12",
      failedStepIndex: 1,
      perStep: [
        { name: "init", status: "SUCCESS", durationMs: 100 },
        { name: "execute", status: "FAILED", durationMs: 200 },
      ],
    });
    const msg = formatFailureNotification(task, result);
    expect(msg.body).toContain("Step 'execute' failed");
    expect(msg.body).toContain("TypeError: x is not a function");
  });

  it("body strips stack trace frames from error", () => {
    const task = makeTask();
    const result = makeResult({
      status: "FATAL",
      error: "TypeError: x is not a function\n    at foo.ts:12\n    at bar.ts:34",
      failedStepIndex: 0,
    });
    const msg = formatFailureNotification(task, result);
    expect(msg.body).toContain("TypeError: x is not a function");
    expect(msg.body).not.toContain("at foo.ts:12");
    expect(msg.body).not.toContain("at bar.ts:34");
  });

  it("returns priority 4", () => {
    const task = makeTask();
    const result = makeResult({ status: "FATAL", error: "Something broke" });
    const msg = formatFailureNotification(task, result);
    expect(msg.priority).toBe(4);
  });

  it("returns tags with at least one emoji tag", () => {
    const task = makeTask();
    const result = makeResult({ status: "FATAL", error: "broken" });
    const msg = formatFailureNotification(task, result);
    expect(msg.tags).toBeDefined();
    expect(Array.isArray(msg.tags)).toBe(true);
    expect((msg.tags as string[]).length).toBeGreaterThan(0);
  });

  it("body contains 'unknown step failed' when failedStepIndex is undefined", () => {
    const task = makeTask();
    const result = makeResult({
      status: "FATAL",
      error: "Crashed",
      failedStepIndex: undefined,
    });
    const msg = formatFailureNotification(task, result);
    expect(msg.body).toContain("unknown step failed");
  });

  it("body contains step index fallback when failedStepIndex is out of bounds", () => {
    const task = makeTask();
    const result = makeResult({
      status: "FATAL",
      error: "Crashed",
      failedStepIndex: 5,
      perStep: [
        { name: "init", status: "SUCCESS", durationMs: 100 },
        { name: "execute", status: "FAILED", durationMs: 200 },
      ],
    });
    const msg = formatFailureNotification(task, result);
    expect(msg.body).toContain("step 5 failed");
  });

  it("body contains 'Unknown error' when error is undefined", () => {
    const task = makeTask();
    const result = makeResult({
      status: "FATAL",
      error: undefined,
      failedStepIndex: 0,
    });
    const msg = formatFailureNotification(task, result);
    expect(msg.body).toContain("Unknown error");
  });
});

// ---------------------------------------------------------------------------
// formatEarlyExitNotification
// ---------------------------------------------------------------------------

describe("formatEarlyExitNotification", () => {
  it("returns correct title with ⏭️ prefix, agent and task names", () => {
    const task = makeTask({ name: "nightly-refactor", agentName: "code-agent" });
    const result = makeResult({ earlyExitReason: "Nothing to do" });
    const msg = formatEarlyExitNotification(task, result);
    expect(msg.title).toBe("⏭️ code-agent ▸ nightly-refactor");
  });

  it("body contains duration and earlyExitReason", () => {
    const task = makeTask();
    const result = makeResult({
      totalDurationMs: 222000,
      earlyExitReason: "No open PRs",
    });
    const msg = formatEarlyExitNotification(task, result);
    expect(msg.body).toBe("3m 42s · No open PRs");
  });

  it("uses fallback 'Nothing to do' when earlyExitReason is undefined", () => {
    const task = makeTask();
    const result = makeResult({ earlyExitReason: undefined });
    const msg = formatEarlyExitNotification(task, result);
    expect(msg.body).toContain("Nothing to do");
  });

  it("uses fallback 'Nothing to do' when earlyExitReason is empty string", () => {
    const task = makeTask();
    const result = makeResult({ earlyExitReason: "" });
    const msg = formatEarlyExitNotification(task, result);
    expect(msg.body).toContain("Nothing to do");
  });

  it("returns priority 3", () => {
    const task = makeTask();
    const result = makeResult({ earlyExitReason: "Skipped" });
    const msg = formatEarlyExitNotification(task, result);
    expect(msg.priority).toBe(3);
  });

  it("returns tags array with fast_forward tag", () => {
    const task = makeTask();
    const result = makeResult({ earlyExitReason: "Skipped" });
    const msg = formatEarlyExitNotification(task, result);
    expect(msg.tags).toBeDefined();
    expect(Array.isArray(msg.tags)).toBe(true);
    expect(msg.tags).toContain("fast_forward");
  });

  it("falls back to 'unknown-agent' when task.agentName is undefined", () => {
    const task = makeTask({ agentName: undefined });
    const result = makeResult({ agentName: undefined, earlyExitReason: "No work" });
    const msg = formatEarlyExitNotification(task, result);
    expect(msg.title).toBe("⏭️ unknown-agent ▸ nightly-refactor");
  });

  it("formats short durations correctly (seconds only)", () => {
    const task = makeTask();
    const result = makeResult({ totalDurationMs: 8000, earlyExitReason: "Quick skip" });
    const msg = formatEarlyExitNotification(task, result);
    expect(msg.body).toBe("8s · Quick skip");
  });

  it("prefers task.agentName over result.agentName", () => {
    const task = makeTask({ agentName: "task-agent" });
    const result = makeResult({ agentName: "result-agent", earlyExitReason: "Done" });
    const msg = formatEarlyExitNotification(task, result);
    expect(msg.title).toBe("⏭️ task-agent ▸ nightly-refactor");
  });
});
