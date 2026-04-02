import path from "node:path";
import { AgentEngine } from "../agent/engine.js";
import type { AgentRunResult } from "../agent/engine-types.js";
import type { NightShiftTask } from "../core/types.js";
import type { Logger } from "../core/logger.js";

export interface TaskResult {
  task: NightShiftTask;
  result: AgentRunResult;
  startedAt: Date;
  completedAt: Date;
}

interface RunningTask {
  task: NightShiftTask;
  startedAt: Date;
  promise: Promise<TaskResult>;
}

export class AgentPool {
  private readonly maxConcurrent: number;
  private readonly workspaceDir: string;
  private readonly logger: Logger;
  private readonly configDir: string;
  private readonly agentsDir: string;
  private running: Map<string, RunningTask> = new Map();
  private completedQueue: TaskResult[] = [];

  constructor(options: {
    maxConcurrent: number;
    workspaceDir: string;
    logger: Logger;
    configDir?: string;
    agentsDir?: string;
  }) {
    this.maxConcurrent = options.maxConcurrent;
    this.workspaceDir = options.workspaceDir;
    this.logger = options.logger;
    this.configDir = options.configDir ?? process.cwd();
    this.agentsDir = options.agentsDir ?? "./agents";
  }

  get activeCount(): number {
    return this.running.size;
  }

  /** Returns details of all currently-running tasks for status reporting. */
  get runningTasks(): Array<{ id: string; name: string; agentName: string; startedAt: Date }> {
    return Array.from(this.running.values()).map((r) => ({
      id: r.task.id,
      name: r.task.name,
      agentName: r.task.agentName ?? "unknown",
      startedAt: r.startedAt,
    }));
  }

  get availableSlots(): number {
    return this.maxConcurrent - this.running.size;
  }

  canAccept(): boolean {
    return this.running.size < this.maxConcurrent;
  }

  dispatch(task: NightShiftTask): void {
    if (!this.canAccept()) {
      this.logger.warn(`Pool full, cannot accept task ${task.id}`);
      return;
    }

    // Reject tasks without agentName immediately
    if (!task.agentName) {
      this.logger.warn(`Task ${task.id} rejected: agentName is required`);
      const startedAt = new Date();
      const completedAt = new Date();
      const fatalResult: AgentRunResult = {
        runId: "",
        agentName: "",
        status: "FATAL",
        finalOutput: null,
        perStep: [],
        totalDurationMs: 0,
        error: "Task rejected: agentName is required",
      };
      this.completedQueue.push({ task, result: fatalResult, startedAt, completedAt });
      return;
    }

    const startedAt = new Date();

    // Build agent paths
    const agentsRoot = path.resolve(this.configDir, this.agentsDir);
    const agentDir = path.join(agentsRoot, task.agentName);

    // Create engine directly (no registry)
    const engine = new AgentEngine(this.logger);

    const promise = engine.run(agentDir, agentsRoot, task.id, task.variables ?? {}).then(
      (result) => {
        const completedAt = new Date();
        const taskResult: TaskResult = { task, result, startedAt, completedAt };
        this.running.delete(task.id);
        this.completedQueue.push(taskResult);
        return taskResult;
      },
      (err) => {
        const completedAt = new Date();
        const fatalResult: AgentRunResult = {
          runId: "",
          agentName: task.agentName ?? "",
          status: "FATAL",
          finalOutput: null,
          perStep: [],
          totalDurationMs: completedAt.getTime() - startedAt.getTime(),
          error: err instanceof Error ? err.message : String(err),
        };
        const taskResult: TaskResult = { task, result: fatalResult, startedAt, completedAt };
        this.running.delete(task.id);
        this.completedQueue.push(taskResult);
        return taskResult;
      },
    );

    this.running.set(task.id, { task, startedAt, promise });
    this.logger.info(`Dispatched task ${task.id} (${task.name})`, {
      activeCount: this.activeCount,
      agentName: task.agentName,
    });
  }

  collectCompleted(): TaskResult[] {
    const results = [...this.completedQueue];
    this.completedQueue = [];
    return results;
  }

  killAll(): void {
    for (const [id] of this.running) {
      this.logger.warn(
        `Task ${id}: AgentEngine runs cannot be interrupted — in-progress steps will complete (future improvement)`,
      );
    }
  }

  async drain(): Promise<TaskResult[]> {
    const promises = Array.from(this.running.values()).map((r) => r.promise);
    await Promise.allSettled(promises);
    return this.collectCompleted();
  }
}
