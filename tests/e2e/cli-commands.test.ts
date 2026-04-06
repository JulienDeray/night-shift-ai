import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  startDaemon,
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

/**
 * Polls the inbox directory every 300ms until a file matching the given agent
 * name pattern appears, or until maxWaitMs elapses.
 */
async function waitForInboxReport(
  tmpDir: string,
  agentPattern: RegExp,
  maxWaitMs = 30_000,
): Promise<string> {
  const inboxDir = path.join(tmpDir, ".nightshift", "inbox");
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      const files = await fs.readdir(inboxDir);
      const match = files.find((f) => agentPattern.test(f));
      if (match) {
        return path.join(inboxDir, match);
      }
    } catch {
      // dir not yet created — keep polling
    }
    await new Promise<void>((r) => setTimeout(r, 300));
  }

  throw new Error(
    `No inbox report matching ${agentPattern} appeared within ${maxWaitMs}ms`,
  );
}

describe("CLI commands", () => {
  let tmpDir: string;
  let ntfyServer: NtfyMockServer;
  let daemonEnv: NodeJS.ProcessEnv;
  let _daemon: DaemonHandle;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-e2e-cli-"));

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

    _daemon = await startDaemon(tmpDir, daemonEnv);
  });

  afterEach(async () => {
    await killDaemon(tmpDir);
    await ntfyServer.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("status shows running daemon with PID and uptime", async () => {
    const result = await run(["status"], { cwd: tmpDir, env: daemonEnv });

    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;

    // Should show "running" status
    expect(output.toLowerCase()).toMatch(/running/);

    // Should show a numeric PID
    expect(output).toMatch(/\bPID\b.*\d+/i);

    // Should show uptime or heartbeat info
    expect(output).toMatch(/uptime|heartbeat|active|executed/i);
  });

  it("submit queues a task and returns task ID", async () => {
    const result = await run(
      ["submit", "--agent", "happy-path-agent"],
      { cwd: tmpDir, env: daemonEnv },
    );

    expect(result.exitCode).toBe(0);

    // Output should contain "queued" and a UUID task ID
    expect(result.stdout).toMatch(/queued/i);
    expect(result.stdout).toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);

    // A task file should appear in the queue (daemon may pick it up quickly)
    // We verify the task was queued by checking the stdout contains a valid task ID
    const match = result.stdout.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
    expect(match).toBeTruthy();
    const taskId = match![0];
    expect(taskId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  });

  it("cancel removes a pending task before daemon picks it up", async () => {
    // Use a very short poll interval config to make timing harder — instead we
    // use a separate config with max_concurrent: 0 to ensure task stays pending.
    // However, changing mid-test is complex. Instead, we submit and immediately
    // cancel — the daemon's poll interval is 500ms, giving us a window.

    // Create a fresh tmpDir with max_concurrent: 0 to keep tasks pending
    const cancelTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-e2e-cancel-"));
    try {
      await writeE2EConfig(cancelTmpDir, {
        ntfyPort: ntfyServer.port,
        agentNames: ["happy-path-agent"],
        pollIntervalMs: 60000, // very long poll — task stays pending
      });

      await fs.chmod(path.join(MOCK_CLAUDE_DIR, "claude"), 0o755);

      const cancelDaemonEnv = {
        ...process.env,
        PATH: `${MOCK_CLAUDE_DIR}:${process.env.PATH ?? ""}`,
      };

      // Start a separate daemon with long poll interval
      const { startDaemon: sd } = await import("./helpers/daemon.js");
      const cancelDaemon = await sd(cancelTmpDir, cancelDaemonEnv);
      expect(cancelDaemon.pid).toBeGreaterThan(0);

      try {
        // Submit a task
        const submitResult = await run(
          ["submit", "--agent", "happy-path-agent"],
          { cwd: cancelTmpDir, env: cancelDaemonEnv },
        );
        expect(submitResult.exitCode).toBe(0);

        // Extract task ID from submit output
        const taskIdMatch = submitResult.stdout.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
        expect(taskIdMatch).toBeTruthy();
        const taskId = taskIdMatch![0];

        // Verify the task file exists in the queue
        const queueDir = path.join(cancelTmpDir, ".nightshift", "queue");
        const queueFiles = await fs.readdir(queueDir);
        const taskFile = queueFiles.find((f) => f.includes(taskId));
        expect(taskFile).toBeTruthy();

        // Cancel the task
        const cancelResult = await run(
          ["cancel", taskId],
          { cwd: cancelTmpDir, env: cancelDaemonEnv },
        );
        expect(cancelResult.exitCode).toBe(0);
        expect(cancelResult.stdout).toMatch(/cancelled/i);

        // Task file should be removed from queue
        const queueFilesAfter = await fs.readdir(queueDir).catch(() => []);
        const taskFileAfter = queueFilesAfter.find((f) => f.includes(taskId));
        expect(taskFileAfter).toBeUndefined();
      } finally {
        const { killDaemon: kd } = await import("./helpers/daemon.js");
        await kd(cancelTmpDir);
      }
    } finally {
      await fs.rm(cancelTmpDir, { recursive: true, force: true });
    }
  });

  it("schedule shows schedule entries (empty schedule)", async () => {
    const result = await run(["schedule"], { cwd: tmpDir, env: daemonEnv });

    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;

    // Should mention schedule or show empty message
    expect(output).toMatch(/schedule|no schedule/i);
  });

  it("inbox lists completed reports after task finishes", async () => {
    // Submit agent and wait for inbox report
    const submitResult = await run(
      ["submit", "--agent", "happy-path-agent"],
      { cwd: tmpDir, env: daemonEnv },
    );
    expect(submitResult.exitCode).toBe(0);

    // Wait for task to complete
    await waitForInboxReport(tmpDir, /happy-path-agent/);

    // Run inbox command
    const inboxResult = await run(["inbox"], { cwd: tmpDir, env: daemonEnv });
    expect(inboxResult.exitCode).toBe(0);

    const output = inboxResult.stdout + inboxResult.stderr;
    // Should show inbox header and the report entry
    expect(output).toMatch(/inbox/i);
    // Should list the happy-path-agent task
    expect(output).toMatch(/happy-path-agent/i);
  });

  it("inbox --read shows report content", async () => {
    // Submit and wait for report
    const submitResult = await run(
      ["submit", "--agent", "happy-path-agent"],
      { cwd: tmpDir, env: daemonEnv },
    );
    expect(submitResult.exitCode).toBe(0);

    const reportPath = await waitForInboxReport(tmpDir, /happy-path-agent/);
    const reportFileName = path.basename(reportPath);

    // Run inbox --read <filename>
    const readResult = await run(
      ["inbox", "--read", reportFileName],
      { cwd: tmpDir, env: daemonEnv },
    );
    expect(readResult.exitCode).toBe(0);

    const output = readResult.stdout + readResult.stderr;
    // Should contain the report frontmatter and content
    expect(output).toMatch(/status: completed/);
    expect(output).toMatch(/agent_name: happy-path-agent/);
    expect(output).toMatch(/mock success output/);
  });
});
