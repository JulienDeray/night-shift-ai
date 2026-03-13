import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnWithTimeout } from "../../src/utils/process.js";
import type { NightShiftTask } from "../../src/core/types.js";

describe("nightshift cancel (file-based queue)", () => {
  let tmpDir: string;
  const bin = path.resolve("bin/nightshift.ts");

  function run(
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const { result } = spawnWithTimeout("npx", ["tsx", bin, ...args], {
      timeoutMs: 15000,
      cwd: tmpDir,
    });
    return result;
  }

  async function writeConfig(overrides: string = ""): Promise<void> {
    const config = `workspace: ./workspace
inbox: ./inbox
max_concurrent: 2
default_timeout: "30m"

daemon:
  poll_interval_ms: 30000
  heartbeat_interval_ms: 10000
  log_retention_days: 30

agents_dir: ./agents
agents:
  - name: my-agent
schedule: []

one_off_defaults:
  timeout: "30m"
${overrides}`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), config);
  }

  async function readQueuedTasks(): Promise<NightShiftTask[]> {
    const queueDir = path.join(tmpDir, ".nightshift", "queue");
    let files: string[];
    try {
      files = await fs.readdir(queueDir);
    } catch {
      return [];
    }
    const tasks: NightShiftTask[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const content = await fs.readFile(path.join(queueDir, file), "utf-8");
      tasks.push(JSON.parse(content));
    }
    return tasks;
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-cancel-"));
    await run(["init"]);
    await writeConfig();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("cancels a pending task by ID — queue becomes empty and output contains 'Cancelled'", async () => {
    const submitRes = await run(["submit", "--agent", "my-agent", "Task to cancel"]);
    expect(submitRes.exitCode).toBe(0);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    const taskId = tasks[0].id;

    const cancelRes = await run(["cancel", taskId]);
    expect(cancelRes.exitCode).toBe(0);
    expect(cancelRes.stdout).toContain("Cancelled");

    const remaining = await readQueuedTasks();
    expect(remaining).toHaveLength(0);
  });

  it("exits non-zero and prints error when task ID does not exist", async () => {
    const res = await run(["cancel", "ns-00000000"]);
    expect(res.exitCode).not.toBe(0);
    const combined = res.stdout + res.stderr;
    expect(combined.toLowerCase()).toMatch(/not found|does not exist|no task/);
  });

  it("cancels only the specified task when multiple tasks are queued", async () => {
    await run(["submit", "--agent", "my-agent", "Task one"]);
    await run(["submit", "--agent", "my-agent", "Task two"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(2);
    const taskIdToCancel = tasks[0].id;

    const cancelRes = await run(["cancel", taskIdToCancel]);
    expect(cancelRes.exitCode).toBe(0);

    const remaining = await readQueuedTasks();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).not.toBe(taskIdToCancel);
  });

  it("exits non-zero and mentions 'running' when task has status running", async () => {
    const queueDir = path.join(tmpDir, ".nightshift", "queue");
    const runningTask: NightShiftTask = {
      id: "ns-aaaabbbb",
      name: "running-task",
      origin: "one-off",
      prompt: "Some prompt",
      status: "running",
      timeout: "30m",
      createdAt: new Date().toISOString(),
      agentName: "my-agent",
    };
    await fs.writeFile(
      path.join(queueDir, "ns-aaaabbbb.json"),
      JSON.stringify(runningTask),
    );

    const res = await run(["cancel", "ns-aaaabbbb"]);
    expect(res.exitCode).not.toBe(0);
    const combined = res.stdout + res.stderr;
    expect(combined.toLowerCase()).toContain("running");
  });

  it("cancel --help shows the task-id argument", async () => {
    const res = await run(["cancel", "--help"]);
    expect(res.exitCode).toBe(0);
    const combined = res.stdout + res.stderr;
    expect(combined).toMatch(/task-id/);
  });
});
