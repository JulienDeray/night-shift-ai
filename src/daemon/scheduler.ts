import { Cron } from "croner";
import crypto from "node:crypto";
import { getSchedulerStatePath } from "../core/paths.js";
import { readJsonFile, writeJsonFile } from "../utils/fs.js";
import { BeadsClient } from "../beads/client.js";
import { toBeadLabels, toBeadDescription } from "../beads/mapper.js";
import type { NightShiftConfig, NightShiftTask, RecurringTaskConfig } from "../core/types.js";
import type { Logger } from "../core/logger.js";

interface SchedulerState {
  lastRuns: Record<string, string>; // name → ISO timestamp of last bead creation
}

export class Scheduler {
  private state: SchedulerState = { lastRuns: {} };
  private readonly config: NightShiftConfig;
  private readonly logger: Logger;
  private readonly beads: BeadsClient | null;

  constructor(config: NightShiftConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.beads = config.beads.enabled ? new BeadsClient() : null;
  }

  async loadState(base?: string): Promise<void> {
    const state = await readJsonFile<SchedulerState>(getSchedulerStatePath(base));
    if (state) {
      this.state = state;
    }
  }

  async saveState(base?: string): Promise<void> {
    await writeJsonFile(getSchedulerStatePath(base), this.state);
  }

  async evaluateSchedules(): Promise<NightShiftTask[]> {
    const tasks: NightShiftTask[] = [];
    const now = new Date();

    for (const recurring of this.config.recurring) {
      if (this.isDue(recurring, now)) {
        this.logger.info(`Recurring task "${recurring.name}" is due`, {
          schedule: recurring.schedule,
        });

        const task = await this.createTask(recurring);
        if (task) {
          tasks.push(task);
          this.state.lastRuns[recurring.name] = now.toISOString();
        }
      }
    }

    if (tasks.length > 0) {
      await this.saveState();
    }

    return tasks;
  }

  private isDue(recurring: RecurringTaskConfig, now: Date): boolean {
    const cron = new Cron(recurring.schedule);
    const lastRun = this.state.lastRuns[recurring.name];

    if (!lastRun) {
      // Never run before - find the most recent scheduled trigger by
      // computing nextRun from a point in the past. If that trigger falls
      // between then and now, the task is due.
      const lookback = new Date(now.getTime() - 5 * 60 * 1000);
      const recentTrigger = cron.nextRun(lookback);
      if (!recentTrigger) return false;
      return recentTrigger.getTime() <= now.getTime();
    }

    const lastRunDate = new Date(lastRun);
    // Check if there's a cron trigger between lastRun and now
    const nextAfterLast = cron.nextRun(lastRunDate);
    if (!nextAfterLast) return false;

    return nextAfterLast.getTime() <= now.getTime();
  }

  private async createTask(
    recurring: RecurringTaskConfig,
  ): Promise<NightShiftTask | null> {
    const taskId = `ns-${crypto.randomBytes(4).toString("hex")}`;
    const task: NightShiftTask = {
      id: taskId,
      name: recurring.name,
      origin: "recurring",
      prompt: recurring.prompt,
      status: "pending",
      allowedTools: recurring.allowedTools,
      timeout: recurring.timeout ?? this.config.defaultTimeout,
      maxBudgetUsd: recurring.maxBudgetUsd,
      model: recurring.model,
      mcpConfig: recurring.mcpConfig,
      output: recurring.output,
      createdAt: new Date().toISOString(),
      recurringName: recurring.name,
    };

    if (this.beads) {
      try {
        const beadId = await this.beads.create({
          title: recurring.name,
          description: toBeadDescription(task),
          labels: toBeadLabels(task),
        });
        task.id = beadId;
        this.logger.info(`Created bead ${beadId} for recurring task "${recurring.name}"`);
      } catch (err) {
        this.logger.error(`Failed to create bead for "${recurring.name}"`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    } else {
      // File-based queue
      const { writeJsonFile: writeJson } = await import("../utils/fs.js");
      const { getQueueDir } = await import("../core/paths.js");
      const path = await import("node:path");
      const queuePath = path.join(getQueueDir(), `${taskId}.json`);
      await writeJson(queuePath, task);
    }

    return task;
  }
}
