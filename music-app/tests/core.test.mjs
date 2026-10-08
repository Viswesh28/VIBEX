import test from "node:test";
import assert from "node:assert/strict";
import {
  nextIndex,
  moveQueue,
  removeQueue,
  emptyLibrary,
  validateBackup,
  createBackup,
  mergeLibrary,
  summarize,
  lyricScore,
  cleanSettings,
} from "../src/v2/core.js";
test("automatic next honors shuffle and repeat", () => {
  assert.equal(
    nextIndex(3, 0, { shuffle: true, automatic: true, random: () => 0.99 }),
    2,
  );
  assert.equal(nextIndex(3, 2, {}), -1);
  assert.equal(nextIndex(3, 2, { repeat: "all" }), 0);
  assert.equal(nextIndex(3, 1, { repeat: "one", automatic: true }), 1);
});
test("queue bounds never corrupt current index", () => {
  assert.deepEqual(moveQueue(["a", "b"], 1, 1, 2), {
    queue: ["a", "b"],
    index: 1,
  });
  assert.deepEqual(moveQueue(["a", "b"], 1, 1, 0), {
    queue: ["b", "a"],
    index: 0,
  });
  assert.deepEqual(removeQueue(["a", "b"], 1, 0), { queue: ["b"], index: 0 });
  assert.deepEqual(removeQueue(["a"], 0, 0), { queue: [], index: 0 });
});
test("backup roundtrip excludes URLs, local files and queue", () => {
  const a = emptyLibrary();
  a.songs.a = { id: "a", name: "Song", downloadUrl: [{ url: "secret" }] };
  a.songs.l = {
    id: "l",
    name: "local",
    local: true,
    localUri: "content://file",
  };
  a.liked = ["a", "l"];
  a.playlists = [{ id: "p", name: "Fav", ids: ["a", "l"] }];
  const restored = validateBackup(createBackup(a));
  assert.deepEqual(restored.liked, ["a"]);
  assert.equal(restored.songs.a.downloadUrl, undefined);
  assert.deepEqual(restored.playlists[0].ids, ["a"]);
});
test("invalid backup is rejected before destructive changes", () => {
  assert.throws(() => validateBackup({ version: 1 }));
  const b = createBackup(emptyLibrary());
  b.library.playlists = [
    { id: "x", name: "one", ids: [] },
    { id: "x", name: "two", ids: [] },
  ];
  assert.throws(() => validateBackup(b));
});
test("merge preserves existing settings and deduplicates playlists", () => {
  const a = emptyLibrary(),
    b = emptyLibrary();
  a.playlists = [{ id: "p", name: "Mine", ids: ["a"] }];
  b.playlists = [{ id: "p", name: "Other", ids: ["a", "b"] }];
  assert.deepEqual(mergeLibrary(a, b).playlists[0], {
    id: "p",
    name: "Mine",
    ids: ["a", "b"],
  });
});
test("statistics summarize only valid time window", () => {
  const now = Date.now();
  const s = summarize(
    [
      { id: "a", sec: 5, at: now - 1000, play: true },
      { id: "b", sec: 10, at: now - 9 * 86400000 },
    ],
    7,
    now,
  );
  assert.equal(s.seconds, 5);
  assert.equal(s.plays, 1);
});
test("lyrics reject wrong recordings and duration mismatch", () => {
  const song = { name: "Hello", artist: "Adele", duration: 295 };
  assert.ok(
    lyricScore(
      { trackName: "Hello", artistName: "Adele", duration: 296 },
      song,
    ) > 0.9,
  );
  assert.equal(
    lyricScore(
      { trackName: "Hello", artistName: "Adele", duration: 200 },
      song,
    ),
    0,
  );
  assert.ok(
    lyricScore(
      { trackName: "Other", artistName: "Someone", duration: 295 },
      song,
    ) < 0.63,
  );
});
test("settings normalize backup values", () => {
  const s = cleanSettings({
    cacheMB: -1,
    crossfade: 999,
    repeat: "evil",
    lyricOffset: "bad",
    lyricsProviders: ["bad"],
  });
  assert.equal(s.cacheMB, 32);
  assert.equal(s.crossfade, 12);
  assert.equal(s.repeat, "off");
  assert.equal(s.lyricOffset, 0);
  assert.deepEqual(s.lyricsProviders, []);
});
import {
  parseImportedLyrics,
  appendEvents,
  rankDiscovery,
} from "../src/v2/core.js";
test("enhanced LRC keeps real timestamps and repeated line tags", () => {
  const r = parseImportedLyrics(
    "[00:01.20]<00:01.20>Hello <00:01.80>world\n[00:05][00:10]Again",
  );
  assert.equal(r.type, "synced");
  assert.equal(r.lines[0].words[1].t, 1.8);
  assert.equal(r.lines[0].words[0].text, "Hello ");
  assert.deepEqual(
    r.lines.map((l) => l.t),
    [1.2, 5, 10],
  );
  assert.equal(parseImportedLyrics("Untimed words").type, "plain");
});
test("event samples coalesce without manufacturing plays", () => {
  const events = appendEvents(
    [],
    [
      { id: "x", at: 100000, sec: 0.5 },
      { id: "x", at: 100500, sec: 0.5 },
      { id: "x", at: 101000, sec: 0.5, play: true },
    ],
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].sec, 1);
  assert.equal(events[1].play, true);
});
test("discovery favors liked artists but penalizes immediate repeats", () => {
  const songs = [
    { id: "a", name: "A", artists: { primary: [{ id: "1" }] } },
    { id: "b", name: "B", artists: { primary: [{ id: "1" }] } },
  ];
  const library = { songs: { a: songs[0] }, liked: ["a"], recent: ["a"] };
  assert.equal(rankDiscovery(songs, library)[0].id, "b");
});
test("user-imported lyric words survive backup and merge", () => {
  const a = emptyLibrary();
  a.songs.a = { id: "a", name: "A" };
  a.manualLyrics.a = parseImportedLyrics("[00:01]<00:01>Hello <00:02>world");
  const b = validateBackup(createBackup(a));
  assert.deepEqual(b.manualLyrics, a.manualLyrics);
  assert.deepEqual(
    mergeLibrary(emptyLibrary(), b).manualLyrics,
    a.manualLyrics,
  );
  b.manualLyrics.a.lines[0].t = "bad";
  assert.throws(() =>
    validateBackup({ format: "vibex-backup", version: 2, library: b }),
  );
});
test("backup merge deduplicates events and retains time", () => {
  const a = emptyLibrary(),
    b = emptyLibrary();
  a.events = [{ id: "a", at: 1, sec: 5, play: true }];
  b.events = [...a.events, { id: "b", at: 2, sec: 8 }];
  assert.equal(mergeLibrary(a, b).events.length, 2);
  assert.equal(summarize(mergeLibrary(a, b).events, 1, 3).seconds, 13);
});
test("settings and hostile backup song IDs are normalized or rejected", () => {
  assert.equal(cleanSettings(null).theme, "light");
  assert.equal(cleanSettings({ stats: "false" }).stats, true);
  const b = createBackup(emptyLibrary());
  b.library.songs = { x: { id: "__proto__", name: "Unsafe" } };
  assert.throws(() => validateBackup(b));
  assert.equal({}.name, undefined);
});
test("explicit skips penalize discovery without increasing listening statistics", () => {
  const now = Date.now();
  const a = emptyLibrary();
  a.events = [{ id: "a", at: now, sec: 0, skip: true }];
  const ranked = rankDiscovery(
    [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    a,
  );
  assert.equal(ranked[0].id, "b");
  assert.equal(summarize(a.events, 1, now).top.length, 0);
  assert.equal(
    appendEvents(
      [],
      [
        { id: "a", at: now, sec: 2 },
        { id: "a", at: now, sec: 0, skip: true },
      ],
    ).length,
    2,
  );
});
test("legacy cumulative history survives export and restore without becoming new events", () => {
  const a = emptyLibrary();
  a.legacyStats = {
    plays: 42,
    seconds: 600,
    songs: { a: { name: "Old song", n: 4, sec: 30 } },
  };
  const b = validateBackup(createBackup(a));
  assert.deepEqual(b.legacyStats, a.legacyStats);
  assert.equal(b.events.length, 0);
  assert.deepEqual(mergeLibrary(emptyLibrary(), b).legacyStats, a.legacyStats);
});
