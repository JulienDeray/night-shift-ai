import fs from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { getConfigPath } from "./paths.js";
import { ConfigError } from "./errors.js";
import type { NightShiftConfig } from "./types.js";

const RecurringTaskSchema = z.object({
  name: z.string().min(1),
  schedule: z.string().min(1),
  prompt: z.string().min(1),
  allowed_tools: z.array(z.string()).optional(),
  output: z.string().optional(),
  timeout: z.string().optional(),
  max_budget_usd: z.number().positive().optional(),
  model: z.string().optional(),
  mcp_config: z.string().optional(),
});

const ConfigSchema = z.object({
  workspace: z.string().default("./workspace"),
  inbox: z.string().default("./inbox"),
  max_concurrent: z.number().int().positive().default(2),
  default_timeout: z.string().default("30m"),
  beads: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({ enabled: true }),
  daemon: z
    .object({
      poll_interval_ms: z.number().int().positive().default(30000),
      heartbeat_interval_ms: z.number().int().positive().default(10000),
      log_retention_days: z.number().int().positive().default(30),
    })
    .default({
      poll_interval_ms: 30000,
      heartbeat_interval_ms: 10000,
      log_retention_days: 30,
    }),
  recurring: z.array(RecurringTaskSchema).default([]),
  one_off_defaults: z
    .object({
      timeout: z.string().default("30m"),
      max_budget_usd: z.number().positive().optional(),
      model: z.string().optional(),
    })
    .default({ timeout: "30m" }),
});

type RawConfig = z.infer<typeof ConfigSchema>;

function mapConfig(raw: RawConfig): NightShiftConfig {
  return {
    workspace: raw.workspace,
    inbox: raw.inbox,
    maxConcurrent: raw.max_concurrent,
    defaultTimeout: raw.default_timeout,
    beads: {
      enabled: raw.beads.enabled,
    },
    daemon: {
      pollIntervalMs: raw.daemon.poll_interval_ms,
      heartbeatIntervalMs: raw.daemon.heartbeat_interval_ms,
      logRetentionDays: raw.daemon.log_retention_days,
    },
    recurring: raw.recurring.map((r) => ({
      name: r.name,
      schedule: r.schedule,
      prompt: r.prompt,
      allowedTools: r.allowed_tools,
      output: r.output,
      timeout: r.timeout,
      maxBudgetUsd: r.max_budget_usd,
      model: r.model,
      mcpConfig: r.mcp_config,
    })),
    oneOffDefaults: {
      timeout: raw.one_off_defaults.timeout,
      maxBudgetUsd: raw.one_off_defaults.max_budget_usd,
      model: raw.one_off_defaults.model,
    },
  };
}

export async function loadConfig(
  base: string = process.cwd(),
): Promise<NightShiftConfig> {
  const configPath = getConfigPath(base);
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch {
    throw new ConfigError(
      `Config file not found: ${configPath}\nRun 'nightshift init' to create one.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (err) {
    throw new ConfigError(
      `Invalid YAML in ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid config:\n${issues}`);
  }

  return mapConfig(result.data);
}

export async function validateConfig(
  base: string = process.cwd(),
): Promise<{ valid: boolean; config?: NightShiftConfig; error?: string }> {
  try {
    const config = await loadConfig(base);
    return { valid: true, config };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function getDefaultConfigYaml(): string {
  return `workspace: ./workspace
inbox: ./inbox
max_concurrent: 2
default_timeout: "30m"

beads:
  enabled: true

daemon:
  poll_interval_ms: 30000
  heartbeat_interval_ms: 10000
  log_retention_days: 30

recurring: []
# Example recurring task:
# - name: "daily-standup-prep"
#   schedule: "0 6 * * 1-5"
#   prompt: |
#     Check Jira for my team's recent updates and prepare
#     standup notes for today's meeting.
#   allowed_tools:
#     - "mcp__jira__*"
#     - "Read"
#     - "Write"
#   output: "inbox/standup-prep-{{date}}.md"
#   timeout: "15m"
#   max_budget_usd: 2.00

one_off_defaults:
  timeout: "30m"
  max_budget_usd: 5.00
`;
}
