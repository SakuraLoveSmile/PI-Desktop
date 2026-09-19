/**
 * Latest-wins serial queue for composer thinking-level commits.
 *
 * A drag can cross several stops before an idle-session persist returns.
 * Only the newest pending value is sent after the in-flight write settles.
 * `invalidate` drops pending work so a model or session change cannot land
 * a stale level on the wrong binding.
 */
export function createLatestCommitQueue<T>(options: {
  send: (value: T) => Promise<void>;
  onError?: (error: unknown) => void;
}): {
  commit: (value: T) => Promise<boolean>;
  invalidate: () => void;
  idle: () => Promise<void>;
} {
  let pending: T | null = null;
  let generation = 0;
  let busy = false;
  let tail: Promise<boolean> = Promise.resolve(true);

  const invalidate = () => {
    generation += 1;
    pending = null;
  };

  const drain = async (): Promise<boolean> => {
    busy = true;
    try {
      while (pending !== null) {
        const gen = generation;
        const value = pending;
        pending = null;
        if (gen !== generation) return false;
        try {
          await options.send(value);
        } catch (error) {
          generation += 1;
          pending = null;
          options.onError?.(error);
          return false;
        }
        if (gen !== generation) return false;
      }
      return true;
    } finally {
      busy = false;
    }
  };

  const commit = (value: T): Promise<boolean> => {
    pending = value;
    const enqueuedAt = generation;
    const finish = async (run: Promise<boolean>) => {
      const ok = await run;
      return ok && generation === enqueuedAt;
    };
    if (!busy) {
      const run = drain();
      tail = run.then(
        () => true,
        () => true,
      );
      return finish(run);
    }
    const run = tail.then(drain, drain);
    tail = run.then(
      () => true,
      () => true,
    );
    return finish(run);
  };

  const idle = () => tail.then(() => undefined);

  return { commit, invalidate, idle };
}
