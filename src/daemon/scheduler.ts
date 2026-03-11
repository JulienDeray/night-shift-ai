import crypto from "node:crypto";
import { Cron } from "croner";
import { getSchedulerStatePath } from "../core/paths.js";
import { readJsonFile, writeJsonFile } from "../utils/fs.js";
import type { NightShiftConfig, NightShiftTask } from "../core/types.js";
import type { Logger } from "../core/logger.js";

interface SchedulerState {
  lastRuns: Record<string, string>; // `${agent}:${cron}` → ISO timestamp of last task creation
}

export class Scheduler {
  private state: SchedulerState = { lastRuns: {} };
  private config: NightShiftConfig;
  private readonly logger: Logger;

  constructor(config: NightShiftConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  updateConfig(config: NightShiftConfig): void {
    this.config = config;
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
    const now = new Date();
    const tasks: NightShiftTask[] = [];
    let needsSave = false;

    for (const entry of this.config.schedule) {
      if (!entry.enabled) continue;

      const key = `${entry.agent}:${entry.cron}`;
      const lastRun = this.state.lastRuns[key];

      if (!lastRun) {
        // New schedule — seed state so it waits for the next occurrence
        this.state.lastRuns[key] = now.toISOString();
        needsSave = true;
        continue;
      }

      const cron = new Cron(entry.cron);
      const prevRuns = cron.previousRuns(1, now);
      if (prevRuns.length === 0) continue;
      const prevRun = prevRuns[0];

      // Skip if already ran after the most recent scheduled time
      if (lastRun && new Date(lastRun) >= prevRun) continue;

      const taskId = `ns-${crypto.randomBytes(4).toString("hex")}`;

      // Merge agent-level and schedule-level variables
      const agentDecl = this.config.agents.find((a) => a.name === entry.agent);
      const mergedVars = { ...(agentDecl?.variables ?? {}), ...(entry.variables ?? {}) };

      const task: NightShiftTask = {
        id: taskId,
        name: `${entry.agent}-${taskId}`,
        origin: "recurring",
        prompt: "",
        status: "pending",
        timeout: this.config.defaultTimeout,
        createdAt: now.toISOString(),
        agentName: entry.agent,
        notify: entry.notify ?? agentDecl?.notify,
        variables: Object.keys(mergedVars).length > 0 ? mergedVars : undefined,
      };

      tasks.push(task);
      this.state.lastRuns[key] = now.toISOString();

      this.logger.info(`Scheduled task for agent ${entry.agent}`, {
        taskId,
        cron: entry.cron,
        agentName: entry.agent,
      });
    }

    if (tasks.length > 0 || needsSave) {
      await this.saveState();
    }

    return tasks;
  }
}
