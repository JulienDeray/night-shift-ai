import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Scheduler } from "../../src/daemon/scheduler.js";
import { Logger } from "../../src/core/logger.js";
import { readJsonFile } from "../../src/utils/fs.js";
import type { NightShiftConfig, NightShiftTask, CategoryScheduleConfig } from "../../src/core/types.js";

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

  describe("category resolution and notify propagation", () => {
    // 2026-01-05T02:00:00Z is a Monday (getDay() === 1)
    const MONDAY_TIME = new Date("2026-01-05T02:00:00Z");

    const FULL_SCHEDULE: CategoryScheduleConfig = {
      sunday: ["sunday-cat"],
      monday: ["monday-cat"],
      tuesday: ["tuesday-cat"],
      wednesday: ["wednesday-cat"],
      thursday: ["thursday-cat"],
      friday: ["friday-cat"],
      saturday: ["saturday-cat"],
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it("resolveCategory returns correct category for each weekday", async () => {
      // Test all 7 days: 0=Sunday through 6=Saturday
      const dayTests: Array<{ date: Date; expected: string }> = [
        { date: new Date("2026-01-04T02:00:00Z"), expected: "sunday-cat" },    // Sunday
        { date: new Date("2026-01-05T02:00:00Z"), expected: "monday-cat" },    // Monday
        { date: new Date("2026-01-06T02:00:00Z"), expected: "tuesday-cat" },   // Tuesday
        { date: new Date("2026-01-07T02:00:00Z"), expected: "wednesday-cat" }, // Wednesday
        { date: new Date("2026-01-08T02:00:00Z"), expected: "thursday-cat" },  // Thursday
        { date: new Date("2026-01-09T02:00:00Z"), expected: "friday-cat" },    // Friday
        { date: new Date("2026-01-10T02:00:00Z"), expected: "saturday-cat" },  // Saturday
      ];

      for (const { date, expected } of dayTests) {
        vi.useFakeTimers();
        vi.setSystemTime(date);

        const config = makeConfig({
          codeAgent: {
            repoUrl: "https://example.com/repo",
            confluencePageId: "12345",
            categorySchedule: FULL_SCHEDULE,
          },
          recurring: [
            {
              name: "daily-task",
              schedule: "* * * * *",
              prompt: "Daily task",
              notify: true,
            },
          ],
        });

        const scheduler = new Scheduler(config, logger);
        const origCwd = process.cwd;
        process.cwd = () => tmpDir;
        try {
          const tasks = await scheduler.evaluateSchedules();
          expect(tasks.length).toBe(1);
          expect(tasks[0].category).toBe(expected);
        } finally {
          process.cwd = origCwd;
        }

        vi.useRealTimers();
        // Reset scheduler state between days by clearing the queue dir
        const queueDir = path.join(tmpDir, ".nightshift", "queue");
        const stateFile = path.join(tmpDir, ".nightshift", "scheduler.json");
        const files = await fs.readdir(queueDir).catch(() => []);
        for (const f of files) {
          await fs.rm(path.join(queueDir, f), { force: true });
        }
        await fs.rm(stateFile, { force: true });
      }
    });

    it("resolveCategory returns undefined when day has no entry", async () => {
      vi.useFakeTimers();
      // Wednesday = getDay() === 3; schedule only has monday
      vi.setSystemTime(new Date("2026-01-07T02:00:00Z"));

      const config = makeConfig({
        codeAgent: {
          repoUrl: "https://example.com/repo",
          confluencePageId: "12345",
          categorySchedule: { monday: ["tests"] },
        },
        recurring: [
          {
            name: "daily-task",
            schedule: "* * * * *",
            prompt: "Daily task",
            notify: true,
          },
        ],
      });

      const scheduler = new Scheduler(config, logger);
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        const tasks = await scheduler.evaluateSchedules();
        expect(tasks.length).toBe(1);
        expect(tasks[0].category).toBeUndefined();
      } finally {
        process.cwd = origCwd;
      }
    });

    it("resolveCategory returns undefined when no codeAgent config", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(MONDAY_TIME);

      const config = makeConfig({
        // no codeAgent
        recurring: [
          {
            name: "daily-task",
            schedule: "* * * * *",
            prompt: "Daily task",
            notify: true,
          },
        ],
      });

      const scheduler = new Scheduler(config, logger);
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        const tasks = await scheduler.evaluateSchedules();
        expect(tasks.length).toBe(1);
        expect(tasks[0].category).toBeUndefined();
      } finally {
        process.cwd = origCwd;
      }
    });

    it("resolveCategory takes first element from array", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(MONDAY_TIME); // Monday

      const config = makeConfig({
        codeAgent: {
          repoUrl: "https://example.com/repo",
          confluencePageId: "12345",
          categorySchedule: { monday: ["tests", "docs"] },
        },
        recurring: [
          {
            name: "daily-task",
            schedule: "* * * * *",
            prompt: "Daily task",
          },
        ],
      });

      const scheduler = new Scheduler(config, logger);
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        const tasks = await scheduler.evaluateSchedules();
        expect(tasks.length).toBe(1);
        expect(tasks[0].category).toBe("tests");
      } finally {
        process.cwd = origCwd;
      }
    });

    it("resolveCategory returns undefined for empty array", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(MONDAY_TIME); // Monday

      const config = makeConfig({
        codeAgent: {
          repoUrl: "https://example.com/repo",
          confluencePageId: "12345",
          categorySchedule: { monday: [] },
        },
        recurring: [
          {
            name: "daily-task",
            schedule: "* * * * *",
            prompt: "Daily task",
          },
        ],
      });

      const scheduler = new Scheduler(config, logger);
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        const tasks = await scheduler.evaluateSchedules();
        expect(tasks.length).toBe(1);
        expect(tasks[0].category).toBeUndefined();
      } finally {
        process.cwd = origCwd;
      }
    });

    it("task.notify is propagated from RecurringTaskConfig.notify", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(MONDAY_TIME);

      const config = makeConfig({
        recurring: [
          {
            name: "notify-task",
            schedule: "* * * * *",
            prompt: "Task with notify",
            notify: true,
          },
        ],
      });

      const scheduler = new Scheduler(config, logger);
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        const tasks = await scheduler.evaluateSchedules();
        expect(tasks.length).toBe(1);
        expect(tasks[0].notify).toBe(true);
      } finally {
        process.cwd = origCwd;
      }
    });

    it("task.notify defaults to undefined when not set", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(MONDAY_TIME);

      const config = makeConfig({
        recurring: [
          {
            name: "no-notify-task",
            schedule: "* * * * *",
            prompt: "Task without notify",
            // notify not set
          },
        ],
      });

      const scheduler = new Scheduler(config, logger);
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        const tasks = await scheduler.evaluateSchedules();
        expect(tasks.length).toBe(1);
        expect(tasks[0].notify).toBeUndefined();
      } finally {
        process.cwd = origCwd;
      }
    });
  });
});
