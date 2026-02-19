import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Scheduler } from "../../src/daemon/scheduler.js";
import { Logger } from "../../src/core/logger.js";
import type { NightShiftConfig } from "../../src/core/types.js";

function makeConfig(overrides?: Partial<NightShiftConfig>): NightShiftConfig {
  return {
    workspace: "./workspace",
    inbox: "./inbox",
    maxConcurrent: 2,
    defaultTimeout: "30m",
    beads: { enabled: false }, // disable beads for unit tests
    daemon: {
      pollIntervalMs: 30000,
      heartbeatIntervalMs: 10000,
      logRetentionDays: 30,
    },
    recurring: [],
    oneOffDefaults: { timeout: "30m" },
    ...overrides,
  };
}

describe("Scheduler", () => {
  let tmpDir: string;
  let logger: Logger;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-sched-"));
    await fs.mkdir(path.join(tmpDir, ".nightshift", "queue"), { recursive: true });
    logger = Logger.createCliLogger(false);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates tasks for due recurring schedules", async () => {
    // Use a cron schedule that triggers every minute
    const config = makeConfig({
      recurring: [
        {
          name: "every-minute",
          schedule: "* * * * *",
          prompt: "Do something every minute",
        },
      ],
    });

    const scheduler = new Scheduler(config, logger);

    // Patch the internal file write to use our tmpDir
    // Since beads is disabled, it uses file queue
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      const tasks = await scheduler.evaluateSchedules();
      expect(tasks.length).toBe(1);
      expect(tasks[0].name).toBe("every-minute");
      expect(tasks[0].origin).toBe("recurring");
      expect(tasks[0].prompt).toBe("Do something every minute");
    } finally {
      process.cwd = origCwd;
    }
  });

  it("does not duplicate tasks that already ran", async () => {
    const config = makeConfig({
      recurring: [
        {
          name: "every-minute",
          schedule: "* * * * *",
          prompt: "Do something",
        },
      ],
    });

    const scheduler = new Scheduler(config, logger);

    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      // First evaluation should create a task
      const tasks1 = await scheduler.evaluateSchedules();
      expect(tasks1.length).toBe(1);

      // Second evaluation within the same minute should not create another
      const tasks2 = await scheduler.evaluateSchedules();
      expect(tasks2.length).toBe(0);
    } finally {
      process.cwd = origCwd;
    }
  });

  it("skips tasks with no previous run and no recent trigger", async () => {
    // Schedule for 3AM - unlikely to match during test
    const config = makeConfig({
      recurring: [
        {
          name: "nightly",
          schedule: "0 3 1 1 *", // Jan 1st at 3AM
          prompt: "Nightly task",
        },
      ],
    });

    const scheduler = new Scheduler(config, logger);

    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      const tasks = await scheduler.evaluateSchedules();
      expect(tasks.length).toBe(0);
    } finally {
      process.cwd = origCwd;
    }
  });
});
