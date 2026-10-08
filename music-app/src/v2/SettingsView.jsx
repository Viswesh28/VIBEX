import { writeDocument, flushStorage } from "./storage.js";
import { useRef, useState } from "react";
import {
  Download,
  ArrowUp,
  Music2,
  Headphones,
  Sun,
  Trash2,
  Upload,
  SlidersHorizontal,
} from "lucide-react";
import { useVibe } from "./Model.jsx";
import { Audio, native } from "./native.js";
import { decodeHtml } from "../lib/format.js";
import { createBackup, validateBackup, mergeLibrary } from "./core.js";
import { Section, homeCache } from "./ui.jsx";
const text = decodeHtml;
export function SettingsView() {
  const {
      settings,
      setSetting,
      library,
      update,
      notify,
      events,
      offline,
      run,
    } = useVibe(),
    file = useRef(),
    [backup, setBackup] = useState(null);
  const exportBackup = () =>
    run(async () => {
      const data = JSON.stringify(createBackup(library, events), null, 2);
      if (native) {
        await Audio.exportBackup({
          data,
        });
        return;
      }
      const url = URL.createObjectURL(
        new Blob([data], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "VIBEX-backup.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  const importBackup = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      if (f.size > 20 * 1024 * 1024) throw Error("Backup exceeds 20 MB.");
      setBackup(validateBackup(JSON.parse(await f.text())));
    } catch (err) {
      notify(err.message);
    }
  };
  const restore = (mode) =>
    run(async () => {
      if (!backup) return;
      const next =
        mode === "merge"
          ? mergeLibrary(
              {
                ...library,
                events,
              },
              backup,
            )
          : {
              ...backup,
              session: library.session,
              songs: {
                ...backup.songs,
                ...Object.fromEntries(
                  Object.entries(library.songs).filter(([, s]) => s.local),
                ),
              },
            };
      update(next);
      try {
        if (native) {
          await flushStorage();
          await Audio.restoreLibrary({
            library: JSON.stringify(next),
            events: next.events,
          });
        } else await writeDocument("library", next);
      } catch (e) {
        update(library);
        await writeDocument("library", library);
        throw e;
      }
      setBackup(null);
      notify(
        "Library restored. Local audio and managed downloads were not deleted.",
      );
    });
  return (
    <>
      <div className="page-title">
        <span className="eyebrow">MAKE IT FEEL LIKE YOU</span>
        <h1>Your preferences</h1>
      </div>
      <div className="settings-grid">
        <Section title="Battery & efficiency">
          <div className="settings-card">
            <label className="toggle-row">
              <span>
                <b>Battery Saver</b>
                <small>
                  Less animation and background work. Your music keeps playing.
                </small>
              </span>
              <input
                aria-label="Battery Saver"
                role="switch"
                type="checkbox"
                checked={settings.batterySaver}
                onChange={(e) => setSetting("batterySaver", e.target.checked)}
              />
            </label>
            <p className="setting-note">
              {settings.batterySaver
                ? "Saver is on"
                : "Always-on optimizations are active"}
              : the idle player has no maintenance loop, widget changes are
              event-driven, and hidden screens stop UI polling.
            </p>
            <p className="setting-note">
              Saver also suspends crossfade and autoplay refill, reuses saved
              Home picks until you refresh, and slows visible progress updates.
              Quality, EQ, downloads, and your saved crossfade preference are
              not changed.
            </p>
            <label className="toggle-row">
              <span>
                <b>Autoplay queue</b>
                <small>
                  Append up to 6 related songs near the end. Android can
                  continue with the screen off.
                </small>
              </span>
              <input
                aria-label="Autoplay queue"
                role="switch"
                type="checkbox"
                checked={settings.autoplay}
                onChange={(e) => setSetting("autoplay", e.target.checked)}
              />
            </label>
            <p className="setting-note">
              Opt-in and bounded to 200 queued tracks. Paused during Battery
              Saver, shuffle, repeat, sleep timers, or local-file playback. Uses
              your connection; it does not create offline downloads.
            </p>
          </div>
        </Section>
        <Section title="Look & feel">
          <div className="settings-card">
            <label className="setting-row">
              <span>
                <Sun />
                <b>Appearance</b>
              </span>
              <select
                value={settings.theme}
                onChange={(e) => setSetting("theme", e.target.value)}
              >
                <option value="light">Soft light</option>
                <option value="dark">Midnight</option>
              </select>
            </label>
            <label className="setting-row">
              <span>
                <Sun />
                <b>Player style</b>
              </span>
              <select
                value={settings.playerStyle}
                onChange={(e) => setSetting("playerStyle", e.target.value)}
              >
                <option value="classic">Classic</option>
                <option value="aurora">Aurora glass</option>
              </select>
            </label>
            <label className="setting-row">
              <span>
                <Music2 />
                <b>Favorite genre</b>
              </span>
              <select
                value={settings.genre}
                onChange={(e) => setSetting("genre", e.target.value)}
              >
                {[
                  "All",
                  "Pop",
                  "Indie",
                  "Classical",
                  "Rock",
                  "Devotional",
                  "Jazz",
                ].map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </label>
          </div>
        </Section>
        <Section title="Playback">
          <div className="settings-card">
            <p className="setting-note">
              On Android, music continues when you press Home, switch apps, or
              lock the screen. Reopening Vibex or tapping its media notification
              returns to the current song. Paused songs stay paused.
            </p>
            <label className="setting-row">
              <span>
                <Headphones />
                <b>Streaming quality</b>
              </span>
              <select
                value={settings.quality}
                onChange={(e) => setSetting("quality", e.target.value)}
              >
                {["12kbps", "48kbps", "96kbps", "160kbps", "320kbps"].map(
                  (q) => (
                    <option key={q}>{q}</option>
                  ),
                )}
              </select>
            </label>
            <label className="range-setting">
              <span>
                Crossfade{" "}
                <b>
                  {settings.crossfade ? `${settings.crossfade} seconds` : "Off"}
                </b>
              </span>
              <input
                type="range"
                min="0"
                max="12"
                step="1"
                disabled={settings.batterySaver}
                value={settings.crossfade}
                onChange={(e) => setSetting("crossfade", +e.target.value)}
              />
              <small>
                {settings.batterySaver
                  ? "Temporarily suspended by Battery Saver. Your preference is kept."
                  : "Equal-power overlap between tracks. Repeat-one does not crossfade."}
              </small>
            </label>
            <label className="setting-row">
              <span>
                <SlidersHorizontal />
                <b>Equalizer</b>
              </span>
              <select
                value={settings.eq}
                onChange={(e) => setSetting("eq", e.target.value)}
              >
                {["Flat", "Bass boost", "Vocal", "Bright"].map((q) => (
                  <option key={q}>{q}</option>
                ))}
              </select>
            </label>
            <p className="setting-note">
              Flat bypasses processing. EQ availability depends on your device
              and audio output. Start a new queue to apply stream-quality
              changes.
            </p>
            <label className="toggle-row">
              <span>
                <b>Stop when dismissed</b>
                <small>
                  Leave off to keep playing when swiping Vibex out of Recents.
                  Home and screen lock do not pause music.
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={settings.stopOnDismiss}
                onChange={(e) => setSetting("stopOnDismiss", e.target.checked)}
              />
            </label>
          </div>
        </Section>
        <Section title="Lyrics">
          <div className="settings-card">
            <p className="setting-note">
              Sources are tried in this order. Search matches are checked
              against the song title, artist, and duration.
            </p>
            {[
              ...settings.lyricsProviders,
              ...["local", "lrclib-exact", "lrclib-search", "kugou"].filter(
                (id) => !settings.lyricsProviders.includes(id),
              ),
            ].map((id) => (
              <label className="toggle-row" key={id}>
                <span>
                  <b>
                    {id === "local"
                      ? "Your imported LRC / text"
                      : id === "lrclib-exact"
                        ? "LRCLIB · Exact recording"
                        : id === "lrclib-search"
                          ? "LRCLIB · Matched search"
                          : "KuGou · Community synced"}
                  </b>
                  <small>
                    {id === "local"
                      ? "Attached to this track; included in your library backup"
                      : id === "lrclib-exact"
                        ? "Title, album, artist and duration"
                        : id === "lrclib-search"
                          ? "Fallback when an exact lookup has no result"
                          : "Login-free; strong for Indian and Asian catalogs"}
                  </small>
                </span>
                <input
                  role="switch"
                  type="checkbox"
                  checked={settings.lyricsProviders.includes(id)}
                  onChange={(e) =>
                    setSetting(
                      "lyricsProviders",
                      e.target.checked
                        ? [...settings.lyricsProviders, id]
                        : settings.lyricsProviders.filter((x) => x !== id),
                    )
                  }
                />
              </label>
            ))}
            <button
              className="text-button"
              onClick={() =>
                setSetting(
                  "lyricsProviders",
                  [...settings.lyricsProviders].reverse(),
                )
              }
            >
              <ArrowUp size={16} /> Reverse source priority
            </button>
            <label className="range-setting">
              <span>
                Global lyrics timing{" "}
                <b>
                  {settings.lyricOffset > 0 ? "+" : ""}
                  {settings.lyricOffset}s
                </b>
              </span>
              <input
                type="range"
                min="-10"
                max="10"
                step=".25"
                value={settings.lyricOffset}
                onChange={(e) => setSetting("lyricOffset", +e.target.value)}
              />
            </label>
          </div>
        </Section>
        <Section title="Downloads & storage">
          <div className="settings-card">
            <label className="setting-row">
              <span>
                <Download />
                <b>Download quality</b>
              </span>
              <select
                value={settings.downloadQuality}
                onChange={(e) => setSetting("downloadQuality", e.target.value)}
              >
                {["48kbps", "96kbps", "160kbps", "320kbps"].map((q) => (
                  <option key={q}>{q}</option>
                ))}
              </select>
            </label>
            <label className="setting-row">
              <span>
                <b>Temporary audio cache</b>
              </span>
              <select
                value={settings.cacheMB}
                onChange={(e) => setSetting("cacheMB", +e.target.value)}
              >
                {[64, 128, 256, 512].map((n) => (
                  <option value={n} key={n}>
                    {n} MB
                  </option>
                ))}
              </select>
            </label>
            <p className="setting-note">
              Cache limit applies after restarting the Android player service.
              Downloaded music is kept separately until you delete it.
            </p>
            <button
              className="secondary"
              onClick={() =>
                native
                  ? run(async () => {
                      await Audio.clearCache();
                      notify("Temporary stream cache cleared");
                    })
                  : notify("Audio caching is managed by your browser")
              }
            >
              <Trash2 size={16} /> Clear stream cache ·{" "}
              {((offline.streamBytes || 0) / 1048576).toFixed(1)} MB
            </button>
          </div>
        </Section>
        <Section title="Saved Home picks">
          <div className="settings-card">
            <p className="setting-note">
              Up to 12 Home responses, capped at approximately 2 MB and 7 days.
              Metadata only—not playable audio. Excluded from backups. Normal
              mode refreshes on a Home visit after 15 minutes; Saver waits for
              manual refresh.
            </p>
            <button
              className="secondary"
              onClick={() =>
                run(async () => {
                  await homeCache.clear();
                  notify("Saved Home picks cleared");
                })
              }
            >
              <Trash2 size={16} /> Clear saved Home picks
            </button>
          </div>
        </Section>
        <Section title="Your data, your control">
          <div className="settings-card">
            <label className="toggle-row">
              <span>
                <b>Listening history & insights</b>
                <small>Stored on your device. Never sent for analytics.</small>
              </span>
              <input
                role="switch"
                type="checkbox"
                checked={settings.stats}
                onChange={(e) => setSetting("stats", e.target.checked)}
              />
            </label>
            <div className="button-row">
              <button className="secondary" onClick={exportBackup}>
                <Download size={16} /> Export backup
              </button>
              <button
                className="secondary"
                onClick={() => file.current.click()}
              >
                <Upload size={16} /> Restore backup
              </button>
              <input
                type="file"
                accept="application/json,.json"
                hidden
                ref={file}
                onChange={importBackup}
              />
            </div>
            <p className="setting-note">
              Backups include playlists, likes, preferences and listening
              events. Audio files, local-file permissions and credentials are
              not included.
            </p>
            {backup && (
              <div className="restore-box">
                <strong>Backup ready to restore</strong>
                <p>
                  {Object.keys(backup.songs).length} tracks ·{" "}
                  {backup.playlists.length} playlists
                </p>
                <button className="primary" onClick={() => restore("merge")}>
                  Merge library
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    confirm(
                      "Replace your likes, playlists and settings with this backup?",
                    ) && restore("replace")
                  }
                >
                  Replace library
                </button>
                <button className="text-button" onClick={() => setBackup(null)}>
                  Cancel
                </button>
              </div>
            )}
            <button
              className="danger"
              onClick={() =>
                run(async () => {
                  if (!confirm("Clear listening history and statistics?"))
                    return;
                  if (native)
                    await Audio.restoreEvents({
                      events: [],
                    });
                  update((l) => ({
                    ...l,
                    events: [],
                    recent: [],
                    legacyStats: null,
                  }));
                  localStorage.removeItem("svStats");
                  notify("Listening history cleared");
                })
              }
            >
              <Trash2 size={16} /> Clear listening history
            </button>
          </div>
        </Section>
      </div>
      <div className="about-block">
        <div className="brand-mark">v</div>
        <h3>Vibex</h3>
        <small>2.0-test5 · Notification player fix</small>
        <p>
          Music for your every mood.
          <br />
          Independent. Local-first. Powered by JioSaavn.
        </p>
        <small>
          Native playback and offline features require Android. Add the Vibex
          player widget from your home screen’s widget picker.
        </small>
        <p className="creator-credit">
          Made with ❤️ by <strong>VISWESHSARAVAN</strong>
        </p>
      </div>
    </>
  );
}
