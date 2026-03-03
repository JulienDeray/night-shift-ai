import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnWithTimeout } from "../../src/utils/process.js";

describe("nightshift run", () => {
  let tmpDir: string;
  const bin = path.resolve("bin/nightshift.ts");

  function run(
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const { result } = spawnWithTimeout("npx", ["tsx", bin, ...args], {
      timeoutMs: 15000,
      cwd: tmpDir,
    });
    return result;
  }

  async function writeConfig(overrides: string = ""): Promise<void> {
    const config = `workspace: ./workspace
inbox: ./inbox
max_concurrent: 2
default_timeout: "30m"

beads:
  enabled: false

daemon:
  poll_interval_ms: 30000
  heartbeat_interval_ms: 10000
  log_retention_days: 30

agents_dir: ./agents
agents: []
schedule: []

one_off_defaults:
  timeout: "30m"
  max_budget_usd: 5.00
${overrides}`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), config);
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-run-"));
    await run(["init"]);
    await writeConfig();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("--help exits 0 and shows usage text", async () => {
    const res = await run(["run", "--help"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("nightshift run");
    expect(res.stdout).toContain("--agent");
  });

  it("--help shows expected flags", async () => {
    const res = await run(["run", "--help"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("--agent");
    expect(res.stdout).toContain("--var");
    expect(res.stdout).toContain("--notify");
  });

  it("requires --agent flag", async () => {
    const res = await run(["run"]);

    expect(res.exitCode).not.toBe(0);
    const combined = res.stdout + res.stderr;
    expect(combined.toLowerCase()).toMatch(/agent|required/);
  });

  it("fails gracefully without config", async () => {
    await fs.unlink(path.join(tmpDir, "nightshift.yaml"));
    const res = await run(["run", "--agent", "code-agent"]);

    expect(res.exitCode).not.toBe(0);
  });

  it("fails gracefully when agent directory does not exist", async () => {
    const res = await run(["run", "--agent", "nonexistent-agent"]);

    // Should exit non-zero (agent dir not found)
    expect(res.exitCode).not.toBe(0);
  });
});
