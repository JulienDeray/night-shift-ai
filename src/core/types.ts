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
}

export interface AgentExecutionResult {
  sessionId: string;
  durationMs: number;
  totalCostUsd: number;
  result: string;
  isError: boolean;
  numTurns: number;
}

export interface ClaudeJsonOutput {
  session_id: string;
  duration_ms: number;
  total_cost_usd: number;
  result: string;
  is_error: boolean;
  num_turns: number;
}

export interface NtfyConfig {
  topic: string;
  token?: string;
  baseUrl: string;
}

export interface CategoryScheduleConfig {
  monday?: string[];
  tuesday?: string[];
  wednesday?: string[];
  thursday?: string[];
  friday?: string[];
  saturday?: string[];
  sunday?: string[];
}

export interface CodeAgentConfig {
  repoUrl: string;
  confluencePageId: string;
  categorySchedule: CategoryScheduleConfig;
}

export interface RecurringTaskConfig {
  name: string;
  schedule: string;
  prompt: string;
  allowedTools?: string[];
  output?: string;
  timeout?: string;
  maxBudgetUsd?: number;
  model?: string;
  mcpConfig?: string;
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

export interface BeadsConfig {
  enabled: boolean;
}

export interface NightShiftConfig {
  workspace: string;
  inbox: string;
  maxConcurrent: number;
  defaultTimeout: string;
  beads: BeadsConfig;
  daemon: DaemonConfig;
  recurring: RecurringTaskConfig[];
  oneOffDefaults: OneOffDefaults;
  ntfy?: NtfyConfig;
  codeAgent?: CodeAgentConfig;
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
  costUsd: number;
  numTurns: number;
  resultSummary: string;
  originalPrompt: string;
  filePath: string;
}
