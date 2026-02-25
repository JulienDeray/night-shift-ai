import fs from "node:fs/promises";
import path from "node:path";
import { spawnWithTimeout } from "../utils/process.js";
import { loadBeadPrompt } from "./prompt-loader.js";
import { runBead } from "./bead-runner.js";
import { resolveCategory } from "../daemon/scheduler.js";
import type { CodeAgentConfig } from "../core/types.js";
import type { AnalysisResult, BeadResult, CodeAgentRunResult } from "./types.js";
import type { Logger } from "../core/logger.js";
import type { ClaudeJsonOutput } from "../core/types.js";

// Fixed fallback priority order per locked CONTEXT.md decision
const FALLBACK_ORDER = [
  "tests",
  "refactoring",
  "docs",
  "security",
  "performance",
] as const;

// 3 total attempts (1 initial + 2 retries) per locked CONTEXT.md decision
const MAX_IMPLEMENT_RETRIES = 2;

// Category-specific guidance text (locked in CONTEXT.md — not configurable)
const CATEGORY_GUIDANCE: Record<string, string> = {
  tests:
    "Missing unit test coverage first, then improve existing test quality (better assertions, edge cases, flakiness reduction)",
  refactoring:
    "Broad scope — code duplication, complexity reduction, naming improvements, dead code removal, pattern consistency",
  docs: "Code-level documentation (comments, Scaladoc) first, then project-level docs (README, markdown files) if no code gaps found",
  security:
    "Active vulnerabilities first (OWASP-style: injection, auth bypass, insecure defaults, data exposure), then defensive hardening (input validation, secure error handling, safe logging)",
  performance:
    "Identify and address performance bottlenecks — inefficient algorithms, unnecessary allocations, suboptimal data structures, missing caching opportunities",
};

export interface PipelineContext {
  config: CodeAgentConfig;
  configDir: string; // directory containing nightshift.yaml
  repoDir: string; // cloned repo temp directory (cwd for beads)
  handoffDir: string; // temp directory for JSON handoff files
  gitlabToken?: string; // from env, forwarded only to MR bead
  timeoutMs: number; // per-bead timeout
  logger: Logger;
}

/**
 * Constructs the template variable map.
 *
 * Uses an explicit allowlist — NEVER spreads process.env.
 * This prevents any environment variable (including GITLAB_TOKEN) from
 * accidentally ending up as a template variable.
 */
function buildBuiltInVars(
  config: CodeAgentConfig,
  category: string,
  categoryGuidance: string,
  handoffFile: string,
): Record<string, string> {
  return {
    category,
    category_guidance: categoryGuidance,
    repo_url: config.repoUrl,
    handoff_file: handoffFile,
    allowed_commands: config.allowedCommands.join(", "),
    reviewer: config.reviewer ?? "",
    ...config.variables, // user-defined static vars only
  };
}

/**
 * Resets the repo to a clean state between Implement retries.
 *
 * Runs `git reset --hard HEAD` via spawnWithTimeout to clear failed
 * Implement bead changes before retry (avoids Pitfall 6 from RESEARCH.md).
 */
async function resetRepo(repoDir: string): Promise<void> {
  const { result } = spawnWithTimeout("git", ["reset", "--hard", "HEAD"], {
    cwd: repoDir,
  });
  await result;
}

interface AnalyzeBeadResult {
  result: AnalysisResult;
  cost: number;
  duration: number;
}

async function runAnalyzeBead(
  ctx: PipelineContext,
  category: string,
  categoryGuidance: string,
): Promise<AnalyzeBeadResult> {
  const handoffFile = path.join(ctx.handoffDir, "analysis.json");

  // Write stub before spawning (safety net: Pitfall 3 from RESEARCH.md)
  await fs.writeFile(
    handoffFile,
    JSON.stringify({ result: "NO_IMPROVEMENT", reason: "pending" }),
    "utf-8",
  );

  const vars = buildBuiltInVars(ctx.config, category, categoryGuidance, handoffFile);
  const prompt = await loadBeadPrompt(ctx.config.prompts.analyze, vars, ctx.configDir);

  const beadResult = await runBead({
    beadName: "analyze",
    prompt,
    model: "claude-opus-4-6",
    cwd: ctx.repoDir,
    timeoutMs: ctx.timeoutMs,
    maxTokens: ctx.config.maxTokens,
    // No gitlabToken — analyze bead must not receive it
  });

  // Read and parse the handoff JSON file (agent should have overwritten the stub)
  let analysisResult: AnalysisResult;
  try {
    const raw = await fs.readFile(handoffFile, "utf-8");
    analysisResult = JSON.parse(raw) as AnalysisResult;
  } catch {
    analysisResult = {
      result: "NO_IMPROVEMENT",
      categoryUsed: category,
      reason: "Failed to read analysis handoff file",
    };
  }

  return {
    result: analysisResult,
    cost: beadResult.costUsd,
    duration: beadResult.durationMs,
  };
}

interface ImplementBeadResult {
  beadResult: BeadResult;
  costUsd: number;
  durationMs: number;
}

