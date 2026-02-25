import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("node:fs/promises", () => ({
  default: {
    appendFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

vi.mock("../../src/core/paths.js", () => ({
  getLogsDir: vi.fn(),
  ensureDir: vi.fn(),
}));

import fs from "node:fs/promises";
import { appendRunLog, type RunLogEntry } from "../../src/agent/run-logger.js";
import { getLogsDir, ensureDir } from "../../src/core/paths.js";

const mockAppendFile = vi.mocked(fs.appendFile);
const mockGetLogsDir = vi.mocked(getLogsDir);
const mockEnsureDir = vi.mocked(ensureDir);

function makeEntry(overrides: Partial<RunLogEntry> = {}): RunLogEntry {
  return {
    date: "2026-02-25T14:00:00Z",
    category: "tests",
    mr_url: "https://gitlab.com/team/repo/-/merge_requests/42",
    cost_usd: 0.15,
    duration_seconds: 120,
    summary: "Added unit tests for the auth module",
    ...overrides,
  };
}

describe("run-logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLogsDir.mockReturnValue("/base/.nightshift/logs");
    mockEnsureDir.mockResolvedValue(undefined);
    mockAppendFile.mockResolvedValue(undefined);
  });

  it("calls ensureDir with the logs directory before writing", async () => {
    const entry = makeEntry();
    await appendRunLog(entry, "/base");

    expect(mockEnsureDir).toHaveBeenCalledOnce();
    expect(mockEnsureDir).toHaveBeenCalledWith("/base/.nightshift/logs");
  });

  it("calls fs.appendFile with path ending in code-agent-runs.jsonl", async () => {
    const entry = makeEntry();
    await appendRunLog(entry, "/base");

    expect(mockAppendFile).toHaveBeenCalledOnce();
    const [filePath] = mockAppendFile.mock.calls[0];
    expect(String(filePath)).toMatch(/code-agent-runs\.jsonl$/);
  });

  it("written content is a single JSON line terminated with \\n", async () => {
    const entry = makeEntry();
    await appendRunLog(entry, "/base");

    const [, content] = mockAppendFile.mock.calls[0];
    const text = String(content);
    expect(text).toMatch(/\n$/);
    // Should be exactly one line before the newline
    const withoutTrailingNewline = text.slice(0, -1);
    expect(withoutTrailingNewline).not.toContain("\n");
    // Should be valid JSON
    expect(() => JSON.parse(withoutTrailingNewline)).not.toThrow();
  });

  it("JSON line contains exactly the locked fields: date, category, mr_url, cost_usd, duration_seconds, summary", async () => {
    const entry = makeEntry();
    await appendRunLog(entry, "/base");

    const [, content] = mockAppendFile.mock.calls[0];
    const parsed = JSON.parse(String(content).trim());

    const keys = Object.keys(parsed).sort();
    expect(keys).toEqual(
      ["category", "cost_usd", "date", "duration_seconds", "mr_url", "summary"],
    );
  });

  it("mr_url is literal JSON null when entry has null for mr_url", async () => {
    const entry = makeEntry({ mr_url: null });
    await appendRunLog(entry, "/base");

    const [, content] = mockAppendFile.mock.calls[0];
    const parsed = JSON.parse(String(content).trim());
    expect(parsed.mr_url).toBeNull();
  });

  it("multiple calls append multiple lines (not overwrite)", async () => {
    const entry1 = makeEntry({ category: "tests" });
    const entry2 = makeEntry({ category: "refactoring" });

    await appendRunLog(entry1, "/base");
    await appendRunLog(entry2, "/base");

    expect(mockAppendFile).toHaveBeenCalledTimes(2);
  });

  it("uses utf-8 encoding", async () => {
    const entry = makeEntry();
    await appendRunLog(entry, "/base");

    const [, , encoding] = mockAppendFile.mock.calls[0];
    expect(encoding).toBe("utf-8");
  });
});
