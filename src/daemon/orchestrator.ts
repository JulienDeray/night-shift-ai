import path from "node:path";
import { loadConfig } from "../core/config.js";
import { getWorkspaceDir, ensureNightShiftDirs, getConfigPath } from "../core/paths.js";
import { Logger } from "../core/logger.js";
import { Scheduler } from "./scheduler.js";
import { AgentPool, type TaskResult } from "./agent-pool.js";
import { writeDaemonState, writePidFile, removePidFile } from "./health.js";
import { writeReport } from "../inbox/reporter.js";
import { readJsonFile } from "../utils/fs.js";
import { getQueueDir } from "../core/paths.js";
import type { DaemonState, NightShiftConfig, NightShiftTask } from "../core/types.js";
import { NtfyClient } from "../notifications/ntfy-client.js";
import { NotificationService } from "../notifications/notification-service.js";
import fs from "node:fs/promises";
import { loadManifest } from "../agent/manifest-loader.js";
import { BUILT_IN_VARS, RESERVED_VAR_NAMES, validateTemplateVars } from "../agent/template.js";
import { NightShiftError } from "../core/errors.js";
import type { LoadedManifest } from "../agent/manifest-types.js";
import type { AgentRunResult } from "../agent/engine-types.js";
import { appendRunLog } from "../agent/run-logger.js";

/**
 * Validates all declared agents at daemon startup before the first poll tick.
 * Collects ALL errors across all agents and reports them together.
 * Throws ConfigError if any validation fails.
 * Is a no-op when config.agents is empty.
 */
