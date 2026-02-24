import path from "node:path";
import { loadConfig } from "../core/config.js";
import { getWorkspaceDir, ensureNightShiftDirs } from "../core/paths.js";
import { Logger } from "../core/logger.js";
import { BeadsClient } from "../beads/client.js";
import { fromBead } from "../beads/mapper.js";
import { Scheduler } from "./scheduler.js";
import { AgentPool, type TaskResult } from "./agent-pool.js";
import { writeDaemonState, writePidFile, removePidFile } from "./health.js";
import { writeReport } from "../inbox/reporter.js";
import { readJsonFile } from "../utils/fs.js";
import { getQueueDir } from "../core/paths.js";
import type { AgentExecutionResult, DaemonState, NightShiftConfig, NightShiftTask } from "../core/types.js";
import { NtfyClient } from "../notifications/ntfy-client.js";
import fs from "node:fs/promises";

export class Orchestrator {
  private config!: NightShiftConfig;
  private logger!: Logger;
  private scheduler!: Scheduler;
  private pool!: AgentPool;
  private beads: BeadsClient | null = null;
  private ntfy: NtfyClient | null = null;
  private stopping = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private state: DaemonState = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    activeTasks: 0,
    totalExecuted: 0,
    totalCostUsd: 0,
    status: "running",
  };

  async start(): Promise<void> {
    this.config = await loadConfig();
    this.logger = await Logger.createDaemonLogger();
    this.scheduler = new Scheduler(this.config, this.logger);
    this.beads = this.config.beads.enabled ? new BeadsClient() : null;

    const workspaceDir = getWorkspaceDir(this.config.workspace);
    this.pool = new AgentPool({
      maxConcurrent: this.config.maxConcurrent,
      workspaceDir,
      logger: this.logger,
    });

    this.ntfy = this.config.ntfy ? new NtfyClient(this.config.ntfy) : null;

    await ensureNightShiftDirs();
    await this.scheduler.loadState();
    await writePidFile(process.pid);
    await this.writeHeartbeat();

    this.logger.info("Daemon started", {
      pid: process.pid,
      maxConcurrent: this.config.maxConcurrent,
      pollInterval: this.config.daemon.pollIntervalMs,
      beadsEnabled: this.config.beads.enabled,
      recurringTasks: this.config.recurring.length,
    });

    // Start heartbeat
    this.heartbeatTimer = setInterval(
      () => void this.writeHeartbeat(),
      this.config.daemon.heartbeatIntervalMs,
    );

    // Start poll loop
    await this.pollLoop();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.state.status = "stopping";
    await this.writeHeartbeat();

    this.logger.info("Daemon stopping, draining active tasks...");

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Drain active tasks
    const remaining = await this.pool.drain();
    for (const taskResult of remaining) {
      await this.handleCompleted(taskResult);
    }

    this.state.status = "stopped";
    await this.writeHeartbeat();
    await removePidFile();

    this.logger.info("Daemon stopped", {
      totalExecuted: this.state.totalExecuted,
      totalCost: this.state.totalCostUsd,
    });
  }

  private async pollLoop(): Promise<void> {
    if (this.stopping) return;

    try {
      await this.tick();
    } catch (err) {
      this.logger.error("Poll loop error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (!this.stopping) {
      this.pollTimer = setTimeout(
        () => void this.pollLoop(),
        this.config.daemon.pollIntervalMs,
      );
    }
  }

  private async tick(): Promise<void> {
    // 0. Hot-reload recurring tasks and defaultTimeout from config
    try {
      const freshConfig = await loadConfig();
      this.config.recurring = freshConfig.recurring;
      this.config.defaultTimeout = freshConfig.defaultTimeout;
      this.scheduler.updateConfig(this.config);
    } catch (err) {
      this.logger.warn("Failed to reload config, continuing with previous", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 1. Evaluate cron schedules → create beads for due recurring tasks
    await this.scheduler.evaluateSchedules();

    // 2. Collect completed tasks
    const completed = this.pool.collectCompleted();
    for (const taskResult of completed) {
      await this.handleCompleted(taskResult);
    }

    // 3. Poll for ready tasks and dispatch
    if (this.pool.canAccept()) {
      const readyTasks = await this.getReadyTasks();
      for (const task of readyTasks) {
        if (!this.pool.canAccept()) break;

        // Claim the task
        const claimed = await this.claimTask(task);
        if (claimed) {
          this.pool.dispatch(task);
          this.notifyTaskStart(task);
        }
      }
    }

    // Update state
    this.state.activeTasks = this.pool.activeCount;
    await this.writeHeartbeat();
  }

  private async getReadyTasks(): Promise<NightShiftTask[]> {
    if (this.beads) {
      try {
        const ready = await this.beads.listReady();
        return ready.map(fromBead);
      } catch (err) {
        this.logger.error("Failed to list ready beads", {
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    }

    // File-based queue fallback
    return this.getQueuedTasks();
  }

  private async getQueuedTasks(): Promise<NightShiftTask[]> {
    const queueDir = getQueueDir();
    let files: string[];
    try {
      files = await fs.readdir(queueDir);
    } catch {
      return [];
    }

    const tasks: NightShiftTask[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const task = await readJsonFile<NightShiftTask>(
        path.join(queueDir, file),
      );
      if (task && task.status === "pending") {
        tasks.push(task);
      }
    }
    return tasks;
  }

  private async claimTask(task: NightShiftTask): Promise<boolean> {
    if (this.beads) {
      try {
        await this.beads.update(task.id, { claim: true });
        return true;
      } catch (err) {
        this.logger.warn(`Failed to claim bead ${task.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    }

    // File-based: update status in queue file
    const queuePath = path.join(getQueueDir(), `${task.id}.json`);
    try {
      const { writeJsonFile: writeJson } = await import("../utils/fs.js");
      await writeJson(queuePath, { ...task, status: "running" });
      return true;
    } catch {
      return false;
    }
  }

  private async handleCompleted(taskResult: TaskResult): Promise<void> {
    const { task, result, startedAt, completedAt } = taskResult;

    this.logger.info(`Task ${task.id} (${task.name}) completed`, {
      status: result.isError ? "failed" : "completed",
      costUsd: result.totalCostUsd,
      durationMs: result.durationMs,
    });

    // Write inbox report
    try {
      const reportPath = await writeReport(task, result, startedAt, completedAt);
      this.logger.info(`Report written: ${reportPath}`);
    } catch (err) {
      this.logger.error(`Failed to write report for task ${task.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Close bead
    if (this.beads) {
      try {
        if (result.isError) {
          await this.beads.update(task.id, {
            labels: ["nightshift:failed"],
          });
        }
        await this.beads.close(task.id);
      } catch (err) {
        this.logger.error(`Failed to close bead ${task.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      // File-based: remove from queue
      try {
        await fs.unlink(path.join(getQueueDir(), `${task.id}.json`));
      } catch {
        // ignore
      }
    }

    // Update stats
    this.state.totalExecuted++;
    this.state.totalCostUsd += result.totalCostUsd;

    // Notify
    this.notifyTaskEnd(task, result);
  }

  private notifyTaskStart(task: NightShiftTask): void {
    if (!this.ntfy || !task.notify) return;
    const body = task.category
      ? `Category: ${task.category}`
      : "Running\u2026";
    void this.ntfy.send(
      {
        title: `Night-shift started: ${task.name}`,
        body,
        priority: 3,
      },
      this.logger,
    );
  }

  private notifyTaskEnd(task: NightShiftTask, result: AgentExecutionResult): void {
    if (!this.ntfy || !task.notify) return;
    const isFailure = result.isError;
    void this.ntfy.send(
      {
        title: isFailure
          ? `Night-shift FAILED: ${task.name}`
          : `Night-shift done: ${task.name}`,
        body: isFailure
          ? `Error: ${result.result.slice(0, 200)}`
          : `Cost: $${result.totalCostUsd.toFixed(2)} \u2014 ${result.result.slice(0, 200)}`,
        priority: isFailure ? 4 : 3,
      },
      this.logger,
    );
  }

  private async writeHeartbeat(): Promise<void> {
    this.state.lastHeartbeat = new Date().toISOString();
    try {
      await writeDaemonState(this.state);
    } catch (err) {
      this.logger.error("Failed to write heartbeat", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
