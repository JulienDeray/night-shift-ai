import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Scheduler } from "../../src/daemon/scheduler.js";
import { Logger } from "../../src/core/logger.js";
import { readJsonFile } from "../../src/utils/fs.js";
import type { NightShiftConfig, NightShiftTask } from "../../src/core/types.js";

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

  it("persists scheduler state to disk after creating tasks", async () => {
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
      await scheduler.evaluateSchedules();

      const statePath = path.join(tmpDir, ".nightshift", "scheduler.json");
      const state = await readJsonFile<{ lastRuns: Record<string, string> }>(statePath);
      expect(state).not.toBeNull();
      expect(state!.lastRuns["every-minute"]).toBeDefined();
      expect(new Date(state!.lastRuns["every-minute"]).getTime()).not.toBeNaN();
    } finally {
      process.cwd = origCwd;
    }
  });

  it("restores scheduler state from disk on startup", async () => {
    const config = makeConfig({
      recurring: [
        {
          name: "every-minute",
          schedule: "* * * * *",
          prompt: "Do something",
        },
      ],
    });

    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      // Write state as if the task ran just now
      const statePath = path.join(tmpDir, ".nightshift", "scheduler.json");
      const stateData = { lastRuns: { "every-minute": new Date().toISOString() } };
      await fs.writeFile(statePath, JSON.stringify(stateData), "utf-8");

      // New scheduler instance should load state and not re-trigger
      const scheduler = new Scheduler(config, logger);
      await scheduler.loadState(tmpDir);

      const tasks = await scheduler.evaluateSchedules();
      expect(tasks.length).toBe(0);
    } finally {
      process.cwd = origCwd;
    }
  });

  it("uses task-specific timeout, falls back to defaultTimeout", async () => {
    const config = makeConfig({
      defaultTimeout: "45m",
      recurring: [
        {
          name: "with-timeout",
          schedule: "* * * * *",
          prompt: "Task with custom timeout",
          timeout: "10m",
        },
        {
          name: "without-timeout",
          schedule: "* * * * *",
          prompt: "Task without custom timeout",
        },
      ],
    });

    const scheduler = new Scheduler(config, logger);

    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      const tasks = await scheduler.evaluateSchedules();
      expect(tasks.length).toBe(2);

      const withTimeout = tasks.find((t) => t.name === "with-timeout");
      const withoutTimeout = tasks.find((t) => t.name === "without-timeout");

      expect(withTimeout!.timeout).toBe("10m");
      expect(withoutTimeout!.timeout).toBe("45m");
    } finally {
      process.cwd = origCwd;
    }
  });

  it("carries over allowedTools, maxBudgetUsd, model, output from recurring config", async () => {
    const config = makeConfig({
      recurring: [
        {
          name: "full-config",
          schedule: "* * * * *",
          prompt: "Full config task",
          allowedTools: ["Read", "Write"],
          maxBudgetUsd: 3.5,
          model: "opus",
          output: "reports/{{name}}-{{date}}.md",
        },
      ],
    });

    const scheduler = new Scheduler(config, logger);

    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      const tasks = await scheduler.evaluateSchedules();
      expect(tasks.length).toBe(1);
      expect(tasks[0].allowedTools).toEqual(["Read", "Write"]);
      expect(tasks[0].maxBudgetUsd).toBe(3.5);
      expect(tasks[0].model).toBe("opus");
      expect(tasks[0].output).toBe("reports/{{name}}-{{date}}.md");
      expect(tasks[0].recurringName).toBe("full-config");
    } finally {
      process.cwd = origCwd;
    }
  });

  it("creates a new task after enough time has passed since the last run", async () => {
    const config = makeConfig({
      recurring: [
        {
          name: "every-minute",
          schedule: "* * * * *",
          prompt: "Do something",
        },
      ],
    });

    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      // Write state as if the task last ran 2 minutes ago
      const statePath = path.join(tmpDir, ".nightshift", "scheduler.json");
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      await fs.writeFile(
        statePath,
        JSON.stringify({ lastRuns: { "every-minute": twoMinutesAgo } }),
        "utf-8",
      );

      const scheduler = new Scheduler(config, logger);
      await scheduler.loadState(tmpDir);

      const tasks = await scheduler.evaluateSchedules();
      expect(tasks.length).toBe(1);
      expect(tasks[0].name).toBe("every-minute");
    } finally {
      process.cwd = origCwd;
    }
  });

  it("updateConfig replaces recurring tasks for subsequent evaluations", async () => {
    const config = makeConfig({
      recurring: [
        {
          name: "old-task",
          schedule: "* * * * *",
          prompt: "Old task",
        },
      ],
    });

    const scheduler = new Scheduler(config, logger);

    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      // First evaluation triggers the old task
      const tasks1 = await scheduler.evaluateSchedules();
      expect(tasks1.length).toBe(1);
      expect(tasks1[0].name).toBe("old-task");

      // Update config to replace recurring tasks
      const newConfig = makeConfig({
        recurring: [
          {
            name: "new-task",
            schedule: "* * * * *",
            prompt: "New task",
          },
        ],
      });
      scheduler.updateConfig(newConfig);

      // Next evaluation should only see the new task
      const tasks2 = await scheduler.evaluateSchedules();
      expect(tasks2.length).toBe(1);
      expect(tasks2[0].name).toBe("new-task");
    } finally {
      process.cwd = origCwd;
    }
  });

  it("writes task file to queue when beads disabled", async () => {
    const config = makeConfig({
      recurring: [
        {
          name: "queued-task",
          schedule: "* * * * *",
          prompt: "Should be written to file queue",
        },
      ],
    });

    const scheduler = new Scheduler(config, logger);

    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      const tasks = await scheduler.evaluateSchedules();
      expect(tasks.length).toBe(1);

      // Verify the task file was written to the queue
      const queueDir = path.join(tmpDir, ".nightshift", "queue");
      const files = await fs.readdir(queueDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      expect(jsonFiles.length).toBe(1);

      const taskFile = await readJsonFile<NightShiftTask>(
        path.join(queueDir, jsonFiles[0]),
      );
      expect(taskFile!.name).toBe("queued-task");
      expect(taskFile!.origin).toBe("recurring");
      expect(taskFile!.status).toBe("pending");
    } finally {
      process.cwd = origCwd;
    }
  });
});