async function runImplementBead(
  ctx: PipelineContext,
  category: string,
  categoryGuidance: string,
  verifyError: string,
): Promise<ImplementBeadResult> {
  const analysisFile = path.join(ctx.handoffDir, "analysis.json");

  const vars = {
    ...buildBuiltInVars(ctx.config, category, categoryGuidance, analysisFile),
    analysis_file: analysisFile,
    verify_error: verifyError,
  };

  const prompt = await loadBeadPrompt(ctx.config.prompts.implement, vars, ctx.configDir);

  const beadResult = await runBead({
    beadName: "implement",
    prompt,
    model: "claude-opus-4-6",
    cwd: ctx.repoDir,
    timeoutMs: ctx.timeoutMs,
    maxTokens: ctx.config.maxTokens,
    // No gitlabToken — implement bead must not receive it
  });

  return {
    beadResult,
    costUsd: beadResult.costUsd,
    durationMs: beadResult.durationMs,
  };
}

interface VerifyBeadResult {
  passed: boolean;
  errorDetails: string;
  cost: number;
  duration: number;
}

async function runVerifyBead(
  ctx: PipelineContext,
  category: string,
  categoryGuidance: string,
): Promise<VerifyBeadResult> {
  const verifyHandoffFile = path.join(ctx.handoffDir, "verify.json");

  // Write stub before spawning (safety net)
  await fs.writeFile(
    verifyHandoffFile,
    JSON.stringify({ passed: false, error_details: "pending" }),
    "utf-8",
  );

  const vars = {
    ...buildBuiltInVars(ctx.config, category, categoryGuidance, verifyHandoffFile),
    handoff_file: verifyHandoffFile,
  };

  const prompt = await loadBeadPrompt(ctx.config.prompts.verify, vars, ctx.configDir);

  const beadResult = await runBead({
    beadName: "verify",
    prompt,
    model: "claude-sonnet-4-6",
    cwd: ctx.repoDir,
    timeoutMs: ctx.timeoutMs,
    maxTokens: ctx.config.maxTokens,
    // No gitlabToken — verify bead must not receive it
  });

  // Read and parse verify handoff file
  let passed = false;
  let errorDetails = "";
  try {
    const raw = await fs.readFile(verifyHandoffFile, "utf-8");
    const parsed = JSON.parse(raw) as { passed: boolean; error_details?: string };
    passed = parsed.passed ?? false;
    errorDetails = parsed.error_details ?? "";
  } catch {
    passed = false;
    errorDetails = "Failed to read verify handoff file";
  }

  return {
    passed,
    errorDetails,
    cost: beadResult.costUsd,
    duration: beadResult.durationMs,
  };
}

interface MrBeadResult {
  mrUrl: string | undefined;
  cost: number;
  duration: number;
}

async function runMrBead(
  ctx: PipelineContext,
  category: string,
  categoryGuidance: string,
  actualCategory: string,
): Promise<MrBeadResult> {
  const analysisFile = path.join(ctx.handoffDir, "analysis.json");

  // Derive short_description from the analysis selected candidate if available
  let shortDescription = `${category} improvement`;
  try {
    const raw = await fs.readFile(analysisFile, "utf-8");
    const analysis = JSON.parse(raw) as AnalysisResult;
    if (analysis.selected?.description) {
      shortDescription = analysis.selected.description.slice(0, 80);
    }
  } catch {
    // Use default short description
  }

  const vars = {
    ...buildBuiltInVars(ctx.config, category, categoryGuidance, analysisFile),
    analysis_file: analysisFile,
    short_description: shortDescription,
    category: actualCategory,
  };

  const prompt = await loadBeadPrompt(ctx.config.prompts.mr, vars, ctx.configDir);

  // AGENT-08: This is the ONLY bead that receives gitlabToken
  const beadResult = await runBead({
    beadName: "mr",
    prompt,
    model: "claude-sonnet-4-6",
    cwd: ctx.repoDir,
    timeoutMs: ctx.timeoutMs,
    maxTokens: ctx.config.maxTokens,
    gitlabToken: ctx.gitlabToken, // Only MR bead gets the token
  });

  // Extract MR URL from claude JSON output result field
  let mrUrl: string | undefined;
  if (beadResult.stdout) {
    try {
      const parsed = JSON.parse(beadResult.stdout) as ClaudeJsonOutput;
      const urlMatch = parsed.result?.match(/https?:\/\/[^\s]+\/merge_requests\/\d+/);
      if (urlMatch) {
        mrUrl = urlMatch[0];
      }
    } catch {
      // Try matching URL directly in stdout if JSON parse fails
      const urlMatch = beadResult.stdout.match(
        /https?:\/\/[^\s]+\/merge_requests\/\d+/,
      );
      if (urlMatch) {
        mrUrl = urlMatch[0];
      }
    }
  }

  return {
    mrUrl,
    cost: beadResult.costUsd,
    duration: beadResult.durationMs,
  };
}

