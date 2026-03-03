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

agents_dir: ./agents
agents:
  - name: my-agent
schedule: []

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
    await run(["init"]);
    await writeConfig();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a task file in the queue directory", async () => {
    const res = await run(["submit", "--agent", "my-agent", "Say hello world"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Task queued");

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].agentName).toBe("my-agent");
    expect(tasks[0].origin).toBe("one-off");
    expect(tasks[0].status).toBe("pending");
  });

  it("applies default timeout from config", async () => {
    await run(["submit", "--agent", "my-agent", "Do something"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].timeout).toBe("30m");
  });

  it("accepts --timeout flag", async () => {
    await run(["submit", "--agent", "my-agent", "--timeout", "15m", "Quick task"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].timeout).toBe("15m");
  });

  it("accepts --name flag", async () => {
    await run(["submit", "--agent", "my-agent", "--name", "my-custom-name", "Named task"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("my-custom-name");
  });

  it("generates a unique ID starting with ns-", async () => {
    await run(["submit", "--agent", "my-agent", "Task 1"]);
    await run(["submit", "--agent", "my-agent", "Task 2"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toMatch(/^ns-[0-9a-f]{8}$/);
    expect(tasks[1].id).toMatch(/^ns-[0-9a-f]{8}$/);
    expect(tasks[0].id).not.toBe(tasks[1].id);
  });

  it("auto-generates name when --name not provided", async () => {
    await run(["submit", "--agent", "my-agent", "Anonymous task"]);

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    // Name is now {agentName}-{taskId}
    expect(tasks[0].name).toMatch(/^my-agent-ns-/);
  });

  it("sets createdAt timestamp", async () => {
    const before = new Date().toISOString();
    await run(["submit", "--agent", "my-agent", "Timestamped task"]);
    const after = new Date().toISOString();

    const tasks = await readQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].createdAt >= before).toBe(true);
    expect(tasks[0].createdAt <= after).toBe(true);
  });

  it("requires --agent flag", async () => {
    const res = await run(["submit", "No agent provided"]);

    expect(res.exitCode).not.toBe(0);
    const combined = res.stdout + res.stderr;
    expect(combined.toLowerCase()).toMatch(/agent|required/);
  });

  it("fails gracefully without config", async () => {
    await fs.unlink(path.join(tmpDir, "nightshift.yaml"));
    const res = await run(["submit", "--agent", "my-agent", "No config"]);

    expect(res.exitCode).not.toBe(0);
  });

  it("prints confirmation with agent name", async () => {
    const res = await run(["submit", "--agent", "my-agent", "Summarize all PRs from this week"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Task queued");
    expect(res.stdout).toContain("ns-");
    expect(res.stdout).toContain("my-agent");
    expect(res.stdout).toContain("Timeout:");
  });
});
