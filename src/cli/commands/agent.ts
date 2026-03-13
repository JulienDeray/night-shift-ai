import { Command } from "@commander-js/extra-typings";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { Cron } from "croner";
import { formatDistanceToNow } from "date-fns";
import { scaffoldAgent } from "../../agent/scaffold.js";
import { loadManifest } from "../../agent/manifest-loader.js";
import { ManifestSchema } from "../../agent/manifest-schema.js";
import { validateTemplateVars, BUILT_IN_VARS } from "../../agent/template.js";
import { loadConfig } from "../../core/config.js";
import { getLogsDir } from "../../core/paths.js";
import { NightShiftError } from "../../core/errors.js";
import type { RunLogEntry } from "../../agent/run-logger.js";
import {
  table,
  success,
  error,
  warn,
  info,
  heading,
  dim,
  formatDuration,
} from "../formatters.js";

export const agentCommand = new Command("agent").description("Manage agents");

// ── agent init ──────────────────────────────────────────────────────────────

agentCommand
  .command("init")
  .argument("<name>", "Agent name (kebab-case)")
  .option("--force", "Overwrite existing agent directory")
  .action(async (name, options) => {
    try {
      const result = await scaffoldAgent(name, { force: options.force });
      console.log(success(`Agent '${name}' created at agents/${name}/`));
      if (result.configUpdated) {
        console.log(info("Added to nightshift.yaml with schedule: 0 2 * * *"));
      }
      console.log(result.message);
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

// ── agent validate ──────────────────────────────────────────────────────────

agentCommand
  .command("validate")
  .argument("<path>", "Agent name or directory path")
  .action(async (agentPath) => {
    const base = process.cwd();
    let agentDir: string;
    let agentsRoot: string;

    // Resolve path: if no separators, treat as agent name
    if (!agentPath.includes("/") && !agentPath.includes("\\")) {
      try {
        const config = await loadConfig(base);
        agentsRoot = path.resolve(base, config.agentsDir);
      } catch {
        agentsRoot = path.resolve(base, "agents");
      }
      agentDir = path.resolve(agentsRoot, agentPath);
    } else {
      agentDir = path.resolve(agentPath);
      agentsRoot = path.dirname(agentDir);
    }

    let hasErrors = false;
    const results: Array<{ type: "ok" | "error" | "warn"; msg: string }> = [];

    // a. Schema validation — parse YAML directly with ManifestSchema.safeParse
    let rawManifest: unknown;
    let parsedManifest: ReturnType<typeof ManifestSchema.safeParse> | null = null;
    try {
      const content = await fs.readFile(
        path.join(agentDir, "manifest.yaml"),
        "utf-8",
      );
      rawManifest = parseYaml(content);
      parsedManifest = ManifestSchema.safeParse(rawManifest);
      if (parsedManifest.success) {
        results.push({ type: "ok", msg: "Schema: valid" });
      } else {
        const issues = parsedManifest.error.issues
          .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n");
        results.push({ type: "error", msg: `Schema: invalid\n${issues}` });
        hasErrors = true;
      }
    } catch (err) {
      results.push({
        type: "error",
        msg: `Schema: cannot read manifest.yaml — ${err instanceof Error ? err.message : String(err)}`,
      });
      hasErrors = true;
    }

    // b. Env var availability via loadManifest (catches env var issues as warnings)
    if (parsedManifest?.success) {
      try {
        await loadManifest(agentDir, agentsRoot);
        results.push({ type: "ok", msg: "Env vars: all resolved" });
      } catch (err) {
        if (err instanceof NightShiftError && err.code === "MANIFEST_SECURITY") {
          results.push({ type: "error", msg: `Security: ${err.message}` });
          hasErrors = true;
        } else if (
          err instanceof NightShiftError &&
          err.code === "MANIFEST" &&
          err.message.includes("env var") &&
          err.message.includes("is not set")
        ) {
          // Extract the env var name from the error message
          const envMatch = err.message.match(/"([^"]+)".*is not set/);
          const envName = envMatch ? envMatch[1] : "unknown";
          results.push({
            type: "warn",
            msg: `Env: ${envName} not set in current environment`,
          });
        } else if (err instanceof NightShiftError && err.code === "MANIFEST") {
          results.push({ type: "error", msg: `Manifest: ${err.message}` });
          hasErrors = true;
        }
      }
    }

    // c. Prompt file existence and variable completeness
    if (parsedManifest?.success) {
      const manifest = parsedManifest.data;
      const manifestVars: Record<string, unknown> = {
        ...(manifest.variables ?? {}),
      };
      // Add built-in placeholder strings so validateTemplateVars passes
      for (const v of BUILT_IN_VARS) {
        manifestVars[v] = `<${v}>`;
      }

      let allPromptsPresent = true;
      for (const step of manifest.steps) {
        const promptPath = path.join(agentDir, step.prompt);
        try {
          await fs.access(promptPath);
        } catch {
          results.push({
            type: "error",
            msg: `Prompts: missing ${step.prompt}`,
          });
          hasErrors = true;
          allPromptsPresent = false;
        }
      }

      if (allPromptsPresent) {
        results.push({ type: "ok", msg: "Prompts: all files present" });
      }

      // d. Variable completeness
      for (const step of manifest.steps) {
        const promptPath = path.join(agentDir, step.prompt);
        try {
          const content = await fs.readFile(promptPath, "utf-8");
          validateTemplateVars(content, manifestVars);
        } catch (err) {
          if (err instanceof NightShiftError && err.code === "MANIFEST") {
            results.push({
              type: "error",
              msg: `Variables (${step.name}): ${err.message}`,
            });
            hasErrors = true;
          }
          // Ignore file read errors — already reported above
        }
      }

      // e. Env var availability per step
      for (const step of manifest.steps) {
        if (step.env) {
          for (const envEntry of step.env) {
            const envName =
              typeof envEntry === "string" ? envEntry : envEntry.name;
            if (typeof envEntry === "string" && !process.env[envName]) {
              results.push({
                type: "warn",
                msg: `Env: ${envName} not set in current environment`,
              });
            }
          }
        }
      }
    }

    // Print results
    for (const r of results) {
      switch (r.type) {
        case "ok":
          console.log(success(r.msg));
          break;
        case "error":
          console.error(error(r.msg));
          break;
        case "warn":
          console.warn(warn(r.msg));
          break;
      }
    }

    if (hasErrors) {
      process.exitCode = 1;
    }
  });

// ── agent list ──────────────────────────────────────────────────────────────

agentCommand
  .command("list")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const base = process.cwd();

    // Load config for schedule info
    let agentsDir = "agents";
    let scheduleMap = new Map<string, string>();
    try {
      const config = await loadConfig(base);
      agentsDir = config.agentsDir;
      for (const entry of config.schedule) {
        if (entry.enabled) {
          scheduleMap.set(entry.agent, entry.cron);
        }
      }
    } catch {
      // No config — proceed without schedule info
    }

    // Scan agents directory
    const agentsDirPath = path.resolve(base, agentsDir);
    let entries: string[] = [];
    try {
      entries = await fs.readdir(agentsDirPath);
    } catch {
      console.log(
        info(
          "No agents found. Run 'nightshift agent init <name>' to create one.",
        ),
      );
      return;
    }

    // Filter to directories with manifest.yaml
    const agents: Array<{
      name: string;
      steps: number;
      schedule: string;
      lastRun: string;
    }> = [];

    // Read run log
    const runLogPath = path.join(getLogsDir(base), "agent-runs.jsonl");
    const lastRunMap = new Map<string, RunLogEntry>();
    try {
      const logContent = await fs.readFile(runLogPath, "utf-8");
      for (const line of logContent.trim().split("\n")) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as RunLogEntry;
          lastRunMap.set(entry.agent_name, entry);
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // No log file — all agents show "never"
    }

    for (const dirName of entries) {
      const manifestPath = path.join(agentsDirPath, dirName, "manifest.yaml");
      try {
        const content = await fs.readFile(manifestPath, "utf-8");
        const parsed = parseYaml(content) as Record<string, unknown>;
        const agentName = String(parsed.name ?? dirName);
        const stepCount = Array.isArray(parsed.steps) ? parsed.steps.length : 0;
        const cron = scheduleMap.get(agentName);

        const lastEntry = lastRunMap.get(agentName);
        let lastRunStr = "never";
        if (lastEntry) {
          const ago = formatDistanceToNow(new Date(lastEntry.date), {
            addSuffix: true,
          });
          lastRunStr = `${lastEntry.summary} (${ago})`;
        }

        agents.push({
          name: agentName,
          steps: stepCount,
          schedule: cron ?? "(not scheduled)",
          lastRun: lastRunStr,
        });
      } catch {
        // Skip directories without valid manifest
      }
    }

    if (agents.length === 0) {
      console.log(
        info(
          "No agents found. Run 'nightshift agent init <name>' to create one.",
        ),
      );
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(agents, null, 2));
      return;
    }

    const rows = agents.map((a) => [
      a.name,
      String(a.steps),
      a.schedule,
      a.lastRun,
    ]);
    console.log(table(["Name", "Steps", "Schedule", "Last Run"], rows));
  });

