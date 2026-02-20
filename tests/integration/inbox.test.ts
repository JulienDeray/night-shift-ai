import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnWithTimeout } from "../../src/utils/process.js";

describe("nightshift inbox", () => {
  let tmpDir: string;
  const bin = path.resolve("bin/nightshift.ts");

  function run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const { result } = spawnWithTimeout("npx", ["tsx", bin, ...args], {
      timeoutMs: 15000,
      cwd: tmpDir,
    });
    return result;
  }

  async function writeConfig(): Promise<void> {
    const config = `workspace: ./workspace
max_concurrent: 2
beads:
  enabled: false
daemon:
  poll_interval_ms: 30000
  heartbeat_interval_ms: 10000
  log_retention_days: 30
recurring: []
one_off_defaults:
  timeout: "30m"
  max_budget_usd: 5.00
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), config);
  }

  function makeReport(name: string, status: string, date: string): string {
    return `---
task_id: ns-12345678
task_name: ${name}
origin: one-off
status: ${status}
started_at: ${date}T03:00:00Z
completed_at: ${date}T03:02:29Z
duration_seconds: 149
cost_usd: 0.42
num_turns: 8
---

# ${name}

**Status**: Completed | **Duration**: 2m 29s | **Cost**: $0.42

## Result

Task completed successfully.

## Original Prompt

> Do something useful
`;
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-inbox-"));
    await run(["init"]);
    await writeConfig();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("shows 'No inbox reports' when inbox is empty", async () => {
    const res = await run(["inbox"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("No inbox reports");
  });

  it("lists reports as a table with task name, status, duration, cost", async () => {
    const inboxDir = path.join(tmpDir, ".nightshift", "inbox");
    await fs.writeFile(
      path.join(inboxDir, "2026-02-20_daily-task_ns-12345.md"),
      makeReport("daily-task", "completed", "2026-02-20"),
    );

    const res = await run(["inbox"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("daily-task");
    expect(res.stdout).toContain("0.42");
  });

  it("sorts reports newest first", async () => {
    const inboxDir = path.join(tmpDir, ".nightshift", "inbox");
    await fs.writeFile(
      path.join(inboxDir, "2026-02-18_old-task_ns-11111.md"),
      makeReport("old-task", "completed", "2026-02-18"),
    );
    await fs.writeFile(
      path.join(inboxDir, "2026-02-20_new-task_ns-22222.md"),
      makeReport("new-task", "completed", "2026-02-20"),
    );

    const res = await run(["inbox"]);

    expect(res.exitCode).toBe(0);
    // new-task should appear before old-task
    const newIdx = res.stdout.indexOf("new-task");
    const oldIdx = res.stdout.indexOf("old-task");
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it("limits results with -n flag", async () => {
    const inboxDir = path.join(tmpDir, ".nightshift", "inbox");
    for (let i = 1; i <= 5; i++) {
      await fs.writeFile(
        path.join(inboxDir, `2026-02-${String(i).padStart(2, "0")}_task-${i}_ns-${String(i).padStart(5, "0")}.md`),
        makeReport(`task-${i}`, "completed", `2026-02-${String(i).padStart(2, "0")}`),
      );
    }

    const res = await run(["inbox", "-n", "2"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("task-5");
    expect(res.stdout).toContain("task-4");
    expect(res.stdout).not.toContain("task-1");
  });

  it("displays full report content with --read flag", async () => {
    const inboxDir = path.join(tmpDir, ".nightshift", "inbox");
    const fileName = "2026-02-20_read-test_ns-12345.md";
    await fs.writeFile(
      path.join(inboxDir, fileName),
      makeReport("read-test", "completed", "2026-02-20"),
    );

    const res = await run(["inbox", "--read", fileName]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("# read-test");
    expect(res.stdout).toContain("Task completed successfully.");
    expect(res.stdout).toContain("> Do something useful");
  });

  it("shows error when --read references a non-existent file", async () => {
    const res = await run(["inbox", "--read", "nonexistent.md"]);

    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain("Report not found");
  });
});
