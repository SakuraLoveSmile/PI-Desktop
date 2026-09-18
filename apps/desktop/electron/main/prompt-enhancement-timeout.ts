/**
 * Bound one prompt-enhancement request.
 *
 * The transport only consults its abort signal between provider retries, so
 * aborting is best-effort cancellation. Racing the promise is what actually
 * guarantees the caller is released: without it a stalled connection or a slow
 * gateway holds the renderer's promise open indefinitely, and the provider
 * retry budget alone can already spend about a minute before giving up.
 *
 * Kept in its own module (no Electron or pi-ai imports) so the behavior is
 * directly testable.
 */

/** Hard ceiling for one enhancement request. */
export const PROMPT_ENHANCEMENT_TIMEOUT_MS = 60_000;

/** Classified timeout failure the renderer renders as a dismissible error. */
export type PromptEnhancementTimeoutError = Error & {
  errorCode: "TIMEOUT";
};

export function promptEnhancementTimeoutError(
  timeoutMs: number,
): PromptEnhancementTimeoutError {
  return Object.assign(
    new Error(
      `Prompt enhancement timed out after ${Math.round(timeoutMs / 1000)}s. Try again, or set the enhancement model to follow the session in Settings.`,
    ),
    { errorCode: "TIMEOUT" as const },
  );
}

/**
 * Resolve with `work`, or reject with a `TIMEOUT` error after `timeoutMs`.
 *
 * A failure from `work` itself passes through unchanged; only an unanswered
 * request becomes a timeout. The rejection is never retried on another model:
 * the user chose this one, and a hidden second attempt would double the wait.
 */
export function withPromptEnhancementTimeout<T>(
  work: Promise<T>,
  timeoutMs: number = PROMPT_ENHANCEMENT_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(promptEnhancementTimeoutError(timeoutMs)), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
