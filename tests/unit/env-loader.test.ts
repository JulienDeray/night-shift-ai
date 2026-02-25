import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// We import after setting up spies so the module uses the mocked fs
import { loadEnvFile } from "../../src/utils/env-loader.js";

describe("loadEnvFile", () => {
  const TEST_KEY_PREFIX = "NIGHTSHIFT_TEST_";

  // Track keys set during tests so we can clean them up
  const keysToClean: string[] = [];

  function setKey(key: string, value: string): void {
    process.env[key] = value;
    keysToClean.push(key);
  }

  beforeEach(() => {
    keysToClean.length = 0;
  });

  afterEach(() => {
    for (const key of keysToClean) {
      delete process.env[key];
    }
    vi.restoreAllMocks();
  });

  it("parses KEY=VALUE lines and sets process.env", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-env-test-"));
    const envFile = path.join(tmpDir, ".env");
    const key = `${TEST_KEY_PREFIX}BASIC`;
    keysToClean.push(key);

    fs.writeFileSync(envFile, `${key}=hello\n`);
    loadEnvFile(tmpDir);

    expect(process.env[key]).toBe("hello");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips comment lines starting with #", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-env-test-"));
    const envFile = path.join(tmpDir, ".env");
    const key = `${TEST_KEY_PREFIX}COMMENTED`;
    keysToClean.push(key);

    fs.writeFileSync(envFile, `# ${key}=should_not_be_set\n`);
    loadEnvFile(tmpDir);

    expect(process.env[key]).toBeUndefined();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips blank lines", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-env-test-"));
    const key1 = `${TEST_KEY_PREFIX}BLANK_BEFORE`;
    const key2 = `${TEST_KEY_PREFIX}BLANK_AFTER`;
    keysToClean.push(key1, key2);

    fs.writeFileSync(path.join(tmpDir, ".env"), `\n${key1}=val1\n\n${key2}=val2\n`);
    loadEnvFile(tmpDir);

    expect(process.env[key1]).toBe("val1");
    expect(process.env[key2]).toBe("val2");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("strips double quotes from values", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-env-test-"));
    const key = `${TEST_KEY_PREFIX}DOUBLE_QUOTED`;
    keysToClean.push(key);

    fs.writeFileSync(path.join(tmpDir, ".env"), `${key}="my value"\n`);
    loadEnvFile(tmpDir);

    expect(process.env[key]).toBe("my value");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("strips single quotes from values", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-env-test-"));
    const key = `${TEST_KEY_PREFIX}SINGLE_QUOTED`;
    keysToClean.push(key);

    fs.writeFileSync(path.join(tmpDir, ".env"), `${key}='my value'\n`);
    loadEnvFile(tmpDir);

    expect(process.env[key]).toBe("my value");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does NOT override existing process.env values", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-env-test-"));
    const key = `${TEST_KEY_PREFIX}OVERRIDE`;
    keysToClean.push(key);

    // Pre-set the env var (simulates shell-exported variable)
    setKey(key, "shell_value");

    fs.writeFileSync(path.join(tmpDir, ".env"), `${key}=file_value\n`);
    loadEnvFile(tmpDir);

    // Shell value must win
    expect(process.env[key]).toBe("shell_value");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("silently ignores missing .env file (no throw)", () => {
    const nonExistentDir = path.join(os.tmpdir(), "nightshift-no-env-dir-xyz");

    expect(() => loadEnvFile(nonExistentDir)).not.toThrow();
  });

  it("handles KEY= (empty value)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nightshift-env-test-"));
    const key = `${TEST_KEY_PREFIX}EMPTY`;
    keysToClean.push(key);

    fs.writeFileSync(path.join(tmpDir, ".env"), `${key}=\n`);
    loadEnvFile(tmpDir);

    expect(process.env[key]).toBe("");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
