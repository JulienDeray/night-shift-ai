import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnWithTimeout } from "../../src/utils/process.js";

describe("CLI integration", () => {
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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-integ-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("nightshift init creates directory structure and config", async () => {
    const res = await run(["init"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Initialized night-shift");

    // Verify files exist
    const configContent = await fs.readFile(
      path.join(tmpDir, "nightshift.yaml"),
      "utf-8",
    );
    expect(configContent).toContain("workspace: ./workspace");
    expect(configContent).toContain("max_concurrent: 2");

    const dirs = await fs.readdir(path.join(tmpDir, ".nightshift"));
    expect(dirs).toContain("inbox");
    expect(dirs).toContain("queue");
    expect(dirs).toContain("logs");
  });

  it("nightshift init --force overwrites existing config", async () => {
    // First init
    await run(["init"]);

    // Modify config
    await fs.writeFile(
      path.join(tmpDir, "nightshift.yaml"),
      "max_concurrent: 99\n",
    );

    // Init with force
    const res = await run(["init", "--force"]);
    expect(res.exitCode).toBe(0);

    // Config should be reset
    const content = await fs.readFile(
      path.join(tmpDir, "nightshift.yaml"),
      "utf-8",
    );
    expect(content).toContain("max_concurrent: 2");
  });

  it("nightshift init refuses to overwrite without --force", async () => {
    await run(["init"]);
    const res = await run(["init"]);

    expect(res.stdout).toContain("already exists");
  });

  it("nightshift config validate succeeds on valid config", async () => {
    await run(["init"]);
    const res = await run(["config", "validate"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("valid");
  });

  it("nightshift config validate fails on invalid config", async () => {
    await fs.writeFile(
      path.join(tmpDir, "nightshift.yaml"),
      "max_concurrent: -1\n",
    );

    const res = await run(["config", "validate"]);
    expect(res.exitCode).not.toBe(0);
  });

  it("nightshift config show displays resolved config", async () => {
    await run(["init"]);
    const res = await run(["config", "show"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("workspace");
    expect(res.stdout).toContain("maxConcurrent");
  });

  it("nightshift init prints next steps guidance", async () => {
    const res = await run(["init"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Next steps");
    expect(res.stdout).toContain("nightshift.yaml");
    expect(res.stdout).toContain("nightshift submit");
    expect(res.stdout).toContain("nightshift start");
  });
});
