import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnWithTimeout } from "../../src/utils/process.js";

describe("nightshift schedule", () => {
  let tmpDir: string;
  const bin = path.resolve("bin/nightshift.ts");

  function run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const { result } = spawnWithTimeout("npx", ["tsx", bin, ...args], {
      timeoutMs: 15000,
      cwd: tmpDir,
    });
    return result;
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-sched-integ-"));
    await run(["init"]);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("shows 'No schedule entries configured' when none are configured", async () => {
    const res = await run(["schedule"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("No schedule entries configured");
  });

  it("displays schedule entries in a table with next run time", async () => {
    const configYaml = `workspace: ./workspace
max_concurrent: 2
beads:
  enabled: false
daemon:
  poll_interval_ms: 30000
  heartbeat_interval_ms: 10000
  log_retention_days: 30
agents_dir: ./agents
agents:
  - name: daily-standup
schedule:
  - agent: daily-standup
    cron: "30 9 * * 1-5"
    enabled: true
one_off_defaults:
  timeout: "30m"
  max_budget_usd: 5.00
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), configYaml);

    const res = await run(["schedule"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("daily-standup");
    expect(res.stdout).toContain("30 9 * * 1-5");
    expect(res.stdout).toContain("yes");
  });

  it("shows disabled for entries with enabled: false", async () => {
    const configYaml = `workspace: ./workspace
max_concurrent: 2
beads:
  enabled: false
daemon:
  poll_interval_ms: 30000
  heartbeat_interval_ms: 10000
  log_retention_days: 30
agents_dir: ./agents
agents:
  - name: active-agent
  - name: paused-agent
schedule:
  - agent: active-agent
    cron: "0 3 * * *"
    enabled: true
  - agent: paused-agent
    cron: "0 4 * * *"
    enabled: false
one_off_defaults:
  timeout: "30m"
  max_budget_usd: 5.00
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), configYaml);

    const res = await run(["schedule"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("active-agent");
    expect(res.stdout).toContain("paused-agent");
    expect(res.stdout).toContain("disabled");
  });
});
