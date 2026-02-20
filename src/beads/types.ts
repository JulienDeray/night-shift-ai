/**
 * Matches the actual JSON output of `bd list --json` / `bd ready --json`.
 *
 * Note: `bd ready` strips the `labels` field from output, so it's optional.
 * There is no `claimed` field — beads uses status for lifecycle tracking.
 */
export interface BeadEntry {
  id: string;
  title: string;
  description: string;
  status: "open" | "closed";
  priority: number;
  issue_type: string;
  owner: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  labels?: string[];
  dependency_count: number;
  dependent_count: number;
  comment_count: number;
}

export interface BeadCreateOptions {
  title: string;
  description: string;
  labels: string[];
}

export interface BeadUpdateOptions {
  claim?: boolean;
  labels?: string[];
  description?: string;
}