export async function validateAgentsAtStartup(
  config: NightShiftConfig,
  configDir: string,
): Promise<void> {
  if (config.agents.length === 0) return;

  const agentsRoot = path.resolve(configDir, config.agentsDir);

  // Collect all schedule-level variable overrides per agent
  const scheduleVarsByAgent = new Map<string, Record<string, string>[]>();
  for (const entry of config.schedule) {
    if (!scheduleVarsByAgent.has(entry.agent)) {
      scheduleVarsByAgent.set(entry.agent, []);
    }
    if (entry.variables) {
      scheduleVarsByAgent.get(entry.agent)!.push(entry.variables);
    }
  }

  const errors: string[] = [];

  // --- Pass 1: Load manifests and validate per-agent (prompts, template vars) ---
  const manifestsByAgent = new Map<string, LoadedManifest>();

  for (const agent of config.agents) {
    const agentDir = path.join(agentsRoot, agent.name);
    try {
      // Load and validate manifest (handles path containment, Zod validation, env var resolution)
      const manifest = await loadManifest(agentDir, agentsRoot);
      manifestsByAgent.set(agent.name, manifest);

      // For each step, validate prompt file exists and template vars resolve
      for (const step of manifest.steps) {
        const promptPath = path.join(manifest.agentDir, step.prompt);
        let promptContent: string;
        try {
          promptContent = await fs.readFile(promptPath, "utf-8");
        } catch {
          errors.push(
            `Agent '${agent.name}', step '${step.name}': prompt file not found: ${promptPath}`,
          );
          continue; // Skip template validation for missing prompt
        }

        // Build full variable map for template validation:
        // built-in placeholders + manifest vars + agent-level config overrides + all schedule-level overrides
        const builtInPlaceholders: Record<string, string> = Object.fromEntries(
          BUILT_IN_VARS.map((v) => [v, `<${v}>`]),
        );
        const allKnownVars: Record<string, unknown> = {
          ...manifest.variables,
          ...(agent.variables ?? {}),
          ...builtInPlaceholders,
        };
        // Include state_dir if manifest declares stateDir
        if (manifest.stateDir) {
          allKnownVars.state_dir = `<state_dir>`;
        }
        // Include import variable names as placeholders (paths validated in Pass 2)
        if (manifest.rawImports) {
          for (const varName of Object.keys(manifest.rawImports)) {
            allKnownVars[varName] = `<import:${varName}>`;
          }
        }
        // Merge all schedule-level overrides for this agent
        const scheduleOverrides = scheduleVarsByAgent.get(agent.name) ?? [];
        for (const overrides of scheduleOverrides) {
          Object.assign(allKnownVars, overrides);
        }

        try {
          validateTemplateVars(promptContent, allKnownVars);
        } catch (err) {
          errors.push(
            `Agent '${agent.name}', step '${step.name}': ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      // loadManifest can throw ManifestError, ManifestSecurityError, etc.
      errors.push(
        `Agent '${agent.name}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // --- Pass 2: Cross-agent import validation ---
  for (const [agentName, manifest] of manifestsByAgent) {
    if (!manifest.rawImports) continue;

    for (const [varName, importSpec] of Object.entries(manifest.rawImports)) {
      // Parse "agentName/dirName" (schema already validated this pattern in T01)
      const slashIdx = importSpec.indexOf("/");
      const referencedAgent = importSpec.slice(0, slashIdx);
      const dirName = importSpec.slice(slashIdx + 1);

      // Check that the referenced agent exists in loaded manifests
      if (!manifestsByAgent.has(referencedAgent)) {
        errors.push(
          `Agent '${agentName}': import '${varName}' references agent '${referencedAgent}' which is not declared in config.agents`,
        );
        continue;
      }

      // Validate the import variable name doesn't collide with reserved names
      if (RESERVED_VAR_NAMES.includes(varName)) {
        errors.push(
          `Agent '${agentName}': import variable '${varName}' collides with reserved name`,
        );
        continue;
      }

      // Resolve the import to an absolute path
      const resolvedPath = path.join(agentsRoot, referencedAgent, dirName);

      // Check that the resolved directory exists on disk
      try {
        await fs.access(resolvedPath);
      } catch {
        errors.push(
          `Agent '${agentName}': import '${varName}' references directory '${resolvedPath}' which does not exist`,
        );
        continue;
      }

      // Store resolved absolute path in manifest.resolvedImports
      if (!manifest.resolvedImports) {
        manifest.resolvedImports = {};
      }
      manifest.resolvedImports[varName] = resolvedPath;
    }
  }

  if (errors.length > 0) {
    const msg =
      `Startup validation failed — ${errors.length} error(s) across agent(s):\n\n` +
      errors.map((e, i) => `  [${i + 1}] ${e}`).join("\n\n");
    throw new NightShiftError(msg, "CONFIG");
  }
}

export class Orchestrator {
  private config!: NightShiftConfig;
  private logger!: Logger;
  private scheduler!: Scheduler;
  private pool!: AgentPool;
  private notificationService!: NotificationService;
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

    const workspaceDir = getWorkspaceDir(this.config.workspace);
    this.pool = new AgentPool({
      maxConcurrent: this.config.maxConcurrent,
      workspaceDir,
      logger: this.logger,
      configDir: path.dirname(getConfigPath()),
      agentsDir: this.config.agentsDir,
    });

    const ntfy = this.config.ntfy ? new NtfyClient(this.config.ntfy) : null;
    this.notificationService = new NotificationService(ntfy, this.logger);

    await ensureNightShiftDirs();
    await this.scheduler.loadState();
    await this.scheduler.fastForwardStaleEntries();
    await writePidFile(process.pid);
    await this.writeHeartbeat();

    // Validate all agent manifests before entering poll loop
    await validateAgentsAtStartup(this.config, path.dirname(getConfigPath()));

    this.logger.info("Daemon started", {
      pid: process.pid,
      maxConcurrent: this.config.maxConcurrent,
      pollInterval: this.config.daemon.pollIntervalMs,
      agents: this.config.agents.length,
      scheduleEntries: this.config.schedule.length,
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
    // 0. Hot-reload defaultTimeout from config
    try {
      const freshConfig = await loadConfig();
      this.config.defaultTimeout = freshConfig.defaultTimeout;
      this.scheduler.updateConfig(this.config);
    } catch (err) {
      this.logger.warn("Failed to reload config, continuing with previous", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 1. Collect completed tasks FIRST to free pool slots
    const completed = this.pool.collectCompleted();
    for (const taskResult of completed) {
      await this.handleCompleted(taskResult);
    }

    // 2. Evaluate cron schedules and dispatch due tasks
    const scheduledTasks = await this.scheduler.evaluateSchedules();
    const dispatchedIds: string[] = [];
    let tickDispatches = 0;
    for (const task of scheduledTasks) {
      if (!this.pool.canAccept()) break;
      if (tickDispatches >= this.config.maxDispatchesPerTick) break;
      this.pool.dispatch(task);
      tickDispatches++;
      dispatchedIds.push(task.id);
      this.notificationService.taskStarted(task);
    }
    if (tickDispatches >= this.config.maxDispatchesPerTick) {
      this.logger.debug("Per-tick dispatch cap reached", { limit: this.config.maxDispatchesPerTick });
    }
    // Confirm only actually-dispatched tasks so undispatched ones are retried
    await this.scheduler.confirmDispatched(dispatchedIds);

    // 3. Poll file queue for ready tasks and dispatch
    if (this.pool.canAccept() && tickDispatches < this.config.maxDispatchesPerTick) {
      const readyTasks = await this.getQueuedTasks();
      for (const task of readyTasks) {
        if (!this.pool.canAccept()) break;
        if (tickDispatches >= this.config.maxDispatchesPerTick) {
          this.logger.debug("Per-tick dispatch cap reached", { limit: this.config.maxDispatchesPerTick });
          break;
        }

        // Claim the task
        const claimed = await this.claimTask(task);
        if (claimed) {
          this.pool.dispatch(task);
          tickDispatches++;
          this.notificationService.taskStarted(task);
        }
      }
    }

    // Update state
    this.state.activeTasks = this.pool.activeCount;
    this.state.runningTaskDetails = this.pool.runningTasks.map((t) => ({
      id: t.id,
      name: t.name,
      agentName: t.agentName,
      startedAt: t.startedAt.toISOString(),
    }));
    this.state.pendingTaskCount = this.scheduler.pendingCount;
    await this.writeHeartbeat();
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
      status: result.status === "SUCCESS" ? "completed" : "failed",
      runId: result.runId,
      durationMs: result.totalDurationMs,
      perStep: result.perStep.map((s) => ({ name: s.name, status: s.status })),
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

    // File-based: remove from queue
    try {
      await fs.unlink(path.join(getQueueDir(), `${task.id}.json`));
    } catch {
      // ignore
    }

    // Update stats
    this.state.totalExecuted++;
    // totalCostUsd stays 0 — AgentRunResult has no cost tracking

    // JSONL logging — post-run hook, best-effort
    try {
      const summary = result.status === "SUCCESS"
        ? (typeof result.finalOutput === "string"
            ? result.finalOutput.slice(0, 200)
            : JSON.stringify(result.finalOutput)?.slice(0, 200) ?? "")
        : result.error?.slice(0, 200) ?? "Unknown error";
      await appendRunLog({
        date: new Date().toISOString(),
        run_id: result.runId,
        agent_name: result.agentName,
        final_output: result.finalOutput,
        duration_seconds: Math.round(result.totalDurationMs / 1000),
        summary,
      });
    } catch (logErr) {
      this.logger.warn("Failed to write run log", {
        error: logErr instanceof Error ? logErr.message : String(logErr),
      });
    }

    // Notify — route early-exit results to dedicated handler
    if (result.earlyExitReason !== undefined) {
      this.notificationService.taskEarlyExit(task, result);
    } else {
      this.notificationService.taskCompleted(task, result);
    }
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
