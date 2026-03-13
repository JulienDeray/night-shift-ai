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
 * Polls the inbox directory every 300ms until a file matching the given pattern
 * appears, or until maxWaitMs elapses.
 */
async function waitForInboxReport(
  tmpDir: string,
  agentPattern: RegExp,
  maxWaitMs = 45_000,
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

describe("error scenarios", () => {
  let tmpDir: string;
  let ntfyServer: NtfyMockServer;
  let daemonEnv: NodeJS.ProcessEnv;
  let _daemon: DaemonHandle;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-e2e-error-"));

    ntfyServer = await createNtfyMockServer();

    await writeE2EConfig(tmpDir, {
      ntfyPort: ntfyServer.port,
      agentNames: [
        "multi-step-failure-agent",
        "retry-agent",
        "timeout-agent",
        "happy-path-agent",
      ],
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
    // Safety net: kill daemon unconditionally
    await killDaemon(tmpDir);
    await ntfyServer.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("semantic failure — agent returns status:FAILED produces failed report with error message", async () => {
    // Submit multi-step-failure-agent
    const submitResult = await run(
      ["submit", "--agent", "multi-step-failure-agent"],
      { cwd: tmpDir, env: daemonEnv },
    );
    expect(submitResult.exitCode).toBe(0);

    // Wait for inbox report
    const reportPath = await waitForInboxReport(
      tmpDir,
      /multi-step-failure-agent/,
    );

    // Read and verify report content
    const reportContent = await fs.readFile(reportPath, "utf-8");

    // Status should be failed
    expect(reportContent).toMatch(/status: failed/);

    // step1 should show FAILED status in step listing
    expect(reportContent).toMatch(/step1.*FAILED/);

    // step2 should appear as SKIPPED (step1 caused semantic failure, step2 should not run)
    expect(reportContent).toMatch(/step2.*SKIPPED/);

    // Verify ntfy mock received a notification
    const requests = ntfyServer.getRequests();
    expect(requests.length).toBeGreaterThan(0);
    const bodies = requests.map((r) => JSON.stringify(r.body));
    const hasAgentRef = bodies.some((b) => b.includes("multi-step-failure-agent"));
    expect(hasAgentRef).toBe(true);
  });

  it("timeout — agent exceeds step timeout produces failed report with timeout info", async () => {
    // Submit timeout-agent
    const submitResult = await run(
      ["submit", "--agent", "timeout-agent"],
      { cwd: tmpDir, env: daemonEnv },
    );
    expect(submitResult.exitCode).toBe(0);

    // Wait for inbox report — generous timeout since daemon needs to detect 2s timeout
    const reportPath = await waitForInboxReport(
      tmpDir,
      /timeout-agent/,
      45_000,
    );

    // Read and verify report content
    const reportContent = await fs.readFile(reportPath, "utf-8");

    // Status should be failed (timeout results in FATAL)
    expect(reportContent).toMatch(/status: failed/);

    // Report should contain timeout-related information
    expect(reportContent).toMatch(/timed out|timeout/i);

    // Verify ntfy mock received a notification
    const requests = ntfyServer.getRequests();
    expect(requests.length).toBeGreaterThan(0);
    const bodies = requests.map((r) => JSON.stringify(r.body));
    const hasAgentRef = bodies.some((b) => b.includes("timeout-agent"));
    expect(hasAgentRef).toBe(true);
  });

  it("retry exhaustion — retry-agent exhausts maxAttempts and completes", async () => {
    // Submit retry-agent
    const submitResult = await run(
      ["submit", "--agent", "retry-agent"],
      { cwd: tmpDir, env: daemonEnv },
    );
    expect(submitResult.exitCode).toBe(0);

    // Wait for inbox report
    const reportPath = await waitForInboxReport(
      tmpDir,
      /retry-agent/,
    );

    // Read and verify report content
    const reportContent = await fs.readFile(reportPath, "utf-8");

    // After retry exhaustion, engine falls through and returns SUCCESS
    // The report should show completed status
    expect(reportContent).toMatch(/status: completed/);

    // Agent name should be in the report
    expect(reportContent).toMatch(/agent_name: retry-agent/);

    // Multiple steps were executed (work+review+work+review+work+review = 6 entries)
    // At minimum the step count should be > 2 due to retries
    const stepCountMatch = reportContent.match(/step_count: (\d+)/);
    expect(stepCountMatch).not.toBeNull();
    const stepCount = parseInt(stepCountMatch![1], 10);
    expect(stepCount).toBeGreaterThan(2);

    // Verify ntfy mock received notifications
    const requests = ntfyServer.getRequests();
    expect(requests.length).toBeGreaterThan(0);
    const bodies = requests.map((r) => JSON.stringify(r.body));
    const hasAgentRef = bodies.some((b) => b.includes("retry-agent"));
    expect(hasAgentRef).toBe(true);
  });
});
