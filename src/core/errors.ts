export class NightShiftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NightShiftError";
  }
}

export class ConfigError extends NightShiftError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class DaemonError extends NightShiftError {
  constructor(message: string) {
    super(message);
    this.name = "DaemonError";
  }
}

export class BeadsError extends NightShiftError {
  constructor(message: string) {
    super(message);
    this.name = "BeadsError";
  }
}

export class AgentExecutionError extends NightShiftError {
  constructor(
    message: string,
    public readonly taskId: string,
  ) {
    super(message);
    this.name = "AgentExecutionError";
  }
}

export class TimeoutError extends NightShiftError {
  constructor(
    message: string,
    public readonly taskId: string,
    public readonly timeoutMs: number,
  ) {
    super(message);
    this.name = "TimeoutError";
  }
}

export class ManifestError extends NightShiftError {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

export class ManifestSecurityError extends NightShiftError {
  constructor(message: string) {
    super(message);
    this.name = "ManifestSecurityError";
  }
}

export class BeadContractViolationError extends NightShiftError {
  constructor(message: string) {
    super(message);
    this.name = "BeadContractViolationError";
  }
}

export class BeadOutputMissingError extends NightShiftError {
  constructor(message: string) {
    super(message);
    this.name = "BeadOutputMissingError";
  }
}

export class RegistryError extends NightShiftError {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}
