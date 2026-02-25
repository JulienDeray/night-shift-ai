import fs from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { getConfigPath } from "./paths.js";
import { ConfigError } from "./errors.js";
import type { NightShiftConfig } from "./types.js";

const CategoryScheduleSchema = z
  .object({
    monday: z.array(z.string().min(1)).optional(),
    tuesday: z.array(z.string().min(1)).optional(),
    wednesday: z.array(z.string().min(1)).optional(),
    thursday: z.array(z.string().min(1)).optional(),
    friday: z.array(z.string().min(1)).optional(),
    saturday: z.array(z.string().min(1)).optional(),
    sunday: z.array(z.string().min(1)).optional(),
  })
  .strict();

const NtfyConfigSchema = z
  .object({
    topic: z.string().min(1),
    token: z.string().optional(),
    base_url: z.string().default("https://ntfy.sh"),
  })
  .optional();

const CodeAgentSchema = z
  .object({
    repo_url: z
      .string()
      .regex(
        /^git@[a-zA-Z0-9._-]+:[a-zA-Z0-9._\/-]+\.git$/,
        "repo_url must be an SSH git URL (git@host:org/repo.git)",
      ),
    confluence_page_id: z.string().min(1),
    category_schedule: CategoryScheduleSchema,
    prompts: z
      .object({
        analyze: z.string().default("./prompts/analyze.md"),
        implement: z.string().default("./prompts/implement.md"),
        verify: z.string().default("./prompts/verify.md"),
        mr: z.string().default("./prompts/mr.md"),
        log: z.string().default("./prompts/log.md"),
      })
      .default(() => ({
        analyze: "./prompts/analyze.md",
        implement: "./prompts/implement.md",
        verify: "./prompts/verify.md",
        mr: "./prompts/mr.md",
        log: "./prompts/log.md",
      })),
    log_mcp_config: z.string().optional(),
    reviewer: z.string().optional(),
    allowed_commands: z
      .array(z.string())
      .default(() => ["git", "glab", "sbt compile", "sbt test", "sbt fmtCheck", "sbt fmt"]),
    max_tokens: z.number().int().positive().optional(),
    variables: z.record(z.string(), z.string()).default(() => ({})),
  })
  .optional();

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
  notify: z.boolean().optional(),
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
  ntfy: NtfyConfigSchema,
  code_agent: CodeAgentSchema,
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
      notify: r.notify,
    })),
    oneOffDefaults: {
      timeout: raw.one_off_defaults.timeout,
      maxBudgetUsd: raw.one_off_defaults.max_budget_usd,
      model: raw.one_off_defaults.model,
    },
    ntfy: raw.ntfy
      ? {
          topic: raw.ntfy.topic,
          token: raw.ntfy.token,
          baseUrl: raw.ntfy.base_url,
        }
      : undefined,
    codeAgent: raw.code_agent
      ? {
          repoUrl: raw.code_agent.repo_url,
          confluencePageId: raw.code_agent.confluence_page_id,
          categorySchedule: raw.code_agent.category_schedule,
          prompts: raw.code_agent.prompts,
          logMcpConfig: raw.code_agent.log_mcp_config,
          reviewer: raw.code_agent.reviewer,
          allowedCommands: raw.code_agent.allowed_commands,
          maxTokens: raw.code_agent.max_tokens,
          variables: raw.code_agent.variables,
        }
      : undefined,
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

# ntfy:
#   topic: night-shift
#   token: tk_abc123        # optional
#   base_url: https://ntfy.sh  # optional, defaults to ntfy.sh

# code_agent:
#   repo_url: git@gitlab.com:team/repo.git
#   confluence_page_id: "123456"
#   category_schedule:
#     monday: [tests]
#     tuesday: [refactoring]
#     wednesday: [docs]
#     thursday: [error_handling]
#     friday: [cleanup]
#   # Optional: override default prompt templates (paths relative to this config file)
#   # prompts:
#   #   analyze: ./prompts/analyze.md
#   #   implement: ./prompts/implement.md
#   #   verify: ./prompts/verify.md
#   #   mr: ./prompts/mr.md
#   #   log: ./prompts/log.md
#   # Optional: MCP config for the Confluence log bead
#   # log_mcp_config: /path/to/mcp-config.json
#   # Optional: assign MRs to a reviewer by username
#   # reviewer: "jsmith"
#   # Optional: override default allowed shell commands
#   # allowed_commands: [git, glab, sbt compile, sbt test, sbt fmtCheck, sbt fmt]
#   # Optional: max tokens per bead invocation
#   # max_tokens: 8192
#   # Optional: custom template variables passed to all bead prompts
#   # variables:
#   #   project_name: "MyApp"
#   #   team_name: "Backend"

one_off_defaults:
  timeout: "30m"
  max_budget_usd: 5.00
`;
}
