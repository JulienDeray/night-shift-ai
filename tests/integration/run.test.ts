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

recurring: []

one_off_defaults:
  timeout: "30m"
  max_budget_usd: 5.00
${overrides}`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), config);
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-run-"));
    // init so directory structure exists
    await run(["init"]);
    // overwrite config with beads disabled
    await writeConfig();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("--help exits 0 and shows usage text", async () => {
    const res = await run(["run", "--help"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("nightshift run");
    expect(res.stdout).toContain("[prompt]");
    expect(res.stdout).toContain("--code-agent");
  });

  it("--help shows all expected flags", async () => {
    const res = await run(["run", "--help"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("--timeout");
    expect(res.stdout).toContain("--budget");
    expect(res.stdout).toContain("--model");
    expect(res.stdout).toContain("--tools");
    expect(res.stdout).toContain("--code-agent");
    expect(res.stdout).toContain("--notify");
  });

  it("requires a prompt argument in generic mode", async () => {
    const res = await run(["run"]);

    // Should exit non-zero with meaningful error
    expect(res.exitCode).not.toBe(0);
    const combined = res.stdout + res.stderr;
    // Error about missing prompt
    expect(combined.toLowerCase()).toMatch(/prompt|required|argument/);
  });

  it("fails gracefully when claude is not available", async () => {
    // claude binary won't be available in CI, so this should fail gracefully
    const res = await run(["run", "echo hello"]);

    // Should exit non-zero (claude not found)
    expect(res.exitCode).not.toBe(0);
    const combined = res.stdout + res.stderr;
    // Should have a meaningful error, not a crash/stack trace
    expect(combined.length).toBeGreaterThan(0);
  });

  it("--code-agent without code_agent config exits non-zero with 'not configured' message", async () => {
    // Config has no code_agent section
    const res = await run(["run", "--code-agent"]);

    expect(res.exitCode).not.toBe(0);
    const combined = res.stdout + res.stderr;
    expect(combined.toLowerCase()).toContain("not configured");
  });

  it("--code-agent with a prompt argument produces an error", async () => {
    const res = await run(["run", "--code-agent", "some prompt"]);

    expect(res.exitCode).not.toBe(0);
    const combined = res.stdout + res.stderr;
    // Should mention the conflict
    expect(combined.toLowerCase()).toMatch(/code-agent|prompt|cannot/);
  });

  it("fails gracefully without config", async () => {
    await fs.unlink(path.join(tmpDir, "nightshift.yaml"));
    const res = await run(["run", "Do something"]);

    expect(res.exitCode).not.toBe(0);
  });
});
