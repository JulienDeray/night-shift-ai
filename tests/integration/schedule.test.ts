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

  it("shows 'No recurring tasks' when none are configured", async () => {
    const res = await run(["schedule"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("No recurring tasks");
  });

  it("displays recurring tasks in a table with next run time", async () => {
    const configYaml = `workspace: ./workspace
max_concurrent: 2
beads:
  enabled: false
daemon:
  poll_interval_ms: 30000
  heartbeat_interval_ms: 10000
  log_retention_days: 30
recurring:
  - name: "daily-standup"
    schedule: "30 9 * * 1-5"
    prompt: "Prepare standup notes"
    timeout: "15m"
    max_budget_usd: 2.00
one_off_defaults:
  timeout: "30m"
  max_budget_usd: 5.00
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), configYaml);

    const res = await run(["schedule"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("daily-standup");
    expect(res.stdout).toContain("30 9 * * 1-5");
    expect(res.stdout).toContain("15m");
    expect(res.stdout).toContain("$2.00");
  });

  it("uses default timeout when task has no explicit timeout", async () => {
    const configYaml = `workspace: ./workspace
max_concurrent: 2
default_timeout: "45m"
beads:
  enabled: false
daemon:
  poll_interval_ms: 30000
  heartbeat_interval_ms: 10000
  log_retention_days: 30
recurring:
  - name: "no-timeout-task"
    schedule: "0 3 * * *"
    prompt: "Do something"
one_off_defaults:
  timeout: "30m"
  max_budget_usd: 5.00
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), configYaml);

    const res = await run(["schedule"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("no-timeout-task");
    expect(res.stdout).toContain("45m");
  });
});
