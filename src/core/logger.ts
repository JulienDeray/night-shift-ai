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

export type LogFormat = "text" | "json";

export class Logger {
  private logFile: string | null = null;
  private logsDir: string | null = null;
  private minLevel: LogLevel;
  private stdout: boolean;
  private format: LogFormat;

  constructor(options?: {
    logFile?: string;
    logsDir?: string;
    minLevel?: LogLevel;
    stdout?: boolean;
    format?: LogFormat;
  }) {
    this.logFile = options?.logFile ?? null;
    this.logsDir = options?.logsDir ?? null;
    this.minLevel = options?.minLevel ?? "info";
    this.stdout = options?.stdout ?? false;
    this.format = options?.format ?? "text";
  }

  static async createDaemonLogger(base?: string): Promise<Logger> {
    const logsDir = getLogsDir(base);
    await ensureDir(logsDir);
    const date = new Date().toISOString().split("T")[0];
    const logFile = path.join(logsDir, `daemon-${date}.log`);
    return new Logger({ logFile, logsDir, minLevel: "debug", stdout: false });
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

  private formatTextEntry(entry: LogEntry): string {
    // "2026-04-02T02:00:05.123Z" → "2026-04-02 02:00:05"
    const ts = entry.timestamp.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "");
    const level = `[${entry.level.toUpperCase()}]`;
    let line = `${ts} ${level} ${entry.message}`;

    if (entry.data && Object.keys(entry.data).length > 0) {
      const pairs = Object.entries(entry.data).map(([k, v]) => {
        const str = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
        return str.includes(" ") ? `${k}="${str}"` : `${k}=${str}`;
      });
      line += " " + pairs.join(" ");
    }

    return line;
  }

  private formatEntry(entry: LogEntry): string {
    if (this.format === "text") {
      return this.formatTextEntry(entry);
    }
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

    const logFile = this.logsDir
      ? path.join(this.logsDir, `daemon-${new Date().toISOString().split("T")[0]}.log`)
      : this.logFile;

    if (logFile) {
      await fs.appendFile(logFile, line + "\n");
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
