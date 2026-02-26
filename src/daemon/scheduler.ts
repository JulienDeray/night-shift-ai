import { getSchedulerStatePath } from "../core/paths.js";
import { readJsonFile, writeJsonFile } from "../utils/fs.js";
import type { NightShiftConfig, NightShiftTask } from "../core/types.js";
import type { Logger } from "../core/logger.js";

interface SchedulerState {
  lastRuns: Record<string, string>; // name → ISO timestamp of last bead creation
}

export class Scheduler {
  private state: SchedulerState = { lastRuns: {} };
  private config: NightShiftConfig;
  private readonly logger: Logger;

  constructor(config: NightShiftConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  updateConfig(config: NightShiftConfig): void {
    this.config = config;
  }

  async loadState(base?: string): Promise<void> {
    const state = await readJsonFile<SchedulerState>(getSchedulerStatePath(base));
    if (state) {
      this.state = state;
    }
  }

  async saveState(base?: string): Promise<void> {
    await writeJsonFile(getSchedulerStatePath(base), this.state);
  }

  async evaluateSchedules(): Promise<NightShiftTask[]> {
    // Schedule evaluation will be wired up in Phase 10 with the new agents + schedule model
    return [];
  }
}