/**
 * Runs the complete 4-bead code improvement pipeline.
 *
 * Pipeline: Analyze -> Implement -> Verify -> MR
 *
 * Features:
 * - Category fallback: if the scheduled category yields NO_IMPROVEMENT,
 *   tries remaining categories in fixed order (tests/refactoring/docs/security/performance)
 * - Implement retry: retries Implement+Verify up to MAX_IMPLEMENT_RETRIES times after verify failure
 * - Token isolation: gitlabToken only forwarded to the MR bead (AGENT-08)
 * - Repo state reset: git reset --hard HEAD between Implement retries (Pitfall 6 avoidance)
 * - Cost/duration tracking: accumulated across all bead invocations
 */
export async function runCodeAgentPipeline(
  ctx: PipelineContext,
): Promise<CodeAgentRunResult> {
  const primaryCategory = resolveCategory(ctx.config.categorySchedule);

  if (!primaryCategory) {
    return {
      outcome: "NO_IMPROVEMENT",
      categoryUsed: "none",
      isFallback: false,
      reason: "No category scheduled for today",
      totalCostUsd: 0,
      totalDurationMs: 0,
    };
  }

  const categoriesToTry = [
    primaryCategory,
    ...FALLBACK_ORDER.filter((c) => c !== primaryCategory),
  ];

  let totalCost = 0;
  let totalDuration = 0;
  const categoryReasons: Record<string, string> = {};

  for (const [index, category] of categoriesToTry.entries()) {
    const isFallback = index > 0;
    const guidance = CATEGORY_GUIDANCE[category] ?? category;

    ctx.logger.info(`Running analyze bead for category: ${category}`, {
      isFallback,
      attempt: index + 1,
      total: categoriesToTry.length,
    });

    // Analyze
    const analysis = await runAnalyzeBead(ctx, category, guidance);
    totalCost += analysis.cost;
    totalDuration += analysis.duration;

    if (analysis.result.result === "NO_IMPROVEMENT") {
      categoryReasons[category] =
        analysis.result.reason ?? "no improvement found";
      ctx.logger.info(
        `Category ${category} yielded NO_IMPROVEMENT, trying fallback`,
        { reason: categoryReasons[category] },
      );
      continue; // try next category
    }

    ctx.logger.info(`Improvement found for category: ${category}`, {
      selected: analysis.result.selected?.description,
    });

    // Implement + Verify loop (up to MAX_IMPLEMENT_RETRIES + 1 total attempts)
    let verifyPassed = false;
    let lastError = "";

    for (
      let attempt = 0;
      attempt < MAX_IMPLEMENT_RETRIES + 1;
      attempt++
    ) {
      // Reset repo to clean state before retry (not on first attempt)
      if (attempt > 0) {
        ctx.logger.info(
          `Resetting repo state before Implement retry ${attempt}`,
        );
        await resetRepo(ctx.repoDir);
      }

      ctx.logger.info(
        `Running implement bead (attempt ${attempt + 1}/${MAX_IMPLEMENT_RETRIES + 1})`,
      );

      const implResult = await runImplementBead(
        ctx,
        category,
        guidance,
        lastError,
      );
      totalCost += implResult.costUsd;
      totalDuration += implResult.durationMs;

      ctx.logger.info(`Running verify bead (attempt ${attempt + 1})`);

      const verifyResult = await runVerifyBead(ctx, category, guidance);
      totalCost += verifyResult.cost;
      totalDuration += verifyResult.duration;

      if (verifyResult.passed) {
        verifyPassed = true;
        break;
      }

      lastError = verifyResult.errorDetails;
      ctx.logger.warn(`Verify failed on attempt ${attempt + 1}`, {
        errorDetails: lastError.slice(0, 200),
      });
    }

    if (!verifyPassed) {
      // Reset to clean state before trying next category
      await resetRepo(ctx.repoDir);
      categoryReasons[category] = "verify failed after retries";
      ctx.logger.warn(
        `Category ${category} failed verify after all retries, trying fallback`,
      );
      continue; // try next category via fallback
    }

    // MR bead
    const actualCategory = isFallback
      ? `${category} (fallback from ${primaryCategory})`
      : category;

    ctx.logger.info(`Running MR bead for category: ${actualCategory}`);

    const mrResult = await runMrBead(ctx, category, guidance, actualCategory);
    totalCost += mrResult.cost;
    totalDuration += mrResult.duration;

    return {
      outcome: "MR_CREATED",
      mrUrl: mrResult.mrUrl,
      categoryUsed: actualCategory,
      isFallback,
      totalCostUsd: totalCost,
      totalDurationMs: totalDuration,
    };
  }

  // All categories exhausted
  const summary = Object.entries(categoryReasons)
    .map(([cat, reason]) => `${cat}: ${reason}`)
    .join("; ");

  ctx.logger.info("All categories exhausted, returning NO_IMPROVEMENT", {
    summary,
  });

  return {
    outcome: "NO_IMPROVEMENT",
    categoryUsed: primaryCategory,
    isFallback: false,
    reason: `All categories exhausted. ${summary}`,
    summary,
    totalCostUsd: totalCost,
    totalDurationMs: totalDuration,
  };
}
