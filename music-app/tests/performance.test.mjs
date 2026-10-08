import test from "node:test";
import assert from "node:assert/strict";
import {
  createCatalogCache,
  startVisiblePolling,
} from "../src/v2/performance.js";
import {
  addRecentSearch,
  downloadBadge,
  createBackup,
  emptyLibrary,
} from "../src/v2/core.js";

test("recent searches normalize, deduplicate, retain type and cap at eight", () => {
  let history = [];
  for (let i = 0; i < 10; i++)
    history = addRecentSearch(history, ` Query ${i} `, "albums");
  assert.equal(history.length, 8);
  history = addRecentSearch(history, " QUERY   9 ", "albums");
  assert.equal(history.length, 8);
  assert.equal(history[0].query, "QUERY 9");
  assert.equal(history[0].tab, "albums");
  assert.deepEqual(addRecentSearch(null, "   "), []);
  assert.equal(addRecentSearch(history, "x", "bad")[0].tab, "songs");
  const library = { ...emptyLibrary(), searchHistory: history };
  assert.deepEqual(createBackup(library).library.searchHistory, []);
});

test("only completed download state is labelled available offline", () => {
  assert.equal(downloadBadge({ state: 3 }).ready, true);
  for (const state of [0, 1, 2, 4, 5, 7])
    assert.equal(downloadBadge({ state }).ready, false);
  assert.equal(downloadBadge(null), null);
});

test("catalog deduplicates in-flight loads and reuses cached navigation", async () => {
  let calls = 0,
    resolve;
  const cache = createCatalogCache(() => {
    calls++;
    return new Promise((r) => (resolve = r));
  });
  const one = cache.get("home"),
    two = cache.get("home");
  assert.equal(one, two);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ songs: [1] });
  const data = await one;
  assert.equal(await cache.get("home"), data);
  assert.equal(calls, 1);
});

test("catalog honors TTL, manual refresh and least-recent eviction", async () => {
  let time = 0,
    calls = 0;
  const cache = createCatalogCache(async (key) => ({ key, n: ++calls }), {
    now: () => time,
    ttl: 100,
    maxEntries: 2,
  });
  await cache.get("a");
  await cache.get("b");
  cache.peek("a");
  await cache.get("c");
  assert.equal(cache.peek("b"), undefined);
  assert.ok(cache.peek("a"));
  const before = calls;
  await cache.get("a", { refresh: true });
  assert.equal(calls, before + 1);
  time = 101;
  assert.equal(cache.peek("a"), undefined);
  await cache.get("a");
  assert.equal(calls, before + 2);
});

test("failed catalog loads are not retained and can be retried", async () => {
  let fail = true;
  const cache = createCatalogCache(async () => {
    if (fail) throw Error("offline");
    return "ok";
  });
  await assert.rejects(cache.get("x"));
  fail = false;
  assert.equal(await cache.get("x"), "ok");
});

function environment() {
  const handlers = new Set(),
    timers = new Map();
  let id = 0;
  const doc = {
    hidden: false,
    addEventListener: (name, fn) => handlers.add(fn),
    removeEventListener: (name, fn) => handlers.delete(fn),
  };
  return {
    doc,
    timers,
    handlers,
    clock: {
      setTimeout: (fn) => {
        timers.set(++id, fn);
        return id;
      },
      clearTimeout: (n) => timers.delete(n),
    },
    visibility(hidden) {
      doc.hidden = hidden;
      for (const fn of handlers) fn();
    },
    tick() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((fn) => fn());
    },
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
test("native UI polling never overlaps, sleeps when hidden, and resumes once visible", async () => {
  const e = environment();
  let calls = 0,
    release;
  const stop = startVisiblePolling(
    () => {
      calls++;
      return new Promise((r) => (release = r));
    },
    { interval: 750, document: e.doc, clock: e.clock },
  );
  assert.equal(calls, 1);
  e.visibility(false);
  e.tick();
  assert.equal(calls, 1);
  e.visibility(true);
  release();
  await flush();
  assert.equal(e.timers.size, 0);
  e.visibility(false);
  assert.equal(calls, 2);
  release();
  await flush();
  assert.equal(e.timers.size, 1);
  e.tick();
  assert.equal(calls, 3);
  stop();
  release();
  await flush();
  assert.equal(e.timers.size, 0);
  assert.equal(e.handlers.size, 0);
});
test("poll failure schedules a recoverable retry instead of ending polling", async () => {
  const e = environment();
  let errors = 0;
  const stop = startVisiblePolling(
    async () => {
      throw Error("bridge unavailable");
    },
    { interval: 100, document: e.doc, clock: e.clock, onError: () => errors++ },
  );
  await flush();
  assert.equal(errors, 1);
  assert.equal(e.timers.size, 1);
  stop();
});
