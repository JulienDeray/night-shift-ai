import crypto from "node:crypto";
import { Cron } from "croner";
import { getSchedulerStatePath } from "../core/paths.js";
import { readJsonFile, writeJsonFile } from "../utils/fs.js";
import type { NightShiftConfig, NightShiftTask } from "../core/types.js";
import type { Logger } from "../core/logger.js";

interface SchedulerState {
  lastRuns: Record<string, string>; // scheduleKey → ISO timestamp of last task creation
}

export class Scheduler {
  private state: SchedulerState = { lastRuns: {} };
  private config: NightShiftConfig;
  private readonly logger: Logger;
  /** Maps taskId → { key, addedAt } for tasks returned by evaluateSchedules but not yet confirmed.
   *  Map insertion order is used for FIFO priority when re-emitting. */
  private pendingKeys: Map<string, { key: string; addedAt: number }> = new Map();

  constructor(config: NightShiftConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Deterministic key for a schedule entry. Includes sorted schedule-level
   * variables so that the same agent at the same cron with different variables
   * gets independent state tracking.
   */
  private static scheduleKey(entry: {
    agent: string;
    cron: string;
    variables?: Record<string, string>;
  }): string {
    if (!entry.variables || Object.keys(entry.variables).length === 0) {
      return `${entry.agent}:${entry.cron}`;
    }
    const sorted = JSON.stringify(
      entry.variables,
      Object.keys(entry.variables).sort(),
    );
    return `${entry.agent}:${entry.cron}:${sorted}`;
  }

  /** Number of tasks returned by evaluateSchedules() that haven't been confirmed as dispatched yet. */
  get pendingCount(): number {
    return this.pendingKeys.size;
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

  /**
   * Fast-forward stale lastRun entries to the current time.
   *
   * When the daemon restarts after a long outage (e.g. 3 days), each schedule
   * entry whose lastRun is older than the most recent cron trigger would
   * immediately produce a catch-up task. This is almost never desired — the
   * user doesn't want 6 stale tasks to fire simultaneously on restart.
   *
   * Call this after loadState() during daemon startup. It advances every
   * lastRun that predates the previous cron trigger to `now`, so the
   * scheduler waits for the *next* scheduled time instead of catching up.
   */
  async fastForwardStaleEntries(base?: string): Promise<void> {
    const now = new Date();
    let updated = false;

    for (const entry of this.config.schedule) {
      if (!entry.enabled) continue;

      const key = Scheduler.scheduleKey(entry);
      const lastRun = this.state.lastRuns[key];
      if (!lastRun) continue; // new schedule — handled by evaluateSchedules

      const cron = new Cron(entry.cron);
      const prevRuns = cron.previousRuns(1, now);
      if (prevRuns.length === 0) continue;
      const prevRun = prevRuns[0];

      // If lastRun is before the most recent scheduled time, the daemon
      // missed this run. Fast-forward to now instead of catching up.
      if (new Date(lastRun) < prevRun) {
        this.state.lastRuns[key] = now.toISOString();
        updated = true;
        this.logger.info("Fast-forwarded stale schedule entry", {
          agent: entry.agent,
          cron: entry.cron,
          lastRun,
          missedAt: prevRun.toISOString(),
        });
      }
    }

    if (updated) {
      await this.saveState(base);
    }
  }

  async saveState(base?: string): Promise<void> {
    await writeJsonFile(getSchedulerStatePath(base), this.state);
  }

  async evaluateSchedules(): Promise<NightShiftTask[]> {
    const now = new Date();
    const pendingTasks: NightShiftTask[] = [];
    const newTasks: NightShiftTask[] = [];
    let needsSave = false;

    // Build reverse map: key → taskId for pending (unconfirmed) tasks
    const pendingByKey = new Map<string, string>();
    for (const [taskId, { key }] of this.pendingKeys) {
      pendingByKey.set(key, taskId);
    }

    for (const entry of this.config.schedule) {
      if (!entry.enabled) continue;

      const key = Scheduler.scheduleKey(entry);
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

      // Merge agent-level and schedule-level variables
      const agentDecl = this.config.agents.find((a) => a.name === entry.agent);
      const mergedVars = { ...(agentDecl?.variables ?? {}), ...(entry.variables ?? {}) };

      // If there is already a pending task for this key, re-emit it
      // (don't create a new task ID — reuse the existing pending one)
      const existingPendingId = pendingByKey.get(key);
      if (existingPendingId) {
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

        pendingTasks.push(task);
        this.logger.info(`Re-emitting pending task for agent ${entry.agent}`, {
          taskId: existingPendingId,
          cron: entry.cron,
          agentName: entry.agent,
          variables: Object.keys(mergedVars).length > 0 ? mergedVars : undefined,
        });
        continue;
      }

      const taskId = crypto.randomUUID();

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

      newTasks.push(task);
      // Track as pending — do NOT update lastRuns yet
      this.pendingKeys.set(taskId, { key, addedAt: Date.now() });

      this.logger.info(`Scheduled task for agent ${entry.agent}`, {
        taskId,
        cron: entry.cron,
        agentName: entry.agent,
        variables: Object.keys(mergedVars).length > 0 ? mergedVars : undefined,
      });
    }

    if (needsSave) {
      await this.saveState();
    }

    // Return pending (previously undispatched) tasks first so they get priority.
    // Sort pending tasks by when they were originally added (FIFO) to ensure
    // the oldest undispatched tasks get dispatched before newer ones.
    const pendingOrder = new Map<string, number>();
    for (const [taskId, { addedAt }] of this.pendingKeys) {
      pendingOrder.set(taskId, addedAt);
    }
    pendingTasks.sort((a, b) => (pendingOrder.get(a.id) ?? 0) - (pendingOrder.get(b.id) ?? 0));

    return [...pendingTasks, ...newTasks];
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
      const entry = this.pendingKeys.get(taskId);
      if (entry) {
        this.state.lastRuns[entry.key] = new Date().toISOString();
        this.pendingKeys.delete(taskId);
        updated = true;
      }
    }

    if (updated) {
      await this.saveState();
    }
  }
}
