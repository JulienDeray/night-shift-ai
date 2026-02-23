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
  private readonly url: string;
  private readonly token: string | undefined;

  constructor(config: NtfyConfig) {
    const baseUrl = config.baseUrl.replace(/\/$/, "");
    this.url = `${baseUrl}/${config.topic}`;
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

      const payload = {
        title: message.title,
        message: message.body,
        priority: message.priority,
        tags: message.tags,
        actions: message.actions,
      };

      const response = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        logger.warn("Ntfy notification failed", {
          status: response.status,
          url: this.url,
        });
        return;
      }

      logger.debug("Ntfy notification sent", { url: this.url });
    } catch (err) {
      logger.warn("Ntfy notification error", {
        error: err instanceof Error ? err.message : String(err),
        url: this.url,
      });
    }
  }
}
