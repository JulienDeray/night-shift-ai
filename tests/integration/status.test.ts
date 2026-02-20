import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnWithTimeout } from "../../src/utils/process.js";
import { writeJsonFile } from "../../src/utils/fs.js";
import type { DaemonState } from "../../src/core/types.js";

describe("nightshift status", () => {
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

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-status-"));
    await run(["init"]);
    await writeConfig();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("shows 'stopped' when no daemon is running", async () => {
    const res = await run(["status"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("stopped");
  });

  it("shows daemon info when state file exists with running status", async () => {
    // Write a daemon state file simulating a running daemon with this process's PID
    const state: DaemonState = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      activeTasks: 1,
      totalExecuted: 10,
      totalCostUsd: 3.45,
      status: "running",
    };
    await writeJsonFile(path.join(tmpDir, ".nightshift", "daemon.json"), state);

    const res = await run(["status"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("running");
  });

  it("shows queue depth for file-based queue", async () => {
    // Create some pending tasks in the queue
    const queueDir = path.join(tmpDir, ".nightshift", "queue");
    await writeJsonFile(path.join(queueDir, "ns-task0001.json"), {
      id: "ns-task0001",
      name: "task-1",
      origin: "one-off",
      prompt: "Do something",
      status: "pending",
      timeout: "10m",
      createdAt: new Date().toISOString(),
    });

    const res = await run(["status"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Pending");
    expect(res.stdout).toContain("1");
  });
});
