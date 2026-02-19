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
});
