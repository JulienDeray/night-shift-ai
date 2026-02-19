import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadConfig, validateConfig, getDefaultConfigYaml } from "../../src/core/config.js";

describe("config", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads default config from YAML", async () => {
    await fs.writeFile(
      path.join(tmpDir, "nightshift.yaml"),
      getDefaultConfigYaml(),
    );

    const config = await loadConfig(tmpDir);

    expect(config.workspace).toBe("./workspace");
    expect(config.inbox).toBe("./inbox");
    expect(config.maxConcurrent).toBe(2);
    expect(config.defaultTimeout).toBe("30m");
    expect(config.beads.enabled).toBe(true);
    expect(config.daemon.pollIntervalMs).toBe(30000);
    expect(config.daemon.heartbeatIntervalMs).toBe(10000);
    expect(config.daemon.logRetentionDays).toBe(30);
    expect(config.recurring).toEqual([]);
    expect(config.oneOffDefaults.timeout).toBe("30m");
    expect(config.oneOffDefaults.maxBudgetUsd).toBe(5.0);
  });

  it("loads config with recurring tasks", async () => {
    const yaml = `
workspace: ./work
max_concurrent: 4
recurring:
  - name: "test-task"
    schedule: "0 6 * * *"
    prompt: "Do something"
    allowed_tools:
      - "Read"
      - "Write"
    timeout: "15m"
    max_budget_usd: 2.00
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);

    const config = await loadConfig(tmpDir);

    expect(config.workspace).toBe("./work");
    expect(config.maxConcurrent).toBe(4);
    expect(config.recurring).toHaveLength(1);
    expect(config.recurring[0].name).toBe("test-task");
    expect(config.recurring[0].schedule).toBe("0 6 * * *");
    expect(config.recurring[0].prompt).toBe("Do something");
    expect(config.recurring[0].allowedTools).toEqual(["Read", "Write"]);
    expect(config.recurring[0].timeout).toBe("15m");
    expect(config.recurring[0].maxBudgetUsd).toBe(2.0);
  });

  it("applies defaults for missing optional fields", async () => {
    const yaml = `
workspace: ./w
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);

    const config = await loadConfig(tmpDir);

    expect(config.inbox).toBe("./inbox");
    expect(config.maxConcurrent).toBe(2);
    expect(config.defaultTimeout).toBe("30m");
    expect(config.beads.enabled).toBe(true);
    expect(config.daemon.pollIntervalMs).toBe(30000);
  });

  it("throws on missing config file", async () => {
    await expect(loadConfig(tmpDir)).rejects.toThrow("Config file not found");
  });

  it("throws on invalid YAML", async () => {
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), "{{invalid");

    await expect(loadConfig(tmpDir)).rejects.toThrow("Invalid YAML");
  });

  it("throws on invalid config values", async () => {
    const yaml = `
max_concurrent: -1
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);

    await expect(loadConfig(tmpDir)).rejects.toThrow("Invalid config");
  });

  it("validates valid config", async () => {
    await fs.writeFile(
      path.join(tmpDir, "nightshift.yaml"),
      getDefaultConfigYaml(),
    );

    const result = await validateConfig(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.config).toBeDefined();
  });

  it("validates invalid config", async () => {
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), "max_concurrent: -1");

    const result = await validateConfig(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});
