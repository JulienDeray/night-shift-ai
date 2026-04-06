export type NightShiftErrorCode =
  | "CONFIG"
  | "TIMEOUT"
  | "MANIFEST"
  | "MANIFEST_SECURITY"
  | "STEP_CONTRACT_VIOLATION"
  | "STEP_OUTPUT_MISSING"
  | "STEP_EXECUTION_FAILED";

export class NightShiftError extends Error {
  constructor(
    message: string,
    public readonly code: NightShiftErrorCode,
  ) {
    super(message);
    this.name = "NightShiftError";
  }
}
