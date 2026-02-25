import { AgentRunner, type AgentRunnerOptions } from "./agent-runner.js";
import { runCodeAgent } from "../agent/code-agent.js";
import { parseTimeout } from "../utils/process.js";
import type { NightShiftTask, AgentExecutionResult, CodeAgentConfig } from "../core/types.js";
import type { CodeAgentRunResult } from "../agent/types.js";
import type { Logger } from "../core/logger.js";

export interface TaskResult {
  task: NightShiftTask;
  result: AgentExecutionResult;
  startedAt: Date;
  completedAt: Date;
}

interface RunningTask {
  task: NightShiftTask;
  runner: AgentRunner | null;
  startedAt: Date;
  promise: Promise<TaskResult>;
}

export class AgentPool {
  private readonly maxConcurrent: number;
  private readonly workspaceDir: string;
  private readonly logger: Logger;
  private readonly configDir: string;
  private codeAgentConfig?: CodeAgentConfig;
  private running: Map<string, RunningTask> = new Map();
  private completedQueue: TaskResult[] = [];

  constructor(options: {
    maxConcurrent: number;
    workspaceDir: string;
    logger: Logger;
    codeAgentConfig?: CodeAgentConfig;
    configDir?: string;
  }) {
    this.maxConcurrent = options.maxConcurrent;
    this.workspaceDir = options.workspaceDir;
    this.logger = options.logger;
    this.codeAgentConfig = options.codeAgentConfig;
    this.configDir = options.configDir ?? process.cwd();
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

  updateCodeAgentConfig(config?: CodeAgentConfig): void {
    this.codeAgentConfig = config;
  }

  dispatch(task: NightShiftTask): void {
    if (!this.canAccept()) {
      this.logger.warn(`Pool full, cannot accept task ${task.id}`);
      return;
    }

    // Code-agent dispatch path
    if (task.isCodeAgent && this.codeAgentConfig) {
      const startedAt = new Date();
      const promise = this.runCodeAgentTask(task, startedAt);
      this.running.set(task.id, { task, runner: null, startedAt, promise });
      this.logger.info(`Dispatched code-agent task ${task.id} (${task.name})`, {
        activeCount: this.activeCount,
      });
      return;
    }

    // Generic AgentRunner dispatch path
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

  private async runCodeAgentTask(task: NightShiftTask, startedAt: Date): Promise<TaskResult> {
    try {
      const timeoutMs = parseTimeout(task.timeout);
      const result = await runCodeAgent(this.codeAgentConfig!, this.configDir, {
        gitlabToken: process.env.GITLAB_TOKEN,
        timeoutMs,
        logger: this.logger,
      });

      const agentResult: AgentExecutionResult = {
        sessionId: "",
        durationMs: result.totalDurationMs,
        totalCostUsd: result.totalCostUsd,
        result: this.formatCodeAgentResult(result),
        isError: false,
        numTurns: 0,
      };

      const taskResult: TaskResult = { task, result: agentResult, startedAt, completedAt: new Date() };
      this.running.delete(task.id);
      this.completedQueue.push(taskResult);
      return taskResult;
    } catch (err) {
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
    }
  }

  private formatCodeAgentResult(result: CodeAgentRunResult): string {
    switch (result.outcome) {
      case "MR_CREATED":
        return `MR created: ${result.mrUrl ?? "unknown URL"} (category: ${result.categoryUsed})`;
      case "NO_IMPROVEMENT":
        return `No improvement found (category: ${result.categoryUsed}). ${result.reason ?? ""}`.trim();
      case "ABANDONED":
        return `Abandoned after retries (category: ${result.categoryUsed}). ${result.reason ?? ""}`.trim();
    }
  }

  collectCompleted(): TaskResult[] {
    const results = [...this.completedQueue];
    this.completedQueue = [];
    return results;
  }

  killAll(): void {
    for (const [id, entry] of this.running) {
      this.logger.info(`Killing task ${id}`);
      if (entry.runner) {
        entry.runner.kill();
      }
    }
  }

  async drain(): Promise<TaskResult[]> {
    const promises = Array.from(this.running.values()).map((r) => r.promise);
    await Promise.allSettled(promises);
    return this.collectCompleted();
  }
}
