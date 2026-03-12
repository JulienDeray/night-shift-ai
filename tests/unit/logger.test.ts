import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import { Logger } from "../../src/core/logger.js";
import { getLogsDir, ensureDir } from "../../src/core/paths.js";

const mockAppendFile = vi.mocked(fs.appendFile);
const mockGetLogsDir = vi.mocked(getLogsDir);
const mockEnsureDir = vi.mocked(ensureDir);

describe("Logger - daemon log rotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLogsDir.mockReturnValue("/base/.nightshift/logs");
    mockEnsureDir.mockResolvedValue(undefined);
    mockAppendFile.mockResolvedValue(undefined);
    // Use fake timers for system time only, keep real timers for async
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Test 1: createDaemonLogger writes to a file matching daemon-YYYY-MM-DD.log pattern", async () => {
    vi.setSystemTime(new Date("2026-03-12T10:00:00Z"));

    const logger = await Logger.createDaemonLogger("/base");
    logger.info("hello");

    // Flush microtask queue
    await Promise.resolve();
    await Promise.resolve();

    expect(mockAppendFile).toHaveBeenCalledOnce();
    const [filePath] = mockAppendFile.mock.calls[0];
    expect(String(filePath)).toMatch(/daemon-2026-03-12\.log$/);
  });

  it("Test 2: when the system date changes, the next write goes to a new file with the new date", async () => {
    vi.setSystemTime(new Date("2026-03-12T23:59:59Z"));

    const logger = await Logger.createDaemonLogger("/base");
    logger.info("before midnight");
    await Promise.resolve();
    await Promise.resolve();

    // Advance past midnight
    vi.setSystemTime(new Date("2026-03-13T00:00:01Z"));

    logger.info("after midnight");
    await Promise.resolve();
    await Promise.resolve();

    expect(mockAppendFile).toHaveBeenCalledTimes(2);

    const firstPath = String(mockAppendFile.mock.calls[0][0]);
    const secondPath = String(mockAppendFile.mock.calls[1][0]);

    expect(firstPath).toMatch(/daemon-2026-03-12\.log$/);
    expect(secondPath).toMatch(/daemon-2026-03-13\.log$/);
    expect(firstPath).not.toBe(secondPath);
  });

  it("Test 3: multiple writes within the same date all go to the same file", async () => {
    vi.setSystemTime(new Date("2026-03-12T14:00:00Z"));

    const logger = await Logger.createDaemonLogger("/base");
    logger.info("write 1");
    logger.info("write 2");
    logger.info("write 3");
    await Promise.resolve();
    await Promise.resolve();

    expect(mockAppendFile).toHaveBeenCalledTimes(3);

    const paths = mockAppendFile.mock.calls.map((call) => String(call[0]));
    const uniquePaths = new Set(paths);
    expect(uniquePaths.size).toBe(1);
    expect(paths[0]).toMatch(/daemon-2026-03-12\.log$/);
  });

  it("Test 4: CLI logger (stdout-only, no logFile) is unaffected by the change", async () => {
    const logger = Logger.createCliLogger(true);

    // Spy on console to avoid noise
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("cli message");
    await Promise.resolve();
    await Promise.resolve();

    // CLI logger should NOT write to any file
    expect(mockAppendFile).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
