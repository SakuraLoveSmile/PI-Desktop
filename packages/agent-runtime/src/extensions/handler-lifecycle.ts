/** Owns waits, not arbitrary JavaScript or external side effects of trusted code. */
export class HandlerLifecycle {
  private controller = new AbortController();

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  cancel(): void {
    const previous = this.controller;
    this.controller = new AbortController();
    previous.abort();
  }

  async run<T>(work: () => T | PromiseLike<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        settle();
      };
      const abort = () => finish(() => reject(signal.reason));
      const timer = setTimeout(
        () => finish(() => reject(new Error(`handler exceeded ${timeoutMs}ms`))),
        timeoutMs,
      );
      signal.addEventListener("abort", abort, { once: true });
      try {
        Promise.resolve(work()).then(
          (value) => finish(() => resolve(value)),
          (error: unknown) => finish(() => reject(error)),
        );
      } catch (error) {
        finish(() => reject(error));
      }
    });
  }
}
