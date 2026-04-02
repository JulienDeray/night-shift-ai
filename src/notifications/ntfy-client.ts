import type { NtfyConfig } from "../core/types.js";
import type { Logger } from "../core/logger.js";

export interface NtfyAction {
  action: "view" | "http" | "broadcast";
  label: string;
  url?: string;
  clear?: boolean;
}

export interface NtfyMessage {
  title?: string;
  body?: string; // maps to ntfy "message" field in JSON payload
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  actions?: NtfyAction[];
}

export class NtfyClient {
  private readonly baseUrl: string;
  private readonly topic: string;
  private readonly token: string | undefined;

  constructor(config: NtfyConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.topic = config.topic;
    this.token = config.token;
  }

  async send(message: NtfyMessage, logger: Logger): Promise<void> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (this.token !== undefined) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }

      // POST to the base URL with topic in the JSON body.
      // Posting JSON to /topic treats the body as raw text; the root
      // endpoint correctly parses structured fields (title, priority, tags).
      const payload = {
        topic: this.topic,
        title: message.title,
        message: message.body,
        priority: message.priority,
        tags: message.tags,
        actions: message.actions,
      };

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        logger.warn("Ntfy notification failed", {
          status: response.status,
          url: this.baseUrl,
        });
        return;
      }

      logger.debug("Ntfy notification sent", {
        topic: this.topic,
      });
    } catch (err) {
      logger.warn("Ntfy notification error", {
        error: err instanceof Error ? err.message : String(err),
        url: this.baseUrl,
      });
    }
  }
}
