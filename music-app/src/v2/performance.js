// Bounded, session-only catalog cache. Never use this for resolving stream URLs.
export function createCatalogCache(
  load,
  { ttl = 90000, maxEntries = 32, now = Date.now } = {},
) {
  const entries = new Map(),
    pending = new Map();
  const peek = (key) => {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (now() - entry.at >= ttl) {
      entries.delete(key);
      return undefined;
    }
    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  };
  return {
    peek,
    get(key, { refresh = false } = {}) {
      const value = peek(key);
      if (!refresh && value !== undefined) return Promise.resolve(value);
      if (pending.has(key)) return pending.get(key);
      const promise = Promise.resolve()
        .then(() => load(key))
        .then((value) => {
          entries.delete(key);
          entries.set(key, { value, at: now() });
          while (entries.size > maxEntries)
            entries.delete(entries.keys().next().value);
          return value;
        })
        .finally(() => {
          if (pending.get(key) === promise) pending.delete(key);
        });
      pending.set(key, promise);
      return promise;
    },
  };
}

// UI polling only: Android's native playback/download services remain independent.
// One in-flight request per poller; no timers while hidden; refresh on return.
export function startVisiblePolling(
  task,
  {
    interval,
    document: doc = document,
    clock = globalThis,
    onError = () => {},
  },
) {
  let stopped = false,
    busy = false,
    timer;
  const run = async () => {
    if (stopped || busy || doc.hidden) return;
    clock.clearTimeout(timer);
    busy = true;
    try {
      await task();
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      busy = false;
      const delay = typeof interval === "function" ? interval() : interval;
      if (!stopped && !doc.hidden && delay != null)
        timer = clock.setTimeout(run, delay);
    }
  };
  const visibility = () => {
    clock.clearTimeout(timer);
    if (!doc.hidden) void run();
  };
  doc.addEventListener("visibilitychange", visibility);
  void run();
  const stop = () => {
    stopped = true;
    clock.clearTimeout(timer);
    doc.removeEventListener("visibilitychange", visibility);
  };
  stop.refresh = run;
  return stop;
}
