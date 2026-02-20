import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateReport, writeReport, toInboxEntry } from "../../src/inbox/reporter.js";
import type { NightShiftTask, AgentExecutionResult } from "../../src/core/types.js";

const makeTask = (overrides?: Partial<NightShiftTask>): NightShiftTask => ({
  id: "ns-abc12345",
  name: "test-task",
  origin: "one-off",
  prompt: "Do something useful",
  status: "running",
  timeout: "30m",
  createdAt: "2026-02-20T00:00:00Z",
  ...overrides,
});

const makeResult = (overrides?: Partial<AgentExecutionResult>): AgentExecutionResult => ({
  sessionId: "sess-123",
  durationMs: 149000,
  totalCostUsd: 0.42,
  result: "I did the thing successfully.",
  isError: false,
  numTurns: 8,
  ...overrides,
});

describe("generateReport", () => {
  it("generates valid markdown with frontmatter", () => {
    const task = makeTask();
    const result = makeResult();
    const started = new Date("2026-02-20T03:00:00Z");
    const completed = new Date("2026-02-20T03:02:29Z");

    const report = generateReport(task, result, started, completed);

    // Check frontmatter
    expect(report).toContain("---");
    expect(report).toContain("task_id: ns-abc12345");
    expect(report).toContain("task_name: test-task");
    expect(report).toContain("origin: one-off");
    expect(report).toContain("status: completed");
    expect(report).toContain("duration_seconds: 149");
    expect(report).toContain("cost_usd: 0.42");
    expect(report).toContain("num_turns: 8");

    // Check body
    expect(report).toContain("# test-task");
    expect(report).toContain("**Status**: Completed");
    expect(report).toContain("**Cost**: $0.42");
    expect(report).toContain("I did the thing successfully.");
    expect(report).toContain("> Do something useful");
  });

  it("marks failed tasks correctly", () => {
    const task = makeTask();
    const result = makeResult({ isError: true, result: "Something went wrong" });
    const started = new Date("2026-02-20T03:00:00Z");
    const completed = new Date("2026-02-20T03:01:00Z");

    const report = generateReport(task, result, started, completed);

    expect(report).toContain("status: failed");
    expect(report).toContain("**Status**: Failed");
    expect(report).toContain("Something went wrong");
  });

  it("formats long durations correctly", () => {
    const task = makeTask();
    const result = makeResult({ durationMs: 3700000 });
    const started = new Date("2026-02-20T02:00:00Z");
    const completed = new Date("2026-02-20T03:01:40Z");

    const report = generateReport(task, result, started, completed);

    expect(report).toContain("**Duration**: 1h 1m");
  });

  it("formats short durations (< 60s) as seconds", () => {
    const task = makeTask();
    const result = makeResult();
    const started = new Date("2026-02-20T03:00:00Z");
    const completed = new Date("2026-02-20T03:00:45Z");

    const report = generateReport(task, result, started, completed);

    expect(report).toContain("**Duration**: 45s");
  });

  it("formats medium durations (< 60m) with minutes and seconds", () => {
    const task = makeTask();
    const result = makeResult();
    const started = new Date("2026-02-20T03:00:00Z");
    const completed = new Date("2026-02-20T03:05:30Z");

    const report = generateReport(task, result, started, completed);

    expect(report).toContain("**Duration**: 5m 30s");
  });

  it("includes original prompt as blockquote for multi-line prompts", () => {
    const task = makeTask({ prompt: "Line one\nLine two\nLine three" });
    const result = makeResult();
    const started = new Date("2026-02-20T03:00:00Z");
    const completed = new Date("2026-02-20T03:01:00Z");

    const report = generateReport(task, result, started, completed);

    expect(report).toContain("> Line one\n> Line two\n> Line three");
  });
});

describe("writeReport", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-report-"));
    await fs.mkdir(path.join(tmpDir, ".nightshift", "inbox"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes report file to inbox directory", async () => {
    const task = makeTask({ id: "ns-abc12345", name: "my-task" });
    const result = makeResult();
    const started = new Date("2026-02-20T03:00:00Z");
    const completed = new Date("2026-02-20T03:02:29Z");

    const filePath = await writeReport(task, result, started, completed, tmpDir);

    expect(filePath).toContain(path.join(".nightshift", "inbox"));
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toContain("task_id: ns-abc12345");
  });

  it("generates filename following {date}_{name}_{shortid}.md pattern", async () => {
    const task = makeTask({ id: "ns-abc12345", name: "daily-standup" });
    const result = makeResult();
    const started = new Date("2026-02-20T03:00:00Z");
    const completed = new Date("2026-02-20T03:02:29Z");

    const filePath = await writeReport(task, result, started, completed, tmpDir);
    const fileName = path.basename(filePath);

    expect(fileName).toMatch(/^2026-02-20_daily-standup_ns-abc12\.md$/);
  });

  it("writes to custom output path when task has output field", async () => {
    const task = makeTask({
      id: "ns-abc12345",
      name: "daily-report",
      output: "custom-reports/daily-report.md",
    });
    const result = makeResult();
    const started = new Date("2026-02-20T03:00:00Z");
    const completed = new Date("2026-02-20T03:02:29Z");

    await writeReport(task, result, started, completed, tmpDir);

    const customPath = path.join(tmpDir, "custom-reports", "daily-report.md");
    const exists = await fs.access(customPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    const content = await fs.readFile(customPath, "utf-8");
    expect(content).toContain("task_id: ns-abc12345");
  });
});

describe("toInboxEntry", () => {
  it("creates an inbox entry from task and result", () => {
    const task = makeTask();
    const result = makeResult();
    const started = new Date("2026-02-20T03:00:00Z");
    const completed = new Date("2026-02-20T03:02:29Z");

    const entry = toInboxEntry(task, result, started, completed, "/path/to/report.md");

    expect(entry.taskId).toBe("ns-abc12345");
    expect(entry.taskName).toBe("test-task");
    expect(entry.origin).toBe("one-off");
    expect(entry.status).toBe("completed");
    expect(entry.durationSeconds).toBe(149);
    expect(entry.costUsd).toBe(0.42);
    expect(entry.numTurns).toBe(8);
    expect(entry.filePath).toBe("/path/to/report.md");
  });

  it("truncates result summary to 500 chars", () => {
    const task = makeTask();
    const longResult = "x".repeat(1000);
    const result = makeResult({ result: longResult });
    const started = new Date("2026-02-20T03:00:00Z");
    const completed = new Date("2026-02-20T03:01:00Z");

    const entry = toInboxEntry(task, result, started, completed, "/path/to/report.md");

    expect(entry.resultSummary.length).toBe(500);
  });

  it("marks failed tasks with status 'failed'", () => {
    const task = makeTask();
    const result = makeResult({ isError: true });
    const started = new Date("2026-02-20T03:00:00Z");
    const completed = new Date("2026-02-20T03:01:00Z");

    const entry = toInboxEntry(task, result, started, completed, "/path/to/report.md");

    expect(entry.status).toBe("failed");
  });
});
