export type TaskOrigin = "one-off" | "recurring";
export type TaskStatus = "pending" | "ready" | "running" | "completed" | "failed" | "timed-out";

export interface NightShiftTask {
  id: string;
  name: string;
  origin: TaskOrigin;
  prompt: string;
  status: TaskStatus;
  allowedTools?: string[];
  timeout: string;
  maxBudgetUsd?: number;
  model?: string;
  mcpConfig?: string;
  output?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  recurringName?: string;
  notify?: boolean;
  category?: string;
  agentName?: string;  // kebab-case agent name; required after Phase 10 migration
  variables?: Record<string, string>;  // per-task variable overrides passed to engine's configOverrides
}

export interface NtfyConfig {
  topic: string;
  token?: string;
  baseUrl: string;
}

export interface AgentDeclaration {
  name: string;
  notify?: boolean;
  variables?: Record<string, string>;
}

export interface ScheduleEntry {
  agent: string;
  cron: string;
  variables?: Record<string, string>;
  enabled: boolean;
  notify?: boolean;
}

export interface OneOffDefaults {
  timeout: string;
  maxBudgetUsd?: number;
  model?: string;
}

export interface DaemonConfig {
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  logRetentionDays: number;
}

export interface NightShiftConfig {
  workspace: string;
  inbox: string;
  maxConcurrent: number;
  defaultTimeout: string;
  daemon: DaemonConfig;
  agentsDir: string;
  agents: AgentDeclaration[];
  schedule: ScheduleEntry[];
  oneOffDefaults: OneOffDefaults;
  ntfy?: NtfyConfig;
}

export interface DaemonState {
  pid: number;
  startedAt: string;
  lastHeartbeat: string;
  activeTasks: number;
  totalExecuted: number;
  totalCostUsd: number;
  status: "running" | "stopping" | "stopped";
}

export interface InboxEntry {
  taskId: string;
  taskName: string;
  origin: TaskOrigin;
  status: "completed" | "failed" | "timed-out";
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  agentName: string;
  stepCount: number;
  resultSummary: string;
  originalPrompt: string;
  filePath: string;
}
