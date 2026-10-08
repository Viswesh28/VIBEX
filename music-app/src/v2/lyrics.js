import { lyricScore } from "./core.js";
import { artistsOf } from "../lib/song.js";
import { decodeHtml } from "../lib/format.js";
import { parseLRC } from "../lib/lrc.js";
export async function findLyrics(song, providers, signal, manual = null) {
  const title = decodeHtml(song.name),
    artist = decodeHtml(artistsOf(song)).split(",")[0];
  const urls = {
    "lrclib-exact": `https://lrclib.net/api/get?${new URLSearchParams({ track_name: title, artist_name: artist, album_name: decodeHtml(song.album?.name || ""), duration: Math.round(song.duration || 0) })}`,
    "lrclib-search": `https://lrclib.net/api/search?${new URLSearchParams({ track_name: title, artist_name: artist })}`,
  };
  const online = providers.filter((p) => p in urls);
  let failed = 0;
  for (const provider of providers) {
    if (provider === "local") {
      if (manual) return manual;
      continue;
    }
    if (!(provider in urls)) continue;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const ctl = new AbortController(),
        abort = () => ctl.abort(),
        timer = setTimeout(abort, 7000);
      signal?.addEventListener("abort", abort, { once: true });
      let hits;
      try {
        const r = await fetch(urls[provider], { signal: ctl.signal });
        if (r.status === 404) continue;
        if (!r.ok) throw Error("Lyrics unavailable");
        hits = await r.json();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
      hits = Array.isArray(hits) ? hits : [hits];
      const ranked = hits
        .map((h) => ({
          h,
          score: lyricScore(h, { ...song, name: title, artist }),
        }))
        .filter((x) => x.score >= 0.63)
        .sort((a, b) => b.score - a.score);
      const hit = ranked[0]?.h;
      if (hit) {
        const lines = parseLRC(hit.syncedLyrics);
        if (hit.instrumental) return { type: "instrumental", provider };
        if (lines.length) return { type: "synced", lines, provider };
        if (hit.plainLyrics)
          return { type: "plain", text: hit.plainLyrics, provider };
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      failed++;
    }
  }
  return {
    type: failed === online.length && online.length ? "error" : "none",
  };
}
