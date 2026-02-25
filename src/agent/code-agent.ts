import { cloneRepo, cleanupDir } from "./git-harness.js";
import { runCodeAgentPipeline, type PipelineContext } from "./code-agent-runner.js";
import { appendRunLog, type RunLogEntry } from "./run-logger.js";
import { loadBeadPrompt } from "./prompt-loader.js";
import { runBead } from "./bead-runner.js";
import type { CodeAgentConfig } from "../core/types.js";
import type { CodeAgentRunResult } from "./types.js";
import type { Logger } from "../core/logger.js";

// Fixed 2-minute timeout for the log bead (per RESEARCH.md recommendation)
const LOG_BEAD_TIMEOUT_MS = 120_000;

// MCP Atlassian tools needed by the log bead
const LOG_BEAD_ALLOWED_TOOLS = [
  "mcp__atlassian__getAccessibleAtlassianResources",
  "mcp__atlassian__getConfluencePage",
  "mcp__atlassian__updateConfluencePage",
];

export async function runCodeAgent(
  config: CodeAgentConfig,
  configDir: string,
  options: {
    gitlabToken?: string;
    timeoutMs: number;
    logger: Logger;
    base?: string; // base dir for JSONL log path resolution
  },
): Promise<CodeAgentRunResult> {
  const { repoDir, handoffDir } = await cloneRepo(config.repoUrl, options.gitlabToken);

  try {
    const ctx: PipelineContext = {
      config,
      configDir,
      repoDir,
      handoffDir,
      gitlabToken: options.gitlabToken,
      timeoutMs: options.timeoutMs,
      logger: options.logger,
    };

    // Run the 4-bead pipeline (analyze -> implement -> verify -> mr)
    const result = await runCodeAgentPipeline(ctx);

    // LOG-01: Write local JSONL entry (harness-owned, not a bead)
    const logEntry: RunLogEntry = {
      date: new Date().toISOString(),
      category: result.categoryUsed,
      mr_url: result.mrUrl ?? null,
      cost_usd: result.totalCostUsd,
      duration_seconds: Math.round(result.totalDurationMs / 1000),
      summary: deriveSummary(result),
    };

    try {
      await appendRunLog(logEntry, options.base);
    } catch (err) {
      options.logger.error("Failed to write JSONL run log", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // LOG-02: Confluence log bead (best-effort, errors logged but not propagated)
    if (config.logMcpConfig) {
      try {
        await runLogBead(ctx, result, config.logMcpConfig, logEntry);
      } catch (err) {
        options.logger.error("Log bead failed — Confluence not updated", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      options.logger.warn("log_mcp_config not set — skipping Confluence update");
    }

    return result;
  } finally {
    // AGENT-02: Unconditional cleanup — even on crash or timeout
    await cleanupDir(repoDir);
    await cleanupDir(handoffDir);
  }
}

/**
 * Derives a short summary string from the pipeline result.
 *
 * For MR_CREATED: uses the MR URL or "MR created".
 * For NO_IMPROVEMENT: uses the reason.
 * For ABANDONED: uses "Abandoned after retries".
 */
export function deriveSummary(result: CodeAgentRunResult): string {
  switch (result.outcome) {
    case "MR_CREATED":
      return result.mrUrl ?? "MR created";
    case "NO_IMPROVEMENT":
      return result.reason ?? "No improvement found";
    case "ABANDONED":
      return result.reason ?? "Abandoned after retries";
  }
}

/**
 * Runs the 5th "log" bead to update the Confluence page.
 *
 * LOG-02: The log bead is the only bead that receives --mcp-config.
 * It uses MCP Atlassian tools to fetch the page, insert a row, and update.
 * Runs regardless of pipeline outcome (even NO_IMPROVEMENT gets a row).
 */
async function runLogBead(
  ctx: PipelineContext,
  result: CodeAgentRunResult,
  mcpConfigPath: string,
  logEntry: RunLogEntry,
): Promise<void> {
  const vars: Record<string, string> = {
    date: logEntry.date,
    category: logEntry.category,
    mr_url: logEntry.mr_url ?? "null",
    cost_usd: logEntry.cost_usd.toFixed(4),
    duration_seconds: logEntry.duration_seconds.toString(),
    summary: logEntry.summary,
    confluence_page_id: ctx.config.confluencePageId,
  };

  const prompt = await loadBeadPrompt(ctx.config.prompts.log, vars, ctx.configDir);

  await runBead({
    beadName: "log",
    prompt,
    model: "claude-sonnet-4-6",
    cwd: ctx.repoDir,
    timeoutMs: LOG_BEAD_TIMEOUT_MS,
    mcpConfigPath,
    allowedTools: LOG_BEAD_ALLOWED_TOOLS,
    // No gitlabToken — log bead must not receive it
  });

  // Suppress unused variable warning — result is passed for future extension
  void result;
}
