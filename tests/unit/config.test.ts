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

  it("loads config with ntfy block", async () => {
    const yaml = `
workspace: ./w
ntfy:
  topic: night-shift
  token: tk_abc
  base_url: https://custom.ntfy.sh
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);

    const config = await loadConfig(tmpDir);

    expect(config.ntfy).toBeDefined();
    expect(config.ntfy!.topic).toBe("night-shift");
    expect(config.ntfy!.token).toBe("tk_abc");
    expect(config.ntfy!.baseUrl).toBe("https://custom.ntfy.sh");
  });

  it("applies default base_url for ntfy", async () => {
    const yaml = `
workspace: ./w
ntfy:
  topic: test
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);

    const config = await loadConfig(tmpDir);

    expect(config.ntfy!.baseUrl).toBe("https://ntfy.sh");
  });

  it("loads config without ntfy block", async () => {
    const yaml = `
workspace: ./w
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);

    const config = await loadConfig(tmpDir);

    expect(config.ntfy).toBeUndefined();
  });

  it("loads config with code_agent block", async () => {
    const yaml = `
workspace: ./w
code_agent:
  repo_url: git@gitlab.com:team/repo.git
  confluence_page_id: "123456"
  category_schedule:
    monday: [tests]
    tuesday: [refactoring]
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);

    const config = await loadConfig(tmpDir);

    expect(config.codeAgent).toBeDefined();
    expect(config.codeAgent!.repoUrl).toBe("git@gitlab.com:team/repo.git");
    expect(config.codeAgent!.confluencePageId).toBe("123456");
    expect(config.codeAgent!.categorySchedule.monday).toEqual(["tests"]);
  });

  it("rejects invalid repo_url (not SSH)", async () => {
    const yaml = `
workspace: ./w
code_agent:
  repo_url: https://gitlab.com/team/repo.git
  confluence_page_id: "123"
  category_schedule:
    monday: [tests]
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);

    await expect(loadConfig(tmpDir)).rejects.toThrow("Invalid config");
  });

  it("rejects unknown day name in category_schedule", async () => {
    const yaml = `
workspace: ./w
code_agent:
  repo_url: git@gitlab.com:team/repo.git
  confluence_page_id: "123"
  category_schedule:
    munday: [tests]
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);

    await expect(loadConfig(tmpDir)).rejects.toThrow();
  });

  it("loads recurring task with notify flag", async () => {
    const yaml = `
workspace: ./w
recurring:
  - name: "test-task"
    schedule: "0 6 * * *"
    prompt: "Do something"
    notify: true
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);

    const config = await loadConfig(tmpDir);

    expect(config.recurring[0].notify).toBe(true);
  });

  it("notify defaults to undefined when not specified", async () => {
    const yaml = `
workspace: ./w
recurring:
  - name: "test-task"
    schedule: "0 6 * * *"
    prompt: "Do something"
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);

    const config = await loadConfig(tmpDir);

    expect(config.recurring[0].notify).toBeUndefined();
  });

  it("loads config without code_agent block", async () => {
    const yaml = `
workspace: ./w
`;
    await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);

    const config = await loadConfig(tmpDir);

    expect(config.codeAgent).toBeUndefined();
  });

  it("getDefaultConfigYaml includes ntfy and code_agent examples", () => {
    const yaml = getDefaultConfigYaml();

    expect(yaml).toContain("ntfy:");
    expect(yaml).toContain("topic:");
    expect(yaml).toContain("code_agent:");
    expect(yaml).toContain("repo_url:");
    expect(yaml).toContain("category_schedule:");
  });
});
