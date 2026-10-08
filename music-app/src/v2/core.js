// Platform-independent rules. Kept pure so queue, restore and backup behavior is testable.
export const SCHEMA = 2;
export const defaults = {
  batterySaver: false,
  autoplay: false,
  playlistSort: "recent",
  theme: "light",
  language: "Tamil",
  genre: "All",
  quality: "320kbps",
  downloadQuality: "160kbps",
  wifiOnly: true,
  shuffle: false,
  repeat: "off",
  crossfade: 3,
  stats: true,
  eq: "Flat",
  lyricsProviders: ["local", "lrclib-exact", "lrclib-search"],
  lyricOffset: 0,
  stopOnDismiss: false,
  cacheMB: 128,
};
export const emptyLibrary = () => ({
  version: SCHEMA,
  songs: {},
  liked: [],
  playlists: [],
  recent: [],
  events: [],
  settings: { ...defaults },
  session: { queue: [], index: 0, position: 0 },
  lyrics: {},
  manualLyrics: {},
  searchHistory: [],
  lyricOffsets: {},
});
export function songValid(s) {
  return (
    !!s &&
    typeof s.id === "string" &&
    s.id.length > 0 &&
    s.id.length < 512 &&
    !["__proto__", "constructor", "prototype"].includes(s.id) &&
    typeof s.name === "string"
  );
}
export function uniqueSongs(songs) {
  return [...new Map(songs.filter(songValid).map((s) => [s.id, s])).values()];
}
export function nextIndex(
  length,
  index,
  {
    shuffle = false,
    repeat = "off",
    automatic = false,
    random = Math.random,
  } = {},
) {
  if (!length) return -1;
  if (automatic && repeat === "one") return index;
  if (shuffle && length > 1) {
    const n = Math.floor(random() * (length - 1));
    return n >= index ? n + 1 : n;
  }
  if (index + 1 < length) return index + 1;
  return repeat === "all" ? 0 : -1;
}
export function moveQueue(queue, index, from, to) {
  if (from < 0 || to < 0 || from >= queue.length || to >= queue.length)
    return { queue, index };
  const next = [...queue],
    current = queue[index];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return { queue: next, index: next.indexOf(current) };
}
export function removeQueue(queue, index, at) {
  if (at < 0 || at >= queue.length) return { queue, index };
  const next = queue.filter((_, i) => i !== at);
  return {
    queue: next,
    index: next.length
      ? Math.max(0, Math.min(index - (at < index ? 1 : 0), next.length - 1))
      : 0,
  };
}
const finite = (n, min, max, fallback) =>
  Number.isFinite(+n) ? Math.min(max, Math.max(min, +n)) : fallback;
