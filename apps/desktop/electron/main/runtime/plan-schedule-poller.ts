export type PlanSchedulePollResult = { nextDueAt: number | null; retrySoon: boolean };

type Host = {
  onNotification: (handler: (method: string, params: unknown) => void) => () => void;
};

/** Owns wakeups and the current host subscription, never execution state. */
export function createPlanSchedulePoller(options: {
  getHost: () => Host | null;
  poll: () => Promise<PlanSchedulePollResult>;
  report: (error: unknown) => void;
}) {
  let running = false;
  let polling = false;
  let dirty = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wakeAt = 0;
  let subscribedHost: Host | null = null;
  let unsubscribe: (() => void) | undefined;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const subscribe = () => {
    const host = options.getHost();
    if (host === subscribedHost) return;
    unsubscribe?.();
    subscribedHost = host;
    unsubscribe = host?.onNotification((method) => {
      if (method === "plans.changed" && running && options.getHost() === host) nudge();
    });
  };
  const schedule = (delay: number, preserveEarlier = false) => {
    const now = Date.now();
    if (preserveEarlier && timer && wakeAt > now && wakeAt <= now + delay) return;
    clearTimer();
    wakeAt = now + delay;
    timer = setTimeout(() => {
      timer = undefined;
      void tick();
    }, delay);
    timer.unref();
  };
  const nudge = () => {
    if (!running) return;
    subscribe();
    if (polling) {
      dirty = true;
      return;
    }
    schedule(200, true);
  };
  const tick = async () => {
    if (!running || polling) return;
    subscribe();
    const host = options.getHost();
    const owner = generation;
    polling = true;
    dirty = false;
    let delay = 5_000;
    try {
      const result = await options.poll();
      if (!result.retrySoon) {
        delay = result.nextDueAt === null ? 30_000
          : Math.min(30_000, Math.max(1_000, result.nextDueAt - Date.now()));
      }
    } catch (error) {
      options.report(error);
    } finally {
      polling = false;
      if (running) {
        const changed = options.getHost() !== host;
        subscribe();
        if (dirty || changed || owner !== generation) schedule(200);
        else schedule(delay);
      }
    }
  };
  return {
    start() {
      if (running) return;
      running = true;
      generation++;
      subscribe();
      if (polling) dirty = true;
      else void tick();
    },
    stop() {
      running = false;
      generation++;
      dirty = false;
      clearTimer();
      unsubscribe?.();
      unsubscribe = undefined;
      subscribedHost = null;
    },
    nudge,
  };
}
