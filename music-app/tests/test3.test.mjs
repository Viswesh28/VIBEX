import test from "node:test";
import assert from "node:assert/strict";
import { createHomeCache, metadataOnly } from "../src/v2/home-cache.js";
import {
  cleanSettings,
  emptyLibrary,
  createBackup,
  validateBackup,
  mergeLibrary,
  sortedPlaylists,
  lyricOffsetFor,
  shouldRefill,
} from "../src/v2/core.js";
import { startVisiblePolling } from "../src/v2/performance.js";

const song = {
  id: "one",
  name: "One",
  downloadUrl: [{ url: "https://secret/audio" }],
};
function cacheEnv() {
  let time = 100,
    disk = null,
    calls = 0,
    writes = 0,
    online = true,
    fail = false;
  const options = {
    read: async () => disk,
    write: async (v) => {
      disk = structuredClone(v);
      writes++;
    },
    now: () => time,
    online: () => online,
    ttl: 100,
    maxAge: 1000,
    maxEntries: 2,
  };
  const load = async (key) => {
    calls++;
    if (fail) throw Error("offline");
    return { key, results: [song] };
  };
  return {
    cache: () => createHomeCache(load, options),
    options,
    get calls() {
      return calls;
    },
    get writes() {
      return writes;
    },
    get disk() {
      return disk;
    },
    time: (n) => (time = n),
    offline: () => {
      online = false;
      fail = true;
    },
    fail: () => (fail = true),
  };
}
test("test2 settings migrate to saver/autoplay off without losing quality or crossfade", () => {
  const p = cleanSettings({ quality: "320kbps", crossfade: 8, theme: "dark" });
  assert.equal(p.batterySaver, false);
  assert.equal(p.autoplay, false);
  assert.equal(p.crossfade, 8);
  assert.equal(p.quality, "320kbps");
  assert.equal(
    cleanSettings({ batterySaver: "false", autoplay: 1 }).autoplay,
    false,
  );
});
test("Home metadata survives restart without a new network request", async () => {
  const e = cacheEnv();
  await e.cache().get("home");
  const a = await e.cache().get("home");
  assert.equal(e.calls, 1);
  assert.equal(a.saved, true);
  assert.equal(a.data.results[0].downloadUrl, undefined);
});
test("Home cache expires normally but Saver reuses stale metadata; refresh overrides", async () => {
  const e = cacheEnv(),
    c = e.cache();
  await c.get("home");
  e.time(250);
  assert.equal((await c.get("home", { saver: true })).stale, true);
  assert.equal(e.calls, 1);
  await c.get("home", { saver: true, refresh: true });
  assert.equal(e.calls, 2);
  e.time(400);
  await c.get("home");
  assert.equal(e.calls, 3);
});
test("Home falls back offline but never beyond maximum age", async () => {
  const e = cacheEnv(),
    c = e.cache();
  await c.get("home");
  e.time(300);
  e.offline();
  assert.equal((await c.get("home")).offline, true);
  e.time(2000);
  await assert.rejects(c.get("home"));
});
test("failed manual refresh preserves saved Home data", async () => {
  const e = cacheEnv(),
    c = e.cache();
  await c.get("home");
  e.fail();
  const result = await c.get("home", { refresh: true });
  assert.equal(result.stale, true);
  assert.equal(result.data.results.length, 1);
});
test("Home cache caps entries and clearing survives restart", async () => {
  const e = cacheEnv(),
    c = e.cache();
  await c.get("a");
  await c.get("b");
  await c.get("c");
  assert.equal(e.disk.entries.length, 2);
  await c.clear();
  assert.equal(e.disk.entries.length, 0);
  await e.cache().get("a");
  assert.equal(e.calls, 4);
});
test("Home coalesces requests and clearing fences in-flight persistence", async () => {
  let release,
    writes = [];
  const c = createHomeCache(() => new Promise((r) => (release = r)), {
    read: async () => null,
    write: async (x) => writes.push(x),
  });
  const a = c.get("a"),
    b = c.get("a");
  await new Promise((r) => setImmediate(r));
  await c.clear();
  release({ results: [song] });
  await Promise.all([a, b]);
  assert.deepEqual(writes.at(-1).entries, []);
});
test("Home byte cap and corrupt disposable cache cannot break catalog loading", async () => {
  let disk = {
    version: 1,
    entries: [null, [], ["bad", { at: Infinity, data: {} }]],
  };
  const c = createHomeCache(async () => ({ large: "x".repeat(1000) }), {
    read: async () => disk,
    write: async (x) => (disk = x),
    maxBytes: 100,
  });
  await c.get("a");
  assert.deepEqual(disk.entries, []);
});
test("metadata scrub removes transient media locations recursively without mutating input", () => {
  const input = {
    songs: [{ ...song, localUri: "file:x", streamUrl: "signed" }],
  };
  const result = metadataOnly(input);
  assert.equal(result.songs[0].streamUrl, undefined);
  assert.equal(result.songs[0].localUri, undefined);
  assert.ok(input.songs[0].downloadUrl);
});
test("pinning is stable across sort orders and survives backup/restore", () => {
  const l = emptyLibrary();
  l.songs = { one: song };
  l.playlists = [
    { id: "b", name: "Beta", ids: ["one"], pinned: true },
    { id: "a", name: "Alpha", ids: [] },
    { id: "z", name: "Zeta", ids: [] },
  ];
  assert.deepEqual(
    sortedPlaylists(l.playlists, "name").map((p) => p.id),
    ["b", "a", "z"],
  );
  assert.equal(validateBackup(createBackup(l)).playlists[0].pinned, true);
  assert.equal(l.playlists[0].id, "b");
});
test("per-song zero overrides global offset and validated offsets survive merge/restore", () => {
  const l = emptyLibrary();
  l.settings.lyricOffset = 3;
  l.songs = { one: song, two: { id: "two", name: "Two" } };
  l.lyricOffsets = { one: 0, two: -1.5, missing: 2 };
  assert.equal(lyricOffsetFor(l, "one"), 0);
  assert.equal(lyricOffsetFor(l, "other"), 3);
  const b = validateBackup(createBackup(l));
  assert.deepEqual(b.lyricOffsets, { one: 0, two: -1.5 });
  assert.deepEqual(
    mergeLibrary(l, { ...b, lyricOffsets: { one: 8, two: 4 } }).lyricOffsets,
    l.lyricOffsets,
  );
});
test("autoplay is opt-in and blocked by power/playback constraints and queue cap", () => {
  const state = { queue: [song], index: 0, playing: true };
  const settings = { ...cleanSettings(), autoplay: true };
  assert.equal(shouldRefill(state, settings), true);
  for (const extra of [
    { batterySaver: true },
    { autoplay: false },
    { shuffle: true },
    { repeat: "one" },
    { repeat: "all" },
  ])
    assert.equal(shouldRefill(state, { ...settings, ...extra }), false);
  for (const extra of [
    { playing: false },
    { sleepUntil: 1000 },
    { queue: [{ ...song, local: true }] },
    { queue: Array(200).fill(song), index: 199 },
  ])
    assert.equal(shouldRefill({ ...state, ...extra }, settings), false);
});
test("idle progress poll stops scheduling and event refresh restarts it", async () => {
  let active = false,
    calls = 0;
  const timers = new Map();
  let n = 0;
  const doc = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
  const clock = {
    setTimeout(fn) {
      timers.set(++n, fn);
      return n;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const stop = startVisiblePolling(async () => calls++, {
    document: doc,
    clock,
    interval: () => (active ? 1000 : null),
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(timers.size, 0);
  assert.equal(calls, 1);
  active = true;
  await stop.refresh();
  assert.equal(calls, 2);
  assert.equal(timers.size, 1);
  stop();
  assert.equal(timers.size, 0);
});
