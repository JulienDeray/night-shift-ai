import { AgentRunner, type AgentRunnerOptions } from "./agent-runner.js";
import type { NightShiftTask, AgentExecutionResult } from "../core/types.js";
import type { Logger } from "../core/logger.js";

export interface TaskResult {
  task: NightShiftTask;
  result: AgentExecutionResult;
  startedAt: Date;
  completedAt: Date;
}

interface RunningTask {
  task: NightShiftTask;
  runner: AgentRunner;
  startedAt: Date;
  promise: Promise<TaskResult>;
}

export class AgentPool {
  private readonly maxConcurrent: number;
  private readonly workspaceDir: string;
  private readonly logger: Logger;
  private running: Map<string, RunningTask> = new Map();
  private completedQueue: TaskResult[] = [];

  constructor(options: {
    maxConcurrent: number;
    workspaceDir: string;
    logger: Logger;
  }) {
    this.maxConcurrent = options.maxConcurrent;
    this.workspaceDir = options.workspaceDir;
    this.logger = options.logger;
  }

  get activeCount(): number {
    return this.running.size;
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

    const runnerOpts: AgentRunnerOptions = {
      workspaceDir: this.workspaceDir,
      logger: this.logger,
    };

    const runner = new AgentRunner(runnerOpts);
    const startedAt = new Date();

    const promise = runner.run(task).then(
      (result) => {
        const completedAt = new Date();
        const taskResult: TaskResult = { task, result, startedAt, completedAt };
        this.running.delete(task.id);
        this.completedQueue.push(taskResult);
        return taskResult;
      },
      (err) => {
        const completedAt = new Date();
        const taskResult: TaskResult = {
          task,
          result: {
            sessionId: "",
            durationMs: completedAt.getTime() - startedAt.getTime(),
            totalCostUsd: 0,
            result: err instanceof Error ? err.message : String(err),
            isError: true,
            numTurns: 0,
          },
          startedAt,
          completedAt,
        };
        this.running.delete(task.id);
        this.completedQueue.push(taskResult);
        return taskResult;
      },
    );

    this.running.set(task.id, { task, runner, startedAt, promise });
    this.logger.info(`Dispatched task ${task.id} (${task.name})`, {
      activeCount: this.activeCount,
    });
  }

  collectCompleted(): TaskResult[] {
    const results = [...this.completedQueue];
    this.completedQueue = [];
    return results;
  }

  killAll(): void {
    for (const [id, entry] of this.running) {
      this.logger.info(`Killing task ${id}`);
      entry.runner.kill();
    }
  }

  async drain(): Promise<TaskResult[]> {
    const promises = Array.from(this.running.values()).map((r) => r.promise);
    await Promise.allSettled(promises);
    return this.collectCompleted();
  }
}
