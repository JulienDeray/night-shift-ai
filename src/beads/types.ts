export interface BeadEntry {
  id: string;
  title: string;
  description: string;
  labels: string[];
  status: "open" | "closed";
  claimed: boolean;
  claimedBy?: string;
  createdAt: string;
  updatedAt: string;
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
