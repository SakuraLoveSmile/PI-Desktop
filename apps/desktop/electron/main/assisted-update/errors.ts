/** Why the assisted lane refused or failed an update step. */
export type AssistedErrorCode =
  | "asset-missing"
  | "asset-integrity"
  | "url-rejected"
  | "redirect-rejected"
  | "http-status"
  | "size-mismatch"
  | "hash-mismatch"
  | "too-large"
  | "stalled"
  | "aborted"
  | "extract-failed"
  | "layout"
  | "identity"
  | "version"
  | "arch"
  | "signature"
  | "quarantine"
  | "not-prepared"
  | "helper-missing"
  | "helper-spawn";

export class AssistedUpdateError extends Error {
  readonly code: AssistedErrorCode;

  constructor(code: AssistedErrorCode, message: string) {
    super(message);
    this.name = "AssistedUpdateError";
    this.code = code;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof AssistedUpdateError
      ? error.code === "aborted"
      : (error as { name?: unknown } | null)?.name === "AbortError"
  );
}
