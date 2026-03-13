import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import { scaffoldAgent } from "../../src/agent/scaffold.js";
import { ManifestSchema } from "../../src/agent/manifest-schema.js";

describe("scaffoldAgent", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates agents/<name>/ directory", async () => {
    await scaffoldAgent("my-agent", { base: tmpDir });
    const stat = await fs.stat(path.join(tmpDir, "agents", "my-agent"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("creates manifest.yaml that passes ManifestSchema.safeParse()", async () => {
    await scaffoldAgent("my-agent", { base: tmpDir });
    const content = await fs.readFile(
      path.join(tmpDir, "agents", "my-agent", "manifest.yaml"),
      "utf-8",
    );
    const parsed = parseYaml(content);
    const result = ManifestSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it("creates prompts/preamble.md and prompts/analyze.md", async () => {
    await scaffoldAgent("my-agent", { base: tmpDir });
    const promptsDir = path.join(tmpDir, "agents", "my-agent", "prompts");

    await expect(fs.access(path.join(promptsDir, "preamble.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(promptsDir, "analyze.md"))).resolves.toBeUndefined();
  });

  it("analyze.md contains JSON output instruction with result and summary fields", async () => {
    await scaffoldAgent("my-agent", { base: tmpDir });
    const content = await fs.readFile(
      path.join(tmpDir, "agents", "my-agent", "prompts", "analyze.md"),
      "utf-8",
    );
    expect(content).toContain('"result"');
    expect(content).toContain('"summary"');
    expect(content).toContain("```json");
  });

  it("throws on invalid name (uppercase)", async () => {
    await expect(scaffoldAgent("UPPERCASE", { base: tmpDir })).rejects.toThrow(
      /kebab-case/,
    );
  });

  it("throws on invalid name (has spaces)", async () => {
    await expect(scaffoldAgent("has spaces", { base: tmpDir })).rejects.toThrow(
      /kebab-case/,
    );
  });

  it("throws when directory exists without --force", async () => {
    await scaffoldAgent("my-agent", { base: tmpDir });
    await expect(scaffoldAgent("my-agent", { base: tmpDir })).rejects.toThrow(
      /already exists/,
    );
  });

  it("succeeds with --force when directory exists (overwrites)", async () => {
    await scaffoldAgent("my-agent", { base: tmpDir });
    const result = await scaffoldAgent("my-agent", { base: tmpDir, force: true });
    expect(result.agentDir).toContain("my-agent");

    // Verify files still exist after overwrite
    const content = await fs.readFile(
      path.join(tmpDir, "agents", "my-agent", "manifest.yaml"),
      "utf-8",
    );
    expect(content).toBeTruthy();
  });

  it("appends to nightshift.yaml agents and schedule arrays when config exists", async () => {
    // Write a minimal nightshift.yaml
    await fs.writeFile(
      path.join(tmpDir, "nightshift.yaml"),
      "agents: []\nschedule: []\n",
      "utf-8",
    );

    await scaffoldAgent("my-agent", { base: tmpDir });

    const configContent = await fs.readFile(
      path.join(tmpDir, "nightshift.yaml"),
      "utf-8",
    );
    const config = parseYaml(configContent) as Record<string, unknown>;

    expect(Array.isArray(config.agents)).toBe(true);
    expect(config.agents).toContainEqual({ name: "my-agent" });

    expect(Array.isArray(config.schedule)).toBe(true);
    const scheduleEntry = (config.schedule as Array<Record<string, unknown>>).find(
      (s) => s.agent === "my-agent",
    );
    expect(scheduleEntry).toBeDefined();
    expect(scheduleEntry!.cron).toBe("0 2 * * *");
  });

  it("sets configUpdated=false and warns when nightshift.yaml is missing", async () => {
    const result = await scaffoldAgent("my-agent", { base: tmpDir });
    expect(result.configUpdated).toBe(false);
  });

  it("manifest steps include analyze step (no type field)", async () => {
    await scaffoldAgent("my-agent", { base: tmpDir });
    const content = await fs.readFile(
      path.join(tmpDir, "agents", "my-agent", "manifest.yaml"),
      "utf-8",
    );
    const manifest = parseYaml(content) as Record<string, unknown>;
    const steps = manifest.steps as Array<Record<string, unknown>>;

    expect(Array.isArray(steps)).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(1);

    const analyzeStep = steps.find((s) => s.name === "analyze");
    expect(analyzeStep).toBeDefined();
    // No type field in steps
    expect(analyzeStep!.type).toBeUndefined();
  });
});
