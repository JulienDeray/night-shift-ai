import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  writePidFile,
  readPidFile,
  removePidFile,
  writeDaemonState,
  readDaemonState,
  isDaemonRunning,
} from "../../src/daemon/health.js";
import type { DaemonState } from "../../src/core/types.js";

describe("health", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-health-"));
    await fs.mkdir(path.join(tmpDir, ".nightshift"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes and reads PID file", async () => {
    await writePidFile(12345, tmpDir);
    const pid = await readPidFile(tmpDir);
    expect(pid).toBe(12345);
  });

  it("removes PID file", async () => {
    await writePidFile(12345, tmpDir);
    await removePidFile(tmpDir);
    const pid = await readPidFile(tmpDir);
    expect(pid).toBeNull();
  });

  it("returns null for missing PID file", async () => {
    const pid = await readPidFile(tmpDir);
    expect(pid).toBeNull();
  });

  it("writes and reads daemon state", async () => {
    const state: DaemonState = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      activeTasks: 1,
      totalExecuted: 5,
      totalCostUsd: 2.34,
      status: "running",
    };

    await writeDaemonState(state, tmpDir);
    const read = await readDaemonState(tmpDir);

    expect(read).toEqual(state);
  });

  it("detects running daemon via isDaemonRunning", () => {
    const state: DaemonState = {
      pid: process.pid, // current process is alive
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      activeTasks: 0,
      totalExecuted: 0,
      totalCostUsd: 0,
      status: "running",
    };

    expect(isDaemonRunning(state)).toBe(true);
  });

  it("detects stopped daemon", () => {
    const state: DaemonState = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      activeTasks: 0,
      totalExecuted: 0,
      totalCostUsd: 0,
      status: "stopped",
    };

    expect(isDaemonRunning(state)).toBe(false);
  });

  it("detects stale daemon (old heartbeat)", () => {
    const state: DaemonState = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date(Date.now() - 120000).toISOString(), // 2 minutes ago
      activeTasks: 0,
      totalExecuted: 0,
      totalCostUsd: 0,
      status: "running",
    };

    expect(isDaemonRunning(state)).toBe(false);
  });

  it("cleanupStaleState removes PID file and marks state as stopped", async () => {
    // Write a state that will be detected as stale (old heartbeat)
    const state: DaemonState = {
      pid: 999999, // unlikely to be a real process
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date(Date.now() - 120000).toISOString(),
      activeTasks: 0,
      totalExecuted: 3,
      totalCostUsd: 1.0,
      status: "running",
    };

    await writePidFile(999999, tmpDir);
    await writeDaemonState(state, tmpDir);

    const { cleanupStaleState } = await import("../../src/daemon/health.js");
    await cleanupStaleState(tmpDir);

    const pid = await readPidFile(tmpDir);
    expect(pid).toBeNull();

    const updatedState = await readDaemonState(tmpDir);
    expect(updatedState!.status).toBe("stopped");
    // Original data should be preserved
    expect(updatedState!.totalExecuted).toBe(3);
  });

  it("isDaemonRunning returns false when PID does not exist", () => {
    const state: DaemonState = {
      pid: 999999, // very likely not a real process
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      activeTasks: 0,
      totalExecuted: 0,
      totalCostUsd: 0,
      status: "running",
    };

    expect(isDaemonRunning(state)).toBe(false);
  });
});
