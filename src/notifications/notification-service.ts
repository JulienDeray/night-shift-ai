import type { NightShiftTask } from "../core/types.js";
import type { AgentRunResult } from "../agent/engine-types.js";
import type { Logger } from "../core/logger.js";
import type { NtfyClient } from "./ntfy-client.js";
import {
  formatStartNotification,
  formatSuccessNotification,
  formatFailureNotification,
  formatEarlyExitNotification,
} from "./notification-formatter.js";

/**
 * Thin wrapper combining the notification formatter with NtfyClient.
 *
 * All sends are fire-and-forget (void, no await) so notification failures
 * never block the orchestrator. The service silently no-ops when ntfy is null
 * or task.notify is false/undefined.
 */
export class NotificationService {
  private readonly ntfy: NtfyClient | null;
  private readonly logger: Logger;

  constructor(ntfy: NtfyClient | null, logger: Logger) {
    this.ntfy = ntfy;
    this.logger = logger;
  }

  /**
   * Fires a "task started" notification. No-ops if ntfy is not configured
   * or if the task does not have notify enabled.
   */
  taskStarted(task: NightShiftTask): void {
    if (this.ntfy === null || !task.notify) {
      return;
    }
    void this.ntfy.send(formatStartNotification(task), this.logger);
  }

  /**
   * Fires a "task completed" notification (success or failure based on
   * result.status). No-ops if ntfy is not configured or task.notify is falsy.
   */
  taskCompleted(task: NightShiftTask, result: AgentRunResult): void {
    if (this.ntfy === null || !task.notify) {
      return;
    }
    const message =
      result.status === "SUCCESS"
        ? formatSuccessNotification(task, result)
        : formatFailureNotification(task, result);
    void this.ntfy.send(message, this.logger);
  }

  /**
   * Fires a "task early exit" notification. No-ops if ntfy is not configured
   * or if the task does not have notify enabled.
   */
  taskEarlyExit(task: NightShiftTask, result: AgentRunResult): void {
    if (this.ntfy === null || !task.notify) {
      return;
    }
    void this.ntfy.send(formatEarlyExitNotification(task, result), this.logger);
  }
}
