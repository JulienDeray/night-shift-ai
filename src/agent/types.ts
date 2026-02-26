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
  prompts: {
    analyze: string;
    implement: string;
    verify: string;
    mr: string;
    log: string;
  };
  logMcpConfig?: string;
  reviewer?: string;
  allowedCommands: string[];
  maxTokens?: number;
  variables: Record<string, string>;
}

export interface AnalysisCandidate {
  rank: number;
  files: string[];
  description: string;
  rationale: string;
}

export interface AnalysisResult {
  result: "IMPROVEMENT_FOUND" | "NO_IMPROVEMENT";
  categoryUsed: string;
  reason?: string;
  candidates?: AnalysisCandidate[];
  selected?: AnalysisCandidate;
}

export interface BeadResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  costUsd: number;
  timedOut: boolean;
}

export type CodeAgentOutcome = "MR_CREATED" | "MR_FAILED" | "NO_IMPROVEMENT" | "ABANDONED";

export interface CodeAgentRunResult {
  outcome: CodeAgentOutcome;
  mrUrl?: string;
  categoryUsed: string;
  isFallback: boolean;
  reason?: string;
  summary?: string;
  totalCostUsd: number;
  totalDurationMs: number;
}
