import { lyricScore } from "./core.js";
import { artistsOf } from "../lib/song.js";
import { decodeHtml } from "../lib/format.js";
import { parseLRC } from "../lib/lrc.js";

/**
 * Multi-provider lyrics with a user-ordered fallback chain.
 *
 * Every provider is login-free. Providers run strictly in the user's order
 * (Settings → Lyrics); the first confident hit wins. A synced result returns
 * immediately; a plain-text result from an earlier provider is kept as a
 * fallback while later providers are still given the chance to find a synced
 * one — synced beats unsynced across the whole chain.
 *
 * KuGou has no CORS headers, so on-device those requests ride the native
 * HTTP patch (see lib/http.js); in a plain browser the provider simply fails
 * and the chain moves on.
 */

/** Decode KuGou's base64 LRC payload as UTF-8 (atob alone mangles non-ASCII). */
export function decodeBase64Utf8(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Who actually sings this? JioSaavn's `artists.primary` leads with the music
 * director for most Indian releases (Mithoon before Arijit Singh on
 * "Tum Hi Ho"), while LRCLIB and KuGou tag lyrics by the performing singer —
 * querying by composer made every lookup miss. Prefer entries with the
 * `singer` role, keep the primary credits as fallbacks, and let scoring try
 * each candidate.
 */
export function artistCandidates(song) {
  const names = [
    ...(song.artists?.all || [])
      .filter((a) => a?.role === "singer")
      .map((a) => a.name),
    ...(song.artists?.primary || []).map((a) => a.name),
    decodeHtml(artistsOf(song)).split(",")[0],
  ]
    .map((n) => decodeHtml(String(n || "")).trim())
    .filter(Boolean);
  return [...new Set(names)].slice(0, 4);
}

/** 0..1 confidence that a KuGou candidate is the same recording. */
export function kugouScore(candidate, { title, artist, duration }) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const song = norm(candidate.song),
    qt = norm(title);
  if (!song || !qt) return 0;
  const ta = new Set(qt.split(" ")),
    tb = new Set(song.split(" "));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  let s = 0.55 * (inter / Math.max(1, Math.min(ta.size, tb.size)));
  const singer = norm(candidate.singer);
  if (artist && (singer.includes(norm(artist)) || song.includes(norm(artist))))
    s += 0.25;
  const cd = (candidate.duration || 0) / 1000;
  if (duration && cd) {
    const d = Math.abs(duration - cd);
    s += d <= 2 ? 0.2 : d <= 5 ? 0.12 : d <= 12 ? 0.05 : 0;
  } else s += 0.1;
  return Math.min(1, s);
}

const timedFetch = async (url, signal, ms = 7000) => {
  const ctl = new AbortController(),
    abort = () => ctl.abort(),
    timer = setTimeout(abort, ms);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
};

/* ---------------------------------------------------------------- LRCLIB */

/** Best score across every plausible artist — composer, singer, feature. */
const bestScore = (h, { title, artists, duration }) =>
  Math.max(
    ...artists.map((artist) =>
      lyricScore(h, { name: title, artist, duration }),
    ),
  );

function pickLrclibHit(hits, query) {
  const ranked = hits
    .filter(Boolean)
    .map((h) => ({ h, score: bestScore(h, query) }))
    .filter((x) => x.score >= 0.63)
    .sort((a, b) => b.score - a.score);
  // A synced hit always beats a plain or instrumental-flagged one: LRCLIB
  // carries community-submitted junk rows (popular songs wrongly flagged
  // instrumental), so "instrumental" is only trusted when nothing else fits.
  return (
    ranked.find((x) => parseLRC(x.h.syncedLyrics).length)?.h ||
    ranked.find((x) => x.h.plainLyrics && !x.h.instrumental)?.h ||
    ranked[0]?.h ||
    null
  );
}

function hitToResult(hit) {
  if (!hit) return null;
  const lines = parseLRC(hit.syncedLyrics);
  if (lines.length) return { type: "synced", lines };
  if (hit.instrumental) return { type: "instrumental" };
  if (hit.plainLyrics) return { type: "plain", text: hit.plainLyrics };
  return null;
}

