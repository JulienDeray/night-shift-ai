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

export type CodeAgentOutcome = "MR_CREATED" | "NO_IMPROVEMENT" | "ABANDONED";

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