export function cleanSettings(s = {}) {
  if (!s || typeof s !== "object" || Array.isArray(s)) s = {};
  return {
    ...defaults,
    ...Object.fromEntries(
      Object.keys(defaults)
        .filter((k) => k in s)
        .map((k) => [k, s[k]]),
    ),
    ...Object.fromEntries(
      [
        "wifiOnly",
        "shuffle",
        "stats",
        "stopOnDismiss",
        "batterySaver",
        "autoplay",
      ].map((k) => [k, typeof s[k] === "boolean" ? s[k] : defaults[k]]),
    ),
    language: [
      "Tamil",
      "Hindi",
      "English",
      "Telugu",
      "Malayalam",
      "Kannada",
      "Punjabi",
      "Bengali",
    ].includes(s.language)
      ? s.language
      : defaults.language,
    genre: [
      "All",
      "Pop",
      "Indie",
      "Classical",
      "Rock",
      "Devotional",
      "Jazz",
    ].includes(s.genre)
      ? s.genre
      : "All",
    eq: ["Flat", "Bass boost", "Vocal", "Bright"].includes(s.eq)
      ? s.eq
      : "Flat",
    theme: ["light", "dark"].includes(s.theme) ? s.theme : defaults.theme,
    repeat: ["off", "all", "one"].includes(s.repeat) ? s.repeat : "off",
    quality: ["12kbps", "48kbps", "96kbps", "160kbps", "320kbps"].includes(
      s.quality,
    )
      ? s.quality
      : defaults.quality,
    downloadQuality: ["48kbps", "96kbps", "160kbps", "320kbps"].includes(
      s.downloadQuality,
    )
      ? s.downloadQuality
      : defaults.downloadQuality,
    playlistSort: ["recent", "name", "tracks"].includes(s.playlistSort)
      ? s.playlistSort
      : "recent",
    lyricOffset: finite(s.lyricOffset, -30, 30, 0),
    crossfade: finite(s.crossfade, 0, 12, 3),
    cacheMB: finite(s.cacheMB, 32, 1024, 128),
    lyricsProviders: Array.isArray(s.lyricsProviders)
      ? [
          ...new Set(
            s.lyricsProviders.filter((p) =>
              ["local", "lrclib-exact", "lrclib-search"].includes(p),
            ),
          ),
        ]
      : defaults.lyricsProviders,
  };
}
export function validateBackup(input) {
  if (
    !input ||
    input.format !== "vibex-backup" ||
    input.version !== SCHEMA ||
    !input.library
  )
    throw Error("Not a supported VIBEX v2 backup.");
  const d = input.library,
    out = emptyLibrary();
  if (
    !d.songs ||
    typeof d.songs !== "object" ||
    Array.isArray(d.songs) ||
    !Array.isArray(d.liked) ||
    !Array.isArray(d.playlists)
  )
    throw Error("Backup is missing library fields.");
  const entries = Object.values(d.songs);
  if (entries.length > 10000 || d.playlists.length > 500)
    throw Error("Backup exceeds the supported library size.");
  for (const s of entries) {
    if (!songValid(s)) throw Error("Invalid song in backup.");
    if (s.local) continue;
    out.songs[s.id] = { ...s };
    delete out.songs[s.id].localUri;
    delete out.songs[s.id].downloadUrl;
    if (
      (s.artists?.primary &&
        (!Array.isArray(s.artists.primary) ||
          s.artists.primary.some((a) => !a || typeof a.name !== "string"))) ||
      (s.image &&
        (!Array.isArray(s.image) ||
          s.image.some((i) => !i || typeof i.url !== "string")))
    )
      throw Error("Invalid song metadata in backup.");
  }
  out.liked = [
    ...new Set(d.liked.filter((id) => Object.hasOwn(out.songs, id))),
  ];
  const ids = new Set();
  out.playlists = d.playlists.map((p) => {
    if (
      !p ||
      typeof p.id !== "string" ||
      !p.id ||
      ids.has(p.id) ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      !Array.isArray(p.ids)
    )
      throw Error("Invalid or duplicate playlist in backup.");
    ids.add(p.id);
    return {
      id: p.id,
      name: p.name.trim().slice(0, 80),
      pinned: p.pinned === true,
      ids: [...new Set(p.ids.filter((id) => Object.hasOwn(out.songs, id)))],
    };
  });
  out.manualLyrics = cleanManualLyrics(d.manualLyrics, out.songs);
  out.settings = cleanSettings(d.settings);
  out.lyricOffsets = cleanLyricOffsets(d.lyricOffsets, out.songs);
  if (
    d.legacyStats &&
    typeof d.legacyStats === "object" &&
    !Array.isArray(d.legacyStats)
  ) {
    if (JSON.stringify(d.legacyStats).length > 2 * 1024 * 1024)
      throw Error("Legacy history is too large.");
    out.legacyStats = {
      ...d.legacyStats,
      plays: finite(d.legacyStats.plays, 0, 1e9, 0),
      seconds: finite(d.legacyStats.seconds, 0, 1e12, 0),
    };
  }
  out.recent = Array.isArray(d.recent)
    ? d.recent.filter((id) => Object.hasOwn(out.songs, id)).slice(0, 100)
    : [];
  out.events = Array.isArray(d.events)
    ? d.events
        .filter(
          (e) =>
            e &&
            typeof e.id === "string" &&
            Number.isFinite(e.at) &&
            Number.isFinite(e.sec) &&
            e.sec >= 0 &&
            e.sec <= 60,
        )
        .slice(-10000)
    : [];
  return out;
}
export function mergeLibrary(a, b) {
  const playlists = [...a.playlists];
  for (const p of b.playlists) {
    const i = playlists.findIndex((x) => x.id === p.id);
    if (i < 0) playlists.push(p);
    else
      playlists[i] = {
        ...playlists[i],
        ids: [...new Set([...playlists[i].ids, ...p.ids])],
      };
  }
  return {
    ...a,
    songs: { ...b.songs, ...a.songs },
    liked: [...new Set([...a.liked, ...b.liked])],
    manualLyrics: { ...b.manualLyrics, ...a.manualLyrics },
    lyricOffsets: { ...b.lyricOffsets, ...a.lyricOffsets },
    legacyStats: a.legacyStats || b.legacyStats || null,
    events: mergeEvents(a.events, b.events),
    playlists,
    recent: [...new Set([...a.recent, ...b.recent])].slice(0, 100),
  };
}
export function createBackup(library, events = library.events) {
  const songs = Object.fromEntries(
    Object.entries(library.songs)
      .filter(([, s]) => !s.local)
      .map(([id, s]) => {
        const { downloadUrl, localUri, ...safe } = s;
        return [id, safe];
      }),
  );
  return {
    format: "vibex-backup",
    version: SCHEMA,
    createdAt: new Date().toISOString(),
    library: {
      ...library,
      songs,
      events,
      searchHistory: [],
      session: { queue: [], index: 0, position: 0 },
      lyrics: {},
      manualLyrics: cleanManualLyrics(library.manualLyrics, songs),
      lyricOffsets: cleanLyricOffsets(library.lyricOffsets, songs),
    },
  };
}
export function summarize(events, days = 7, now = Date.now()) {
  const cutoff = now - days * 86400000,
    songs = Object.create(null),
    daily = Object.create(null);
  let seconds = 0,
    plays = 0;
  for (const e of events) {
    if (e.at < cutoff || e.at > now || e.skip) continue;
    seconds += e.sec;
    plays += e.play ? 1 : 0;
    const key = new Date(e.at).toLocaleDateString("en-CA");
    daily[key] = (daily[key] || 0) + e.sec;
    songs[e.id] ??= {
      id: e.id,
      name: e.name,
      artist: e.artist,
      image: e.image,
      seconds: 0,
    };
    songs[e.id].seconds += e.sec;
  }
  return {
    seconds,
    plays,
    daily,
    top: Object.values(songs).sort((a, b) => b.seconds - a.seconds),
  };
}
export function lyricScore(hit, song) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const overlap = (a, b) => {
    const aa = new Set(norm(a).split(" ").filter(Boolean)),
      bb = new Set(norm(b).split(" ").filter(Boolean));
    return aa.size && bb.size
      ? [...aa].filter((t) => bb.has(t)).length / Math.max(aa.size, bb.size)
      : 0;
  };
  const drift = Math.abs(Number(hit.duration) - Number(song.duration));
  if (!Number.isFinite(drift) || drift > 15) return 0;
  return (
    overlap(hit.trackName, song.name) * 0.6 +
    overlap(hit.artistName, song.artist) * 0.3 +
    (1 - drift / 15) * 0.1
  );
}

