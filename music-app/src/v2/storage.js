import { Audio, native } from "./native.js";
import { emptyLibrary, cleanSettings, songValid } from "./core.js";
let database,
  pending = Promise.resolve();
async function db() {
  if (database) return database;
  database = await new Promise((resolve, reject) => {
    const r = indexedDB.open("vibex-library", 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains("documents"))
        r.result.createObjectStore("documents");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return database;
}
export async function readDocument(key) {
  if (native) {
    const r = await Audio.getDocument({ key });
    return r.value ? JSON.parse(r.value) : null;
  }
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction("documents").objectStore("documents").get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export function writeDocument(key, value) {
  pending = pending
    .catch(() => {})
    .then(async () => {
      if (native)
        return Audio.setDocument({ key, value: JSON.stringify(value) });
      const d = await db();
      return new Promise((res, rej) => {
        const t = d.transaction("documents", "readwrite");
        t.objectStore("documents").put(value, key);
        t.oncomplete = res;
        t.onerror = () => rej(t.error);
      });
    });
  return pending;
}
export async function loadLibrary() {
  const saved = await readDocument("library");
  if (saved?.version === 2)
    return {
      ...emptyLibrary(),
      ...saved,
      settings: cleanSettings(saved.settings),
    };
  if (saved && saved.version !== 2)
    throw new Error(
      "Unsupported library version. Export it with the version that created it.",
    );
  const out = emptyLibrary();
  const get = (key, fall) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fall;
    } catch {
      return fall;
    }
  };
  const remember = (s) => {
    if (songValid(s)) out.songs[s.id] = s;
  };
  const liked = get("svLiked", []);
  if (Array.isArray(liked))
    liked.forEach((s) => {
      remember(s);
      if (songValid(s)) out.liked.push(s.id);
    });
  const playlists = get("svPlaylists", []);
  if (Array.isArray(playlists))
    out.playlists = playlists
      .filter((p) => p && Array.isArray(p.songs))
      .map((p, i) => {
        p.songs.forEach(remember);
        return {
          id: String(p.id || `migrated-${i}`),
          name: String(p.name || "My playlist"),
          ids: p.songs.filter(songValid).map((s) => s.id),
        };
      });
  const legacyStats = get("svStats", null);
  out.legacyStats = legacyStats;
  out.settings = {
    ...out.settings,
    theme: localStorage.getItem("svTheme") || "light",
    shuffle: localStorage.getItem("svShuffle") === "1",
    repeat: localStorage.getItem("svRepeat") || "off",
    crossfade:
      localStorage.getItem("svCf") === "0"
        ? 0
        : Number(localStorage.getItem("svCfd") || 3),
    quality: localStorage.getItem("svSaver") === "1" ? "48kbps" : "320kbps",
  };
  out.settings = cleanSettings(out.settings);
  await writeDocument("library", out);
  return out;
}

export function flushStorage() {
  return pending;
}
