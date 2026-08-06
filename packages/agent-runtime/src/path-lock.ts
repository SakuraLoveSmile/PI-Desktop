/**
 * Serialize mutating tool calls that target the same file.
 *
 * The parent agent and its subagents run in one sidecar process but issue
 * `tools.execute` calls independently, and host-core has no per-path lock: two
 * concurrent `Write`/`Edit` calls on one file are last-writer-wins, and the
 * loser's `Edit` fails on content it read before the other write landed. With
 * subagents able to fan out (ADR 0060) that stopped being hypothetical, so the
 * sidecar queues same-path mutations itself.
 *
 * Different paths never wait on each other, which is the point: fan-out stays
 * parallel except where it would corrupt a file.
 */

/** Compare-equal spelling of a path: forward slashes, no `./` prefix. */
export function normalizeLockPath(path: unknown): string {
  return String(path ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export class PathMutex {
  /** Per path: the tail of the queue, and how many holders are still in it. */
  private queues = new Map<string, { tail: Promise<void>; holders: number }>();

  /** Run `task` once every earlier task for `key` has settled. */
  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const path = normalizeLockPath(key);
    if (!path) return task();
    const entry = this.queues.get(path);
    const previous = entry?.tail;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // A failed predecessor must not poison the queue; only ordering matters.
    const tail = previous
      ? previous.then(
          () => held,
          () => held,
        )
      : held;
    if (entry) {
      entry.tail = tail;
      entry.holders += 1;
    } else {
      this.queues.set(path, { tail, holders: 1 });
    }
    if (previous) await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      // Drop the entry once the last holder leaves, so a long session does not
      // accumulate one promise per file it ever touched.
      const current = this.queues.get(path);
      if (current) {
        current.holders -= 1;
        if (current.holders <= 0) this.queues.delete(path);
      }
    }
  }

  /** True while any path still has a queued or running holder. */
  get busy(): boolean {
    return this.queues.size > 0;
  }
}

/**
 * Bound how many delegates run at once. The model can emit any number of
 * parallel `Task` calls in one assistant message; each running delegate costs
 * a provider stream and its own tool traffic.
 */
export class Semaphore {
  private active = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}
