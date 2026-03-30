import fs from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { Cron } from "croner";
import { getConfigPath } from "./paths.js";
import { NightShiftError } from "./errors.js";
import type { NightShiftConfig } from "./types.js";

const NtfyConfigSchema = z
  .object({
    topic: z.string().min(1),
    token: z.string().optional(),
    base_url: z.string().default("https://ntfy.sh"),
  })
  .optional();

const AgentDeclarationSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/, "must be kebab-case"),
    notify: z.boolean().optional(),
    variables: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const ScheduleEntrySchema = z
  .object({
    agent: z.string().min(1),
    cron: z.string().min(1),
    variables: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().default(true),
    notify: z.boolean().optional(),
  })
  .strict();

const ConfigSchema = z
  .object({
    workspace: z.string().default("./workspace"),
    inbox: z.string().default("./inbox"),
    max_concurrent: z.number().int().positive().default(2),
    max_dispatches_per_tick: z.number().int().positive().default(2),
    default_timeout: z.string().default("30m"),
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
    agents_dir: z.string().default("./agents"),
    agents: z.array(AgentDeclarationSchema).default(() => []),
    schedule: z.array(ScheduleEntrySchema).default(() => []),
    one_off_defaults: z
      .object({
        timeout: z.string().default("30m"),
        model: z.string().optional(),
      })
      .default({ timeout: "30m" }),
    ntfy: NtfyConfigSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    // a. Duplicate agent names
    const agentNames = data.agents.map((a) => a.name);
    const seen = new Set<string>();
    for (const name of agentNames) {
      if (seen.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate agent name: '${name}'`,
        });
      }
      seen.add(name);
    }

    // b. Schedule references unknown agent
    const agentNameSet = new Set(agentNames);
    for (const entry of data.schedule) {
      if (!agentNameSet.has(entry.agent)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Schedule references unknown agent '${entry.agent}'`,
        });
      }
    }

    // c. Cron validation for enabled schedule entries
    for (const entry of data.schedule) {
      if (!entry.enabled) continue;
      try {
        new Cron(entry.cron);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid cron expression: '${entry.cron}'`,
        });
      }
    }
  });

type RawConfig = z.infer<typeof ConfigSchema>;

function mapConfig(raw: RawConfig): NightShiftConfig {
  return {
    workspace: raw.workspace,
    inbox: raw.inbox,
    maxConcurrent: raw.max_concurrent,
    maxDispatchesPerTick: raw.max_dispatches_per_tick,
    defaultTimeout: raw.default_timeout,
    daemon: {
      pollIntervalMs: raw.daemon.poll_interval_ms,
      heartbeatIntervalMs: raw.daemon.heartbeat_interval_ms,
      logRetentionDays: raw.daemon.log_retention_days,
    },
    agentsDir: raw.agents_dir,
    agents: raw.agents.map((a) => ({
      name: a.name,
      notify: a.notify,
      variables: a.variables,
    })),
    schedule: raw.schedule.map((s) => ({
      agent: s.agent,
      cron: s.cron,
      variables: s.variables,
      enabled: s.enabled,
      notify: s.notify,
    })),
    oneOffDefaults: {
      timeout: raw.one_off_defaults.timeout,
      model: raw.one_off_defaults.model,
    },
    ntfy: raw.ntfy
      ? {
          topic: raw.ntfy.topic,
          token: raw.ntfy.token,
          baseUrl: raw.ntfy.base_url,
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
    throw new NightShiftError(
      `Config file not found: ${configPath}\nRun 'nightshift init' to create one.`,
      "CONFIG",
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (err) {
    throw new NightShiftError(
      `Invalid YAML in ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      "CONFIG",
    );
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new NightShiftError(`Invalid config:\n${issues}`, "CONFIG");
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

daemon:
  poll_interval_ms: 30000
  heartbeat_interval_ms: 10000
  log_retention_days: 30

agents_dir: ./agents

agents: []
# agents:
#   - name: code-agent
#     variables:
#       repo_url: "git@gitlab.com:team/repo.git"

schedule: []
# schedule:
#   - agent: code-agent
#     cron: "0 2 * * 1-5"
#     variables:
#       category: "refactoring"
#   - agent: code-agent
#     cron: "0 2 * * 6"
#     variables:
#       category: "tests"

# ntfy:
#   topic: night-shift
#   token: tk_abc123        # optional
#   base_url: https://ntfy.sh  # optional, defaults to ntfy.sh

one_off_defaults:
  timeout: "30m"
`;
}