async function lrclib(kind, query, signal) {
  const { title, artists, album, duration } = query;
  if (kind === "exact") {
    // /api/get is a strict lookup, so the artist must be the one LRCLIB has
    // on file — try the likeliest two candidates (singer first).
    const hits = [];
    for (const artist of artists.slice(0, 2)) {
      const r = await timedFetch(
        `https://lrclib.net/api/get?${new URLSearchParams({ track_name: title, artist_name: artist, album_name: album, duration: Math.round(duration || 0) })}`,
        signal,
      );
      if (r.status === 404) continue;
      if (!r.ok) throw Error("Lyrics unavailable");
      hits.push(await r.json());
      // A singer-tagged synced hit is what we want; stop as soon as one fits.
      if (pickLrclibHit(hits, query)) break;
    }
    return hitToResult(pickLrclibHit(hits, query));
  }
  // Search by title alone for recall — local scoring (title overlap, any
  // credited artist, duration drift ≤ 15 s) still refuses wrong recordings.
  const r = await timedFetch(
    `https://lrclib.net/api/search?${new URLSearchParams({ track_name: title })}`,
    signal,
  );
  if (r.status === 404) return null;
  if (!r.ok) throw Error("Lyrics unavailable");
  const hits = await r.json();
  return hitToResult(pickLrclibHit(Array.isArray(hits) ? hits : [hits], query));
}

/* ----------------------------------------------------------------- KuGou */

async function kugou({ title, artists, duration }, signal) {
  const search = await timedFetch(
    `https://krcs.kugou.com/search?${new URLSearchParams({ ver: 1, man: "yes", client: "mobi", keyword: `${artists[0]} - ${title}`, duration: Math.round((duration || 0) * 1000) })}`,
    signal,
  );
  if (!search.ok) throw Error("Lyrics unavailable");
  const data = await search.json();
  const ranked = (data.candidates || [])
    .map((c) => ({
      c,
      score: Math.max(
        ...artists.map((artist) =>
          kugouScore(c, { title, artist, duration }),
        ),
      ),
    }))
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score);
  const hit = ranked[0]?.c;
  if (!hit) return null;
  const dl = await timedFetch(
    `https://krcs.kugou.com/download?${new URLSearchParams({ ver: 1, man: "yes", client: "pc", fmt: "lrc", id: hit.id, accesskey: hit.accesskey })}`,
    signal,
  );
  if (!dl.ok) throw Error("Lyrics unavailable");
  const body = await dl.json();
  if (!body.content) return null;
  const lines = parseLRC(decodeBase64Utf8(body.content)).filter(
    // KuGou embeds credit lines; drop obvious metadata rows.
    (l) => !/^(作词|作曲|编曲|词|曲)\s*[:：]/.test(l.text || ""),
  );
  if (lines.length) return { type: "synced", lines };
  return null;
}

/* ----------------------------------------------------------------- chain */

export const PROVIDERS = {
  "lrclib-exact": (song, signal) => lrclib("exact", song, signal),
  "lrclib-search": (song, signal) => lrclib("search", song, signal),
  kugou: (song, signal) => kugou(song, signal),
};

export async function findLyrics(song, providers, signal, manual = null) {
  const query = {
    title: decodeHtml(song.name),
    artists: artistCandidates(song),
    album: decodeHtml(song.album?.name || ""),
    duration: song.duration || 0,
  };
  const online = providers.filter((p) => p in PROVIDERS);
  let failed = 0;
  // Unsynced or instrumental hits wait while later providers race for a
  // synced one; synced beats plain beats instrumental across the chain.
  let plainFallback = null;
  let instrumentalFallback = null;
  for (const provider of providers) {
    if (provider === "local") {
      if (manual) return manual;
      continue;
    }
    if (!(provider in PROVIDERS)) continue;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const result = await PROVIDERS[provider](query, signal);
      if (!result) continue;
      if (result.type === "synced") return { ...result, provider };
      if (result.type === "instrumental") {
        if (!instrumentalFallback)
          instrumentalFallback = { ...result, provider };
      } else if (!plainFallback) plainFallback = { ...result, provider };
    } catch (e) {
      if (signal?.aborted) throw e;
      failed++;
    }
  }
  if (plainFallback) return plainFallback;
  if (instrumentalFallback) return instrumentalFallback;
  return {
    type: failed === online.length && online.length ? "error" : "none",
  };
}