// ── agent show ──────────────────────────────────────────────────────────────

agentCommand
  .command("show")
  .argument("<name>", "Agent name")
  .action(async (name) => {
    const base = process.cwd();

    // Resolve agent directory
    let agentsDir = "agents";
    try {
      const config = await loadConfig(base);
      agentsDir = config.agentsDir;
    } catch {
      // Fall back to default
    }

    const agentDir = path.resolve(base, agentsDir, name);
    const manifestPath = path.join(agentDir, "manifest.yaml");

    let parsed: Record<string, unknown>;
    try {
      const content = await fs.readFile(manifestPath, "utf-8");
      parsed = parseYaml(content) as Record<string, unknown>;
    } catch (err) {
      console.error(
        error(
          `Cannot read manifest for '${name}': ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      process.exitCode = 1;
      return;
    }

    // a. Manifest Summary
    console.log(heading("Manifest Summary"));
    const variables = parsed.variables as Record<string, string> | undefined;
    const varNames = variables ? Object.keys(variables) : [];
    console.log(`  Name:        ${parsed.name ?? name}`);
    console.log(`  Description: ${parsed.description ?? "(none)"}`);
    console.log(`  Model:       ${parsed.model ?? "(default)"}`);
    console.log(`  Timeout:     ${parsed.timeout ?? "(default)"}`);
    console.log(`  Variables:   ${varNames.length} (${varNames.join(", ") || "none"})`);
    console.log();

    // b. Step Pipeline
    console.log(heading("Step Pipeline"));
    const steps = Array.isArray(parsed.steps)
      ? (parsed.steps as Array<Record<string, unknown>>)
      : [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const modelStr =
        step.model && step.model !== parsed.model
          ? ` (model: ${step.model})`
          : "";
      const retryStr = step.retry
        ? ` (retry: ${(step.retry as Record<string, unknown>).maxAttempts}x from ${(step.retry as Record<string, unknown>).retryFrom})`
        : "";
      console.log(
        `  ${i + 1}. ${step.name}${modelStr}${retryStr}`,
      );
      console.log(dim(`     prompt: ${step.prompt}`));
    }
    console.log();

    // c. Schedule
    console.log(heading("Schedule"));
    let scheduled = false;
    try {
      const config = await loadConfig(base);
      for (const entry of config.schedule) {
        if (entry.agent === name && entry.enabled) {
          const nextRun = new Cron(entry.cron).nextRun();
          const nextStr = nextRun
            ? formatDistanceToNow(nextRun, { addSuffix: true })
            : "unknown";
          console.log(`  Cron: ${entry.cron} (next: ${nextStr})`);
          scheduled = true;
        }
      }
    } catch {
      // No config
    }
    if (!scheduled) {
      console.log("  (not scheduled)");
    }
    console.log();

    // d. Recent Runs
    console.log(heading("Recent Runs"));
    const runLogPath = path.join(getLogsDir(base), "agent-runs.jsonl");
    try {
      const logContent = await fs.readFile(runLogPath, "utf-8");
      const entries: RunLogEntry[] = [];
      for (const line of logContent.trim().split("\n")) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as RunLogEntry;
          if (entry.agent_name === name) {
            entries.push(entry);
          }
        } catch {
          // Skip malformed
        }
      }

      if (entries.length === 0) {
        console.log("  No runs recorded yet.");
      } else {
        // Show last 5
        const recent = entries.slice(-5).reverse();
        for (const entry of recent) {
          const ago = formatDistanceToNow(new Date(entry.date), {
            addSuffix: true,
          });
          console.log(
            `  ${entry.date} ${dim(`(${ago})`)} — ${entry.summary} ${dim(`[${formatDuration(entry.duration_seconds)}]`)}`,
          );
        }
      }
    } catch {
      console.log("  No runs recorded yet.");
    }
  });
