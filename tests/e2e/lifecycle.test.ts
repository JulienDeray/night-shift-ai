import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  startDaemon,
  stopDaemon,
  killDaemon,
  type DaemonHandle,
} from "./helpers/daemon.js";
import { writeE2EConfig } from "./helpers/config.js";
import { run } from "./helpers/cli.js";
import { createNtfyMockServer, type NtfyMockServer } from "./helpers/ntfy-server.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const MOCK_CLAUDE_DIR = path.join(
  PROJECT_ROOT,
  "tests/e2e/fixtures/mock-claude",
);

describe("daemon lifecycle", () => {
  let tmpDir: string;
  let ntfyServer: NtfyMockServer;
  let daemonEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-e2e-lifecycle-"));

    ntfyServer = await createNtfyMockServer();

    await writeE2EConfig(tmpDir, {
      ntfyPort: ntfyServer.port,
      agentNames: ["happy-path-agent"],
    });

    // Ensure mock claude shim is executable
    await fs.chmod(path.join(MOCK_CLAUDE_DIR, "claude"), 0o755);

    // Build env with mock-claude dir prepended to PATH
    daemonEnv = {
      ...process.env,
      PATH: `${MOCK_CLAUDE_DIR}:${process.env.PATH ?? ""}`,
    };
  });

  afterEach(async () => {
    // Safety net: kill daemon unconditionally (idempotent)
    await killDaemon(tmpDir);

    await ntfyServer.close();

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("starts daemon and writes heartbeat to daemon.json", async () => {
    const handle: DaemonHandle = await startDaemon(tmpDir, daemonEnv);

    // daemon.json should show running status
    const daemonJsonPath = path.join(tmpDir, ".nightshift", "daemon.json");
    const raw = await fs.readFile(daemonJsonPath, "utf-8");
    const state = JSON.parse(raw) as {
      status: string;
      lastHeartbeat: string;
      pid: number;
    };

    expect(state.status).toBe("running");

    const heartbeatAge = Date.now() - new Date(state.lastHeartbeat).getTime();
    expect(heartbeatAge).toBeLessThan(5000);

    // daemon.pid should contain a number
    const pidPath = path.join(tmpDir, ".nightshift", "daemon.pid");
    const pidContent = await fs.readFile(pidPath, "utf-8");
    const pid = parseInt(pidContent.trim(), 10);
    expect(pid).toBeGreaterThan(0);
    expect(pid).toBe(handle.pid);

    await stopDaemon(tmpDir);
  });

  it("stops daemon gracefully via CLI", async () => {
    const handle: DaemonHandle = await startDaemon(tmpDir, daemonEnv);
    const daemonPid = handle.pid!;

    await stopDaemon(tmpDir);

    // After stop, the process should no longer be alive
    let processAlive = true;
    try {
      process.kill(daemonPid, 0);
    } catch {
      processAlive = false;
    }
    expect(processAlive).toBe(false);
  });

  it("recovers from crash (SIGKILL)", async () => {
    const handle1: DaemonHandle = await startDaemon(tmpDir, daemonEnv);
    const firstPid = handle1.pid!;
    expect(firstPid).toBeGreaterThan(0);

    // SIGKILL the daemon
    await killDaemon(tmpDir);

    // Wait for process to die
    await new Promise<void>((r) => setTimeout(r, 500));

    // Confirm first daemon is dead
    let firstAlive = true;
    try {
      process.kill(firstPid, 0);
    } catch {
      firstAlive = false;
    }
    expect(firstAlive).toBe(false);

    // Start daemon again — should succeed (stale PID detected and cleaned up
    // by health module when orchestrator starts and writes a new state)
    const handle2: DaemonHandle = await startDaemon(tmpDir, daemonEnv);
    expect(handle2.pid).toBeGreaterThan(0);

    // Verify the new daemon is actually running (OS may reuse PIDs, so we
    // check liveness rather than asserting the PID must be different)
    let newDaemonAlive = false;
    try {
      process.kill(handle2.pid!, 0);
      newDaemonAlive = true;
    } catch {
      newDaemonAlive = false;
    }
    expect(newDaemonAlive).toBe(true);

    await stopDaemon(tmpDir);
  });

  it("status command shows running daemon", async () => {
    await startDaemon(tmpDir, daemonEnv);

    const result = await run(["status"], { cwd: tmpDir, env: daemonEnv });

    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output.toLowerCase()).toMatch(/running/);

    await stopDaemon(tmpDir);
  });
});
