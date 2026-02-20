import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnWithTimeout } from "../../src/utils/process.js";
import type { NightShiftTask } from "../../src/core/types.js";

describe("nightshift submit (file-based queue)", () => {
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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-submit-"));
    // init so directory structure exists
    await run(["init"]);
    // overwrite config with beads disabled
    await writeConfig();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a task file in the queue directory", async () => {
    const res = await run(["submit", "Say hello world"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Task queued");

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].prompt).toBe("Say hello world");
    expect(tasks[0].origin).toBe("one-off");
    expect(tasks[0].status).toBe("pending");
  });

  it("applies default timeout and budget from config", async () => {
    await run(["submit", "Do something"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].timeout).toBe("30m");
    expect(tasks[0].maxBudgetUsd).toBe(5.0);
  });

  it("accepts --timeout flag", async () => {
    await run(["submit", "--timeout", "15m", "Quick task"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].timeout).toBe("15m");
  });

  it("accepts --budget flag", async () => {
    await run(["submit", "--budget", "2.50", "Cheap task"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].maxBudgetUsd).toBe(2.5);
  });

  it("accepts --model flag", async () => {
    await run(["submit", "--model", "opus", "Complex task"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].model).toBe("opus");
  });

  it("accepts --name flag", async () => {
    await run(["submit", "--name", "my-custom-name", "Named task"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("my-custom-name");
  });

  it("accepts --tools flag with multiple tools", async () => {
    // Prompt must come before --tools since variadic options consume
    // all subsequent values until the next flag
    await run(["submit", "Tool task", "--tools", "Read", "Write", "Bash"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].allowedTools).toEqual(["Read", "Write", "Bash"]);
  });

  it("generates a unique ID starting with ns-", async () => {
    await run(["submit", "Task 1"]);
    await run(["submit", "Task 2"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toMatch(/^ns-[0-9a-f]{8}$/);
    expect(tasks[1].id).toMatch(/^ns-[0-9a-f]{8}$/);
    expect(tasks[0].id).not.toBe(tasks[1].id);
  });

  it("auto-generates name when --name not provided", async () => {
    await run(["submit", "Anonymous task"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toMatch(/^one-off-ns-/);
  });

  it("sets createdAt timestamp", async () => {
    const before = new Date().toISOString();
    await run(["submit", "Timestamped task"]);
    const after = new Date().toISOString();

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].createdAt >= before).toBe(true);
    expect(tasks[0].createdAt <= after).toBe(true);
  });

  it("fails gracefully without config", async () => {
    await fs.unlink(path.join(tmpDir, "nightshift.yaml"));
    const res = await run(["submit", "No config"]);

    expect(res.exitCode).not.toBe(0);
  });

  it("prints confirmation with task ID and prompt summary", async () => {
    const res = await run(["submit", "Summarize all PRs from this week"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Task queued");
    expect(res.stdout).toContain("ns-");
    expect(res.stdout).toContain("Summarize all PRs");
    expect(res.stdout).toContain("Timeout:");
    expect(res.stdout).toContain("Budget:");
  });
});
