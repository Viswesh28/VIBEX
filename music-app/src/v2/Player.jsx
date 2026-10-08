import { lyricOffsetFor, cacheLyrics } from "./core.js";
import { useModal } from "./ui.jsx";
import { useEffect, useRef, useState } from "react";
import {
  Download,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Heart,
  MoreHorizontal,
  X,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  ListMusic,
  Shuffle,
  Repeat,
  Repeat1,
  Mic2,
  Clock,
  Upload,
  RefreshCw,
} from "lucide-react";
import { useVibe, usePlayback } from "./Model.jsx";
import { artistsOf } from "../lib/song.js";
import { decodeHtml, fmt } from "../lib/format.js";
import { parseImportedLyrics } from "./core.js";
import { findLyrics } from "./lyrics.js";
import { IconButton, Cover, Empty, Loading } from "./ui.jsx";
const text = decodeHtml;
export function Queue({ onMenu }) {
  const { state, command } = useVibe();
  return (
    <>
      <div className="queue-heading">
        <div>
          <h3>Up next</h3>
          <span>{state.queue.length} tracks in your queue</span>
        </div>
        <button className="text-button" onClick={() => command("clear")}>
          Clear upcoming
        </button>
      </div>
      {state.autoplayMessage && (
        <p className="autoplay-note">{state.autoplayMessage}</p>
      )}
      {state.queue.length === 0 ? (
        <Empty
          icon={ListMusic}
          title="Your queue is open"
          description="Play a song to get started."
        />
      ) : (
        state.queue.map((s, i) => (
          <div
            className={`queue-track ${i === state.index ? "selected" : ""}`}
            key={`${s.id}-${i}`}
          >
            <button
              className="track-main"
              onClick={() =>
                command("select", {
                  index: i,
                })
              }
            >
              <Cover song={s} />
              <span className="track-info">
                <strong>{text(s.name)}</strong>
                <span>
                  {i === state.index ? "Now playing" : text(artistsOf(s))}
                </span>
              </span>
            </button>
            <IconButton
              icon={ArrowUp}
              label="Move up"
              disabled={i === 0}
              onClick={() =>
                command("move", {
                  from: i,
                  to: i - 1,
                })
              }
            />
            <IconButton
              icon={ArrowDown}
              label="Move down"
              disabled={i === state.queue.length - 1}
              onClick={() =>
                command("move", {
                  from: i,
                  to: i + 1,
                })
              }
            />
            <IconButton
              icon={X}
              label="Remove from queue"
              onClick={() =>
                command("remove", {
                  index: i,
                })
              }
            />
          </div>
        ))
      )}
    </>
  );
}
export function Lyrics() {
  const state = usePlayback();
  const { current, settings, library, update, command, notify, offline } =
      useVibe(),
    [result, setResult] = useState(null),
    [retry, setRetry] = useState(0),
    active = useRef(),
    input = useRef();
  const providers = settings.lyricsProviders.join(",");
  useEffect(() => {
    if (!current) return;
    const ctl = new AbortController();
    const manual = library.manualLyrics?.[current.id];
    if (manual && settings.lyricsProviders[0] === "local") {
      setResult(manual);
      return;
    }
    const cached = library.lyrics[current.id];
    if (cached && cached.providers === providers && !retry) {
      setResult(cached);
      return;
    }
    setResult({
      type: "loading",
    });
    findLyrics(current, settings.lyricsProviders, ctl.signal, manual)
      .then((r) => {
        if (ctl.signal.aborted) return;
        setResult(r);
        if (["synced", "plain", "instrumental"].includes(r.type))
          update((l) => ({
            ...l,
            lyrics: cacheLyrics(
              l.lyrics,
              current.id,
              { ...r, providers },
              offline.downloads.filter((d) => d.state === 3).map((d) => d.id),
            ),
          }));
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [current?.id, providers, retry, library.manualLyrics?.[current?.id]]);
  const offset = lyricOffsetFor(library, current?.id);
  let line = -1;
  if (result?.lines)
    for (let i = 0; i < result.lines.length; i++) {
      if (result.lines[i].t <= state.position + offset) line = i;
      else break;
    }
  useEffect(() => {
    active.current?.scrollIntoView({
      block: "center",
      behavior:
        settings.batterySaver ||
        document.hidden ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
    });
  }, [line]);
  if (!current)
    return (
      <Empty
        icon={Mic2}
        title="Lyrics live here"
        description="Pick a song to follow along."
      />
    );
  return (
    <div className="lyrics-body">
      <div className="track-timing">
        <label htmlFor="track-offset">
          This song’s timing{" "}
          <strong>
            {offset > 0 ? "+" : ""}
            {offset}s
          </strong>
        </label>
        <input
          id="track-offset"
          aria-label="This song’s lyric offset"
          type="range"
          min="-30"
          max="30"
          step="0.25"
          value={offset}
          onChange={(e) => {
            const value = +e.target.value;
            update((l) => ({
              ...l,
              lyricOffsets: { ...l.lyricOffsets, [current.id]: value },
            }));
          }}
        />
        <button
          className="text-button"
          onClick={() =>
            update((l) => {
              const offsets = { ...l.lyricOffsets };
              delete offsets[current.id];
              return { ...l, lyricOffsets: offsets };
            })
          }
        >
          Use global timing
        </button>
        <small>
          {Object.hasOwn(library.lyricOffsets || {}, current.id)
            ? "Saved for this recording"
            : "Using your global timing"}{" "}
          · Positive values show lyrics earlier
        </small>
      </div>
      <div className="lyrics-tools">
        <button className="text-button" onClick={() => input.current.click()}>
          <Upload size={14} /> Import LRC / text
        </button>
        {library.manualLyrics?.[current.id] && (
          <button
            className="text-button"
            onClick={() => {
              update((l) => {
                const manualLyrics = {
                  ...l.manualLyrics,
                };
                delete manualLyrics[current.id];
                return {
                  ...l,
                  manualLyrics,
                };
              });
              setRetry((n) => n + 1);
            }}
          >
            Remove imported lyrics
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept=".lrc,.txt,text/plain"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            e.target.value = "";
            if (f.size > 1024 * 1024) {
              notify("Lyric files must be smaller than 1 MB.");
              return;
            }
            const r = parseImportedLyrics(await f.text());
            update((l) => ({
              ...l,
              manualLyrics: {
                ...l.manualLyrics,
                [current.id]: r,
              },
              settings: {
                ...l.settings,
                lyricsProviders: [
                  "local",
                  ...l.settings.lyricsProviders.filter((p) => p !== "local"),
                ],
              },
            }));
            notify("Lyrics attached to this track");
          }}
        />
      </div>
      {result?.type === "loading" ? (
        <Loading />
      ) : result?.type === "synced" ? (
        <>
          <span className="eyebrow">
            TAP A LINE TO SEEK · {result.provider}
          </span>
          {result.lines.map((l, i) => (
            <button
              ref={line === i ? active : null}
              className={line === i ? "current-line" : ""}
              key={`${l.t}-${i}`}
              onClick={() =>
                command("seek", {
                  position: Math.max(0, l.t - offset),
                })
              }
            >
              {l.words
                ? l.words.map((w, j) => (
                    <span
                      key={j}
                      className={
                        state.position + offset >= w.t ? "word-lit" : ""
                      }
                    >
                      {w.text}
                    </span>
                  ))
                : l.text}
            </button>
          ))}
        </>
      ) : result?.type === "plain" ? (
        <>
          <span className="eyebrow">PLAIN LYRICS · {result.provider}</span>
          <p className="plain-lyrics">{result.text}</p>
        </>
      ) : (
        <Empty
          icon={Mic2}
          title={
            result?.type === "instrumental"
              ? "Let the music speak"
              : "No matching lyrics yet"
          }
          description={
            result?.type === "instrumental"
              ? "This recording is marked as instrumental."
              : "We won’t show lyrics from a different recording. Try again or check your enabled sources."
          }
        >
          <button className="secondary" onClick={() => setRetry((n) => n + 1)}>
            <RefreshCw size={15} /> Retry lyrics
          </button>
        </Empty>
      )}
    </div>
  );
}
export function Player({ onClose, onMenu, tab, setTab }) {
  const state = usePlayback();
  const { current, command, settings, setSetting, library, update, download } =
    useVibe();
  const touch = useRef(0),
    dialog = useRef();
  useModal(dialog);
  return (
    <div
      ref={dialog}
      className="player-page"
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
    >
      <div
        className="player-top"
        onTouchStart={(e) => (touch.current = e.touches[0].clientY)}
        onTouchEnd={(e) => {
          if (e.changedTouches[0].clientY - touch.current > 90) onClose();
        }}
      >
        <IconButton icon={ChevronDown} label="Close player" onClick={onClose} />
        <span>
          <small>YOUR MOMENT, YOUR MUSIC</small>
          <strong>Now playing</strong>
        </span>
        <IconButton
          icon={MoreHorizontal}
          label="Current track options"
          disabled={!current}
          onClick={() => onMenu(current)}
        />
      </div>
      <div className="player-layout">
        <div className="player-main">
          <Cover song={current} className="player-art" />
          <div className="player-title">
            <div>
              <h2>{text(current?.name || "Find your next favorite")}</h2>
              <p>
                {text(current ? artistsOf(current) : "Your queue is waiting")}
              </p>
            </div>
            <IconButton
              icon={Heart}
              label="Like current track"
              active={library.liked.includes(current?.id)}
              disabled={!current}
              onClick={() =>
                update((l) => ({
                  ...l,
                  liked: l.liked.includes(current.id)
                    ? l.liked.filter((id) => id !== current.id)
                    : [current.id, ...l.liked],
                }))
              }
            />
          </div>
          <input
            className="seek"
            aria-label="Playback position"
            type="range"
            min="0"
            max={state.duration || 1}
            step=".1"
            value={Math.min(state.position, state.duration || 1)}
            onChange={(e) =>
              command("seek", {
                position: +e.target.value,
              })
            }
          />
          <div className="time-row">
            <span>{fmt(state.position)}</span>
            <span>{fmt(state.duration)}</span>
          </div>
          <div className="transport">
            <IconButton
              icon={Shuffle}
              label="Shuffle"
              active={settings.shuffle}
              onClick={() => setSetting("shuffle", !settings.shuffle)}
            />
            <IconButton
              icon={SkipBack}
              label="Previous track"
              onClick={() => command("previous")}
              disabled={!current}
            />
            <button
              className="big-play"
              aria-label={state.playing ? "Pause" : "Play"}
              onClick={() =>
                command(state.playing || state.buffering ? "pause" : "play")
              }
              disabled={!current}
            >
              {state.playing || state.buffering ? (
                <Pause fill="currentColor" />
              ) : (
                <Play fill="currentColor" />
              )}
            </button>
            <IconButton
              icon={SkipForward}
              label="Next track"
              onClick={() => command("next")}
              disabled={!current}
            />
            <IconButton
              icon={settings.repeat === "one" ? Repeat1 : Repeat}
              label={`Repeat: ${settings.repeat}`}
              active={settings.repeat !== "off"}
              onClick={() =>
                setSetting(
                  "repeat",
                  settings.repeat === "off"
                    ? "all"
                    : settings.repeat === "all"
                      ? "one"
                      : "off",
                )
              }
            />
          </div>
          <div className="player-extras">
            <button
              onClick={() => download(current)}
              disabled={!current || current.local}
            >
              <Download size={18} />
              <span>Download</span>
            </button>
            <label>
              <Clock size={18} />
              <select
                aria-label="Sleep timer"
                value={
                  state.sleepUntil
                    ? Math.max(
                        1,
                        Math.ceil((state.sleepUntil - Date.now()) / 60000),
                      )
                    : 0
                }
                onChange={(e) =>
                  command("sleep", {
                    minutes: +e.target.value,
                  })
                }
              >
                <option value={0}>Sleep timer</option>
                {[15, 30, 45, 60].map((n) => (
                  <option key={n} value={n}>
                    {n} minutes
                  </option>
                ))}
                {state.sleepUntil &&
                  ![15, 30, 45, 60].includes(
                    Math.ceil((state.sleepUntil - Date.now()) / 60000),
                  ) && (
                    <option
                      value={Math.max(
                        1,
                        Math.ceil((state.sleepUntil - Date.now()) / 60000),
                      )}
                    >
                      {Math.max(
                        1,
                        Math.ceil((state.sleepUntil - Date.now()) / 60000),
                      )}{" "}
                      min left
                    </option>
                  )}
              </select>
            </label>
            <span className="quality-pill">
              {current?.local ? "LOCAL" : settings.quality}
            </span>
          </div>
          {state.error && (
            <p className="player-error" role="alert">
              {state.error}
            </p>
          )}
        </div>
        <div className="player-secondary">
          <div className="player-tabs">
            <button
              className={tab === "lyrics" ? "selected" : ""}
              onClick={() => setTab("lyrics")}
            >
              <Mic2 size={17} /> Lyrics
            </button>
            <button
              className={tab === "queue" ? "selected" : ""}
              onClick={() => setTab("queue")}
            >
              <ListMusic size={18} /> Queue
            </button>
          </div>
          <div className="player-tab-content">
            {tab === "lyrics" ? <Lyrics /> : <Queue onMenu={onMenu} />}
          </div>
        </div>
      </div>
    </div>
  );
}
