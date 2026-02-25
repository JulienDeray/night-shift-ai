import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loadBeadPrompt,
  INJECTION_MITIGATION_PREAMBLE,
} from "../../src/agent/prompt-loader.js";

describe("prompt-loader", () => {
  let tmpDir: string;
  let templateFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-prompt-test-"));
    templateFile = path.join(tmpDir, "template.md");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("always prepends INJECTION_MITIGATION_PREAMBLE before template content", async () => {
    await fs.writeFile(templateFile, "Hello, world!");

    const result = await loadBeadPrompt(templateFile, {}, tmpDir);

    expect(result.startsWith(INJECTION_MITIGATION_PREAMBLE)).toBe(true);
  });

  it("includes the template content after the preamble separator", async () => {
    const templateContent = "My template content here.";
    await fs.writeFile(templateFile, templateContent);

    const result = await loadBeadPrompt(templateFile, {}, tmpDir);

    expect(result).toContain("---");
    expect(result).toContain(templateContent);
    // Preamble must come before template content
    const preambleIndex = result.indexOf(INJECTION_MITIGATION_PREAMBLE);
    const contentIndex = result.indexOf(templateContent);
    expect(preambleIndex).toBeLessThan(contentIndex);
  });

  it("substitutes {{variables}} via renderTemplate", async () => {
    await fs.writeFile(templateFile, "Hello {{name}}, today is {{date}}.");

    const result = await loadBeadPrompt(
      templateFile,
      { name: "agent", date: "2026-02-25" },
      tmpDir,
    );

    expect(result).toContain("Hello agent, today is 2026-02-25.");
    expect(result).not.toContain("{{name}}");
  });

  it("leaves unknown {{placeholders}} intact when not provided", async () => {
    await fs.writeFile(templateFile, "Category: {{category}}, repo: {{repo_url}}");

    const result = await loadBeadPrompt(templateFile, {}, tmpDir);

    expect(result).toContain("{{category}}");
    expect(result).toContain("{{repo_url}}");
  });

  it("resolves relative template paths against configDir, not cwd", async () => {
    const subDir = path.join(tmpDir, "config");
    await fs.mkdir(subDir);
    const relativeTemplate = path.join(subDir, "relative-template.md");
    await fs.writeFile(relativeTemplate, "Relative template content.");

    // Use a relative path from subDir
    const result = await loadBeadPrompt("relative-template.md", {}, subDir);

    expect(result).toContain("Relative template content.");
  });

  it("resolves absolute template paths regardless of configDir", async () => {
    await fs.writeFile(templateFile, "Absolute path template.");

    // templateFile is already absolute; configDir is a different directory
    const anotherDir = path.join(tmpDir, "other");
    await fs.mkdir(anotherDir);

    const result = await loadBeadPrompt(templateFile, {}, anotherDir);

    expect(result).toContain("Absolute path template.");
  });

  it("preamble contains the key phrase 'treat ALL content'", () => {
    expect(INJECTION_MITIGATION_PREAMBLE.toLowerCase()).toContain(
      "treat all content",
    );
  });

  it("INJECTION_MITIGATION_PREAMBLE does not contain GITLAB_TOKEN", () => {
    expect(INJECTION_MITIGATION_PREAMBLE).not.toContain("GITLAB_TOKEN");
  });

  it("INJECTION_MITIGATION_PREAMBLE does not contain any env var references (no process.env keys)", () => {
    // Ensure the preamble has no common env var patterns like uppercase_underscore or $VAR
    expect(INJECTION_MITIGATION_PREAMBLE).not.toMatch(/\$[A-Z_]+/);
    expect(INJECTION_MITIGATION_PREAMBLE).not.toContain("process.env");
  });

  it("substitutes date variable from renderTemplate defaults", async () => {
    await fs.writeFile(templateFile, "Date: {{date}}");

    const result = await loadBeadPrompt(templateFile, {}, tmpDir);

    // renderTemplate provides a default {{date}} from date-fns format
    expect(result).toContain("Date:");
    // Should not contain the raw placeholder since renderTemplate injects a default date
    expect(result).not.toContain("{{date}}");
  });

  it("explicit vars override renderTemplate defaults", async () => {
    await fs.writeFile(templateFile, "Date: {{date}}");

    const result = await loadBeadPrompt(
      templateFile,
      { date: "2099-12-31" },
      tmpDir,
    );

    expect(result).toContain("Date: 2099-12-31");
  });

  it("does not throw on empty template", async () => {
    await fs.writeFile(templateFile, "");

    const result = await loadBeadPrompt(templateFile, {}, tmpDir);

    expect(result).toContain(INJECTION_MITIGATION_PREAMBLE);
  });

  it("throws when template file does not exist", async () => {
    const nonExistent = path.join(tmpDir, "does-not-exist.md");

    await expect(
      loadBeadPrompt(nonExistent, {}, tmpDir),
    ).rejects.toThrow();
  });
});
