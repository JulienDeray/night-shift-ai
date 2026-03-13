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

describe("happy path — full pipeline", () => {
  let tmpDir: string;
  let ntfyServer: NtfyMockServer;
  let daemonEnv: NodeJS.ProcessEnv;
  let _daemon: DaemonHandle;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-e2e-happy-"));

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

  it("submits agent, daemon executes, inbox report generated with correct metadata, ntfy notified", async () => {
    // 1. Submit the happy-path agent
    const submitResult = await run(
      ["submit", "--agent", "happy-path-agent"],
      { cwd: tmpDir, env: daemonEnv },
    );
    expect(submitResult.exitCode).toBe(0);
    expect(submitResult.stdout).toMatch(/queued/i);

    // 2. Wait for inbox report to appear
    const reportPath = await waitForInboxReport(
      tmpDir,
      /happy-path-agent/,
    );
    expect(reportPath).toBeTruthy();

    // 3. Read and verify report content
    const reportContent = await fs.readFile(reportPath, "utf-8");

    // Check YAML frontmatter fields
    expect(reportContent).toMatch(/status: completed/);
    expect(reportContent).toMatch(/agent_name: happy-path-agent/);
    expect(reportContent).toMatch(/step_count: 1/);

    // Check mock output is present in the report body
    expect(reportContent).toMatch(/mock success output/);

    // 4. Verify ntfy mock server received notifications
    const requests = ntfyServer.getRequests();
    expect(requests.length).toBeGreaterThanOrEqual(2);

    // At least one request should reference the agent name
    const bodies = requests.map((r) => JSON.stringify(r.body));
    const hasAgentRef = bodies.some((b) => b.includes("happy-path-agent"));
    expect(hasAgentRef).toBe(true);
  });

  it("no real claude binary was called — only mock shim on PATH", async () => {
    // Submit and wait for completion — if real claude were called it would
    // fail (not installed / no credentials). Mock shim succeeds, proving only
    // the shim was invoked.
    const submitResult = await run(
      ["submit", "--agent", "happy-path-agent"],
      { cwd: tmpDir, env: daemonEnv },
    );
    expect(submitResult.exitCode).toBe(0);

    // Inbox report appears only if mock shim succeeded
    const reportPath = await waitForInboxReport(
      tmpDir,
      /happy-path-agent/,
    );
    const reportContent = await fs.readFile(reportPath, "utf-8");
    expect(reportContent).toMatch(/status: completed/);
  });
});