export function appendEvents(existing, incoming) {
  const out = [...existing];
  for (const e of incoming) {
    const last = out.at(-1);
    if (
      last &&
      last.id === e.id &&
      Math.floor(last.at / 86400000) === Math.floor(e.at / 86400000) &&
      last.sec + e.sec <= 60 &&
      !e.play &&
      !e.skip &&
      !last.skip
    ) {
      out[out.length - 1] = { ...last, sec: last.sec + e.sec };
    } else out.push({ ...e });
  }
  return out.slice(-10000);
}
export function rankDiscovery(songs, library, events = library.events || []) {
  const recentEvents = events.filter((e) => e.at > Date.now() - 30 * 86400000);
  const skips = new Set(recentEvents.filter((e) => e.skip).map((e) => e.id));
  const enjoyedArtists = new Set(
    recentEvents.filter((e) => e.play).map((e) => e.artist),
  );
  const likedArtists = new Set(
    library.liked
      .map((id) => library.songs[id])
      .filter(Boolean)
      .flatMap((s) => (s.artists?.primary || []).map((a) => a.id)),
  );
  return uniqueSongs(songs)
    .map((s, i) => ({
      s,
      score: (s.artists?.primary || []).some((a) => likedArtists.has(a.id))
        ? 4
        : 0,
      i,
    }))
    .map((x) => ({
      ...x,
      score:
        x.score -
        (library.recent.slice(0, 8).includes(x.s.id) ? 3 : 0) -
        (skips.has(x.s.id) ? 5 : 0) +
        ((x.s.artists?.primary || []).some((a) => enjoyedArtists.has(a.name))
          ? 1
          : 0),
    }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.s);
}

// Enhanced LRC words are highlighted only when the file supplies real word timestamps.
export function parseImportedLyrics(raw) {
  const lines = [];
  const seconds = (m, s, f = "") =>
    +m * 60 + +s + (f ? +f / 10 ** f.length : 0);
  for (const row of String(raw).split(/\r?\n/)) {
    const lineTags = [...row.matchAll(/\[(\d+):(\d+)(?:\.(\d+))?\]/g)];
    if (!lineTags.length) continue;
    const content = row.replace(/\[\d+:\d+(?:\.\d+)?\]/g, "").trim();
    const tags = [...content.matchAll(/<(\d+):(\d+)(?:\.(\d+))?>/g)];
    const words = tags
      .map((tag, i) => ({
        t: seconds(tag[1], tag[2], tag[3]),
        text: content.slice(
          tag.index + tag[0].length,
          tags[i + 1]?.index ?? content.length,
        ),
      }))
      .filter((w) => w.text.trim());
    const clean = content.replace(/<\d+:\d+(?:\.\d+)?>/g, "").trim();
    if (!clean) continue;
    for (const tag of lineTags)
      lines.push({
        t: seconds(tag[1], tag[2], tag[3]),
        text: clean,
        ...(words.length && lineTags.length === 1 ? { words } : {}),
      });
  }
  lines.sort((a, b) => a.t - b.t);
  return lines.length
    ? { type: "synced", lines, provider: "local" }
    : { type: "plain", text: String(raw).trim(), provider: "local" };
}

// Validate user-owned lyric imports separately from the disposable online lyric cache.
export function cleanManualLyrics(records = {}, songs = {}) {
  if (
    !records ||
    typeof records !== "object" ||
    Array.isArray(records) ||
    Object.keys(records).length > 1000
  )
    throw Error("Invalid imported lyrics in backup.");
  const out = {};
  const validText = (t) => typeof t === "string" && t.length <= 500000;
  const validTime = (t) => Number.isFinite(t) && t >= 0 && t <= 1000000;
  for (const [id, r] of Object.entries(records)) {
    if (!Object.hasOwn(songs, id)) continue;
    if (!r || JSON.stringify(r).length > 1024 * 1024)
      throw Error("Invalid imported lyrics in backup.");
    if (r.type === "plain" && validText(r.text))
      out[id] = { type: "plain", text: r.text, provider: "local" };
    else if (
      r.type === "synced" &&
      Array.isArray(r.lines) &&
      r.lines.length <= 10000
    ) {
      out[id] = {
        type: "synced",
        provider: "local",
        lines: r.lines
          .map((l) => {
            if (!l || !validTime(l.t) || !validText(l.text))
              throw Error("Invalid lyric line in backup.");
            const line = { t: l.t, text: l.text };
            if (l.words) {
              if (!Array.isArray(l.words) || l.words.length > 1000)
                throw Error("Invalid lyric words in backup.");
              line.words = l.words
                .map((w) => {
                  if (!w || !validTime(w.t) || !validText(w.text))
                    throw Error("Invalid lyric word in backup.");
                  return { t: w.t, text: w.text };
                })
                .sort((a, b) => a.t - b.t);
            }
            return line;
          })
          .sort((a, b) => a.t - b.t),
      };
    } else throw Error("Invalid imported lyrics in backup.");
  }
  return out;
}
export function mergeEvents(a = [], b = []) {
  return [
    ...new Map(
      [...a, ...b].map((e) => [
        `${e.id}|${e.at}|${e.sec}|${!!e.play}|${!!e.skip}`,
        e,
      ]),
    ).values(),
  ]
    .sort((x, y) => x.at - y.at)
    .slice(-10000);
}

export function cacheLyrics(existing, id, result, offlineIds = []) {
  const all = Object.entries({ ...existing, [id]: result });
  const offline = new Set(offlineIds);
  return Object.fromEntries([
    ...all.filter(([key]) => offline.has(key)).slice(-1000),
    ...all.filter(([key]) => !offline.has(key)).slice(-150),
  ]);
}

export function addRecentSearch(history, query, tab = "songs") {
  const normalize = (value) =>
    typeof value === "string"
      ? value.replace(/\s+/g, " ").trim().slice(0, 120)
      : "";
  const tabs = ["songs", "albums", "artists", "playlists"];
  const clean = (Array.isArray(history) ? history : [])
    .filter((h) => h && normalize(h.query) && tabs.includes(h.tab))
    .map((h) => ({ query: normalize(h.query), tab: h.tab }));
  const q = normalize(query);
  if (!q) return clean.slice(0, 8);
  const type = tabs.includes(tab) ? tab : "songs";
  return [
    { query: q, tab: type },
    ...clean.filter(
      (h) =>
        h.query.toLocaleLowerCase() !== q.toLocaleLowerCase() || h.tab !== type,
    ),
  ].slice(0, 8);
}
export function downloadBadge(download) {
  if (!download) return null;
  if (download.state === 3) return { text: "Downloaded", ready: true };
  const labels = {
    0: "Download queued",
    1: "Download paused",
    2: "Downloading",
    4: "Download failed",
    5: "Removing download",
    7: "Restarting download",
  };
  return labels[download.state]
    ? { text: labels[download.state], ready: false }
    : null;
}

export function cleanLyricOffsets(records, songs) {
  if (!records || typeof records !== "object" || Array.isArray(records))
    return {};
  return Object.fromEntries(
    Object.entries(records)
      .filter(
        ([id, value]) =>
          Object.hasOwn(songs, id) &&
          typeof value === "number" &&
          Number.isFinite(value),
      )
      .slice(0, 10000)
      .map(([id, value]) => [id, Math.max(-30, Math.min(30, value))]),
  );
}
export function lyricOffsetFor(library, id) {
  const value = library.lyricOffsets?.[id];
  return Number.isFinite(value) ? value : library.settings.lyricOffset;
}
export function sortedPlaylists(playlists, order = "recent") {
  return [...playlists].sort(
    (a, b) =>
      Number(!!b.pinned) - Number(!!a.pinned) ||
      (order === "name"
        ? a.name.localeCompare(b.name)
        : order === "tracks"
          ? b.ids.length - a.ids.length
          : 0),
  );
}
// Keep autoplay finite, opt-in, and inactive during saver/repeat/shuffle/sleep.
export function shouldRefill(state, settings) {
  const current = state.queue[state.index];
  return !!(
    settings.autoplay &&
    !settings.batterySaver &&
    !settings.shuffle &&
    settings.repeat === "off" &&
    state.playing &&
    !state.sleepUntil &&
    current &&
    !current.local &&
    state.queue.length < 200 &&
    state.queue.length - state.index <= 2
  );
}
