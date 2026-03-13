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
daemon:
  poll_interval_ms: 30000
  heartbeat_interval_ms: 10000
  log_retention_days: 30
agents_dir: ./agents
agents: []
schedule: []
one_off_defaults:
  timeout: "30m"
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

  it("lists pending tasks with ID, name, and agent", async () => {
    const queueDir = path.join(tmpDir, ".nightshift", "queue");
    await writeJsonFile(path.join(queueDir, "ns-aaa00001.json"), {
      id: "ns-aaa00001",
      name: "lint-check",
      origin: "one-off",
      prompt: "Run lint",
      status: "pending",
      timeout: "10m",
      createdAt: new Date().toISOString(),
      agentName: "code-agent",
    });
    await writeJsonFile(path.join(queueDir, "ns-aaa00002.json"), {
      id: "ns-aaa00002",
      name: "deploy-staging",
      origin: "one-off",
      prompt: "Deploy to staging",
      status: "pending",
      timeout: "10m",
      createdAt: new Date().toISOString(),
      agentName: "deploy-agent",
    });

    const res = await run(["status"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("ns-aaa00001");
    expect(res.stdout).toContain("lint-check");
    expect(res.stdout).toContain("code-agent");
    expect(res.stdout).toContain("ns-aaa00002");
    expect(res.stdout).toContain("deploy-staging");
    expect(res.stdout).toContain("deploy-agent");
  });

  it("lists running tasks when daemon is active", async () => {
    const state: DaemonState = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      activeTasks: 1,
      totalExecuted: 5,
      totalCostUsd: 1.23,
      status: "running",
    };
    await writeJsonFile(path.join(tmpDir, ".nightshift", "daemon.json"), state);

    const queueDir = path.join(tmpDir, ".nightshift", "queue");
    await writeJsonFile(path.join(queueDir, "ns-bbb00001.json"), {
      id: "ns-bbb00001",
      name: "build-task",
      origin: "one-off",
      prompt: "Build the project",
      status: "running",
      timeout: "20m",
      createdAt: new Date().toISOString(),
      agentName: "build-agent",
    });

    const res = await run(["status"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("ns-bbb00001");
    expect(res.stdout).toContain("running");
  });

  it("shows no task table when queue is empty", async () => {
    const res = await run(["status"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Pending");
    // No table headers should appear when queue is empty
    expect(res.stdout).not.toContain("│ ID");
    expect(res.stdout).not.toContain("│ Name");
  });
});
