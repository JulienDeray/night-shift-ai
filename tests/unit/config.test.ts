import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadConfig, validateConfig, getDefaultConfigYaml } from "../../src/core/config.js";

async function writeConfig(dir: string, yaml: string): Promise<void> {
  await fs.writeFile(path.join(dir, "nightshift.yaml"), yaml);
}

describe("config", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads default config from YAML", async () => {
    await writeConfig(tmpDir, getDefaultConfigYaml());

    const config = await loadConfig(tmpDir);

    expect(config.workspace).toBe("./workspace");
    expect(config.inbox).toBe("./inbox");
    expect(config.maxConcurrent).toBe(2);
    expect(config.defaultTimeout).toBe("30m");
    expect(config.daemon.pollIntervalMs).toBe(30000);
    expect(config.daemon.heartbeatIntervalMs).toBe(10000);
    expect(config.daemon.logRetentionDays).toBe(30);
    expect(config.agents).toEqual([]);
    expect(config.schedule).toEqual([]);
    expect(config.agentsDir).toBe("./agents");
    expect(config.oneOffDefaults.timeout).toBe("30m");
  });

  it("loads config with agents and schedule", async () => {
    const yaml = `
workspace: ./work
agents:
  - name: code-agent
    notify: true
    variables:
      repo_url: "git@gitlab.com:team/repo.git"
  - name: doc-agent
schedule:
  - agent: code-agent
    cron: "0 2 * * 1-5"
    enabled: true
    variables:
      category: "refactoring"
  - agent: doc-agent
    cron: "0 3 * * 6"
    enabled: false
`;
    await writeConfig(tmpDir, yaml);

    const config = await loadConfig(tmpDir);

    expect(config.agents).toHaveLength(2);
    expect(config.agents[0].name).toBe("code-agent");
    expect(config.agents[0].notify).toBe(true);
    expect(config.agents[0].variables).toEqual({ repo_url: "git@gitlab.com:team/repo.git" });
    expect(config.agents[1].name).toBe("doc-agent");

    expect(config.schedule).toHaveLength(2);
    expect(config.schedule[0].agent).toBe("code-agent");
    expect(config.schedule[0].cron).toBe("0 2 * * 1-5");
    expect(config.schedule[0].enabled).toBe(true);
    expect(config.schedule[0].variables).toEqual({ category: "refactoring" });
    expect(config.schedule[1].agent).toBe("doc-agent");
    expect(config.schedule[1].cron).toBe("0 3 * * 6");
    expect(config.schedule[1].enabled).toBe(false);
  });

  it("applies defaults for missing optional fields", async () => {
    const yaml = `
workspace: ./w
`;
    await writeConfig(tmpDir, yaml);

    const config = await loadConfig(tmpDir);

    expect(config.inbox).toBe("./inbox");
    expect(config.maxConcurrent).toBe(2);
    expect(config.defaultTimeout).toBe("30m");
    expect(config.daemon.pollIntervalMs).toBe(30000);
    expect(config.agentsDir).toBe("./agents");
    expect(config.agents).toEqual([]);
    expect(config.schedule).toEqual([]);
  });

  it("throws on missing config file", async () => {
    await expect(loadConfig(tmpDir)).rejects.toThrow("Config file not found");
  });

  it("throws on invalid YAML", async () => {
    await writeConfig(tmpDir, "{{invalid");

    await expect(loadConfig(tmpDir)).rejects.toThrow("Invalid YAML");
  });

  it("throws on invalid config values", async () => {
    const yaml = `
max_concurrent: -1
`;
    await writeConfig(tmpDir, yaml);

    await expect(loadConfig(tmpDir)).rejects.toThrow("Invalid config");
  });

  it("rejects unknown top-level keys (strict mode)", async () => {
    const yaml = `
workspace: ./w
code_agent:
  repo_url: git@gitlab.com:team/repo.git
  confluence_page_id: "123"
  category_schedule:
    monday: [tests]
`;
    await writeConfig(tmpDir, yaml);

    await expect(loadConfig(tmpDir)).rejects.toThrow(/Invalid config.*Unrecognized key/s);
  });

  it("rejects unknown top-level key recurring:", async () => {
    const yaml = `
workspace: ./w
recurring:
  - name: test-task
    schedule: "0 6 * * *"
    prompt: "Do something"
`;
    await writeConfig(tmpDir, yaml);

    await expect(loadConfig(tmpDir)).rejects.toThrow(/Invalid config.*Unrecognized key/s);
  });

  it("rejects duplicate agent names", async () => {
    const yaml = `
workspace: ./w
agents:
  - name: my-agent
  - name: my-agent
`;
    await writeConfig(tmpDir, yaml);

    await expect(loadConfig(tmpDir)).rejects.toThrow("Duplicate agent name");
  });

  it("rejects schedule referencing unknown agent", async () => {
    const yaml = `
workspace: ./w
agents:
  - name: a
schedule:
  - agent: b
    cron: "0 2 * * *"
`;
    await writeConfig(tmpDir, yaml);

    await expect(loadConfig(tmpDir)).rejects.toThrow("Schedule references unknown agent 'b'");
  });

  it("rejects invalid cron expression", async () => {
    const yaml = `
workspace: ./w
agents:
  - name: a
schedule:
  - agent: a
    cron: "not a cron"
`;
    await writeConfig(tmpDir, yaml);

    await expect(loadConfig(tmpDir)).rejects.toThrow("Invalid cron expression");
  });

  it("skips cron validation for disabled schedule entries", async () => {
    const yaml = `
workspace: ./w
agents:
  - name: a
schedule:
  - agent: a
    cron: "not a cron"
    enabled: false
`;
    await writeConfig(tmpDir, yaml);

    await expect(loadConfig(tmpDir)).resolves.toBeDefined();
  });

  it("validates valid config", async () => {
    await writeConfig(tmpDir, getDefaultConfigYaml());

    const result = await validateConfig(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.config).toBeDefined();
  });

  it("validates invalid config", async () => {
    await writeConfig(tmpDir, "max_concurrent: -1");

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
    await writeConfig(tmpDir, yaml);

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
    await writeConfig(tmpDir, yaml);

    const config = await loadConfig(tmpDir);

    expect(config.ntfy!.baseUrl).toBe("https://ntfy.sh");
  });

  it("loads config without ntfy block", async () => {
    const yaml = `
workspace: ./w
`;
    await writeConfig(tmpDir, yaml);

    const config = await loadConfig(tmpDir);

    expect(config.ntfy).toBeUndefined();
  });

  it("agent name must be kebab-case", async () => {
    const yaml = `
workspace: ./w
agents:
  - name: "My Agent"
`;
    await writeConfig(tmpDir, yaml);

    await expect(loadConfig(tmpDir)).rejects.toThrow("must be kebab-case");
  });

  it("schedule entry with variable overrides", async () => {
    const yaml = `
workspace: ./w
agents:
  - name: code-agent
schedule:
  - agent: code-agent
    cron: "0 2 * * 1-5"
    variables:
      category: "tests"
`;
    await writeConfig(tmpDir, yaml);

    const config = await loadConfig(tmpDir);

    expect(config.schedule[0].variables?.category).toBe("tests");
  });

  it("same agent in multiple schedule entries", async () => {
    const yaml = `
workspace: ./w
agents:
  - name: code-agent
schedule:
  - agent: code-agent
    cron: "0 2 * * 1-5"
    variables:
      category: "refactoring"
  - agent: code-agent
    cron: "0 3 * * 6"
    variables:
      category: "tests"
`;
    await writeConfig(tmpDir, yaml);

    const config = await loadConfig(tmpDir);

    expect(config.schedule).toHaveLength(2);
    expect(config.schedule[0].cron).toBe("0 2 * * 1-5");
    expect(config.schedule[0].variables?.category).toBe("refactoring");
    expect(config.schedule[1].cron).toBe("0 3 * * 6");
    expect(config.schedule[1].variables?.category).toBe("tests");
  });

  it("getDefaultConfigYaml includes agents and schedule examples", () => {
    const yaml = getDefaultConfigYaml();

    expect(yaml).toContain("agents:");
    expect(yaml).toContain("schedule:");
    expect(yaml).toContain("agents_dir:");
  });
});
