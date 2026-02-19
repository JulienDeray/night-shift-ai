import fs from "node:fs/promises";
import path from "node:path";
import { getLogsDir, ensureDir } from "./paths.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private logFile: string | null = null;
  private minLevel: LogLevel;
  private stdout: boolean;

  constructor(options?: {
    logFile?: string;
    minLevel?: LogLevel;
    stdout?: boolean;
  }) {
    this.logFile = options?.logFile ?? null;
    this.minLevel = options?.minLevel ?? "info";
    this.stdout = options?.stdout ?? false;
  }

  static async createDaemonLogger(base?: string): Promise<Logger> {
    const logsDir = getLogsDir(base);
    await ensureDir(logsDir);
    const date = new Date().toISOString().split("T")[0];
    const logFile = path.join(logsDir, `daemon-${date}.log`);
    return new Logger({ logFile, minLevel: "debug", stdout: false });
  }

  static createCliLogger(verbose: boolean = false): Logger {
    return new Logger({
      minLevel: verbose ? "debug" : "info",
      stdout: true,
    });
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  private formatEntry(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  private async write(entry: LogEntry): Promise<void> {
    if (!this.shouldLog(entry.level)) return;

    const line = this.formatEntry(entry);

    if (this.stdout) {
      if (entry.level === "error") {
        console.error(line);
      } else {
        console.log(line);
      }
    }

    if (this.logFile) {
      await fs.appendFile(this.logFile, line + "\n");
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    void this.write({
      timestamp: new Date().toISOString(),
      level: "debug",
      message,
      data,
    });
  }

  info(message: string, data?: Record<string, unknown>): void {
    void this.write({
      timestamp: new Date().toISOString(),
      level: "info",
      message,
      data,
    });
  }

  warn(message: string, data?: Record<string, unknown>): void {
    void this.write({
      timestamp: new Date().toISOString(),
      level: "warn",
      message,
      data,
    });
  }

  error(message: string, data?: Record<string, unknown>): void {
    void this.write({
      timestamp: new Date().toISOString(),
      level: "error",
      message,
      data,
    });
  }
}
