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
  /** Maps taskId → state key for tasks returned by evaluateSchedules but not yet confirmed */
  private pendingKeys: Map<string, string> = new Map();

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

    // Build reverse map: key → taskId for pending (unconfirmed) tasks
    const pendingByKey = new Map<string, string>();
    for (const [taskId, key] of this.pendingKeys) {
      pendingByKey.set(key, taskId);
    }

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
      // (only applies when lastRuns was actually updated via confirmDispatched)
      if (lastRun && new Date(lastRun) >= prevRun) {
        // Also not pending — truly nothing to do
        if (!pendingByKey.has(key)) continue;
      }

      // If there is already a pending task for this key, re-emit it
      // (don't create a new task ID — reuse the existing pending one)
      const existingPendingId = pendingByKey.get(key);
      if (existingPendingId) {
        // Re-create the task object for the pending entry
        const agentDecl = this.config.agents.find((a) => a.name === entry.agent);
        const mergedVars = { ...(agentDecl?.variables ?? {}), ...(entry.variables ?? {}) };

        const task: NightShiftTask = {
          id: existingPendingId,
          name: `${entry.agent}-${existingPendingId}`,
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
        this.logger.info(`Re-emitting pending task for agent ${entry.agent}`, {
          taskId: existingPendingId,
          cron: entry.cron,
          agentName: entry.agent,
        });
        continue;
      }

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
      // Track as pending — do NOT update lastRuns yet
      this.pendingKeys.set(taskId, key);

      this.logger.info(`Scheduled task for agent ${entry.agent}`, {
        taskId,
        cron: entry.cron,
        agentName: entry.agent,
      });
    }

    if (needsSave) {
      await this.saveState();
    }

    return tasks;
  }

  /**
   * Confirm that the given task IDs were actually dispatched.
   * Updates lastRuns only for confirmed tasks; unconfirmed tasks
   * remain eligible for the next evaluateSchedules() call.
   */
  async confirmDispatched(taskIds: string[]): Promise<void> {
    const confirmedSet = new Set(taskIds);
    let updated = false;

    for (const taskId of confirmedSet) {
      const key = this.pendingKeys.get(taskId);
      if (key) {
        this.state.lastRuns[key] = new Date().toISOString();
        this.pendingKeys.delete(taskId);
        updated = true;
      }
    }

    if (updated) {
      await this.saveState();
    }
  }
}
