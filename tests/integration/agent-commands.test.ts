import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnWithTimeout } from "../../src/utils/process.js";
import { stringify as stringifyYaml } from "yaml";

describe("agent CLI commands", () => {
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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-agent-integ-"));
    // Create minimal project structure
    await fs.writeFile(
      path.join(tmpDir, "nightshift.yaml"),
      stringifyYaml({
        workspace: "./workspace",
        max_concurrent: 2,
        agents_dir: "./agents",
        agents: [],
        schedule: [],
      }),
      "utf-8",
    );
    await fs.mkdir(path.join(tmpDir, ".nightshift", "logs"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, ".nightshift", "inbox"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, ".nightshift", "queue"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "agents"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── agent init ──────────────────────────────────────────────────────────────

  it("agent init creates agent directory and exits 0", async () => {
    const res = await run(["agent", "init", "test-agent"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("test-agent");

    // Verify directory was created
    const stat = await fs.stat(path.join(tmpDir, "agents", "test-agent"));
    expect(stat.isDirectory()).toBe(true);

    // Verify manifest exists
    await expect(
      fs.access(path.join(tmpDir, "agents", "test-agent", "manifest.yaml")),
    ).resolves.toBeUndefined();
  });

  it("agent init (second time, no --force) exits 1", async () => {
    await run(["agent", "init", "test-agent"]);
    const res = await run(["agent", "init", "test-agent"]);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("already exists");
  });

  it("agent init --force succeeds on existing directory", async () => {
    await run(["agent", "init", "test-agent"]);
    const res = await run(["agent", "init", "test-agent", "--force"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("test-agent");
  });

  // ── agent validate ──────────────────────────────────────────────────────────

  it("agent validate exits 0 after init (scaffolded agent is valid)", async () => {
    await run(["agent", "init", "test-agent"]);
    const res = await run(["agent", "validate", "test-agent"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Schema: valid");
    expect(res.stdout).toContain("Prompts: all files present");
  });

  it("agent validate exits 1 for nonexistent agent", async () => {
    const res = await run(["agent", "validate", "nonexistent-agent"]);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("cannot read manifest.yaml");
  });

  // ── agent list ──────────────────────────────────────────────────────────────

  it("agent list shows the initialized agent in table output", async () => {
    await run(["agent", "init", "test-agent"]);
    const res = await run(["agent", "list"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("test-agent");
    expect(res.stdout).toContain("Name");
    expect(res.stdout).toContain("Steps");
  });

  it("agent list --json outputs valid JSON array", async () => {
    await run(["agent", "init", "test-agent"]);
    const res = await run(["agent", "list", "--json"]);

    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty("name", "test-agent");
    expect(parsed[0]).toHaveProperty("steps");
  });

  it("agent list with no agents shows helpful empty message", async () => {
    // Fresh tmpDir already has empty agents directory
    const res = await run(["agent", "list"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("No agents found");
  });

  // ── agent show ──────────────────────────────────────────────────────────────

  it("agent show displays manifest summary and step pipeline", async () => {
    await run(["agent", "init", "test-agent"]);
    const res = await run(["agent", "show", "test-agent"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("test-agent");
    expect(res.stdout).toContain("Manifest Summary");
    expect(res.stdout).toContain("Step Pipeline");
    expect(res.stdout).toContain("analyze");
  });
});
