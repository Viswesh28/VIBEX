import { createHomeCache } from "./home-cache.js";
import { readDocument, writeDocument } from "./storage.js";
import { createCatalogCache } from "./performance.js";
import { downloadBadge } from "./core.js";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Heart,
  MoreHorizontal,
  X,
  ArrowUp,
  ArrowDown,
  ListMusic,
  Music2,
  Trash2,
  FolderOpen,
  Disc3,
  CloudOff,
  RefreshCw,
  CheckSquare,
} from "lucide-react";
import { useVibe } from "./Model.jsx";
import { native, cachedArtwork } from "./native.js";
import { api } from "../lib/api.js";
import { artistsOf, imgOf } from "../lib/song.js";
import { decodeHtml, fmt } from "../lib/format.js";
const text = decodeHtml;
export function IconButton({
  icon: Icon,
  label,
  onClick,
  active,
  children,
  ...props
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      {...props}
    >
      {Icon && <Icon size={21} />} {children}
    </button>
  );
}
export const Cover = memo(function Cover({ song, className = "" }) {
  const [bad, setBad] = useState(false),
    [src, setSrc] = useState(native ? "" : imgOf(song)),
    element = useRef(),
    original = imgOf(song);
  useEffect(() => {
    let alive = true,
      started = false;
    setBad(false);
    setSrc(native ? "" : original);
    if (!native || !original) return;
    const load = () => {
      if (started || document.hidden) return;
      started = true;
      cachedArtwork(original).then((url) => {
        if (alive) {
          setSrc(url);
          setBad(false);
        }
      });
    };
    let inView = false;
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              inView = entries.some((entry) => entry.isIntersecting);
              if (inView) load();
            },
            { rootMargin: "80px" },
          )
        : null;
    const visible = () => {
      if (inView || !observer) load();
    };
    if (observer && element.current) observer.observe(element.current);
    else load();
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [original]);
  return (
    <div ref={element} className={`cover ${className}`}>
      {src && !bad ? (
        <img src={src} alt="" loading="lazy" onError={() => setBad(true)} />
      ) : (
        <Disc3 aria-hidden="true" />
      )}
    </div>
  );
});
const catalog = createCatalogCache(api);
export const homeCache = createHomeCache(api, {
  read: () => readDocument("home-catalog-v1"),
  write: (data) => writeDocument("home-catalog-v1", data),
  online: () => navigator.onLine,
});
export function useRemote(path, { persistent = false } = {}) {
  const { settings } = useVibe();
  const [result, setResult] = useState({
      path: null,
      data: null,
      error: "",
      loading: false,
    }),
    [retry, setRetry] = useState(0);
  const force = useRef(false);
  const cached = path && !persistent ? catalog.peek(path) : undefined;
  useEffect(() => {
    if (!path) {
      setResult({ path: null, data: null, error: "", loading: false });
      return;
    }
    let alive = true;
    const refresh = force.current;
    force.current = false;
    const hit = persistent ? undefined : catalog.peek(path);
    if (hit !== undefined && !refresh) {
      setResult({ path, data: hit, error: "", loading: false });
      return;
    }
    setResult({ path, data: null, error: "", loading: true });
    const timer = setTimeout(
      () =>
        (persistent
          ? homeCache.get(path, { refresh, saver: settings.batterySaver })
          : catalog.get(path, { refresh }).then((data) => ({ data }))
        )
          .then((result) => {
            if (alive)
              setResult({ path, ...result, error: "", loading: false });
          })
          .catch((e) => {
            if (alive)
              setResult({ path, data: null, error: e.message, loading: false });
          }),
      250,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [path, retry, persistent, settings.batterySaver]);
  const shown =
    result.path === path
      ? result
      : {
          data: cached ?? null,
          error: "",
          loading: !!path && cached === undefined,
        };
  return {
    ...shown,
    retry: () => {
      force.current = true;
      setRetry((n) => n + 1);
    },
  };
}
export function Empty({ icon: Icon = Music2, title, description, children }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={30} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="skeleton-list" role="status" aria-label="Loading music">
      {[0, 1, 2, 3].map((x) => (
        <div key={x}>
          <i />
          <span />
          <b />
        </div>
      ))}
    </div>
  );
}
export function Failure({ remote }) {
  return (
    <Empty
      icon={CloudOff}
      title="A little quiet right now"
      description={remote.error}
    >
      <button className="primary" onClick={remote.retry}>
        <RefreshCw size={16} /> Try again
      </button>
    </Empty>
  );
}
export function Section({ eyebrow, title, children, action }) {
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function TrackList({
  songs,
  onMenu,
  numbered = false,
  playlist = null,
  onPlay,
}) {
  const {
      current,
      state,
      playList,
      library,
      update,
      downloadAll,
      offline,
      enqueue,
      notify,
    } = useVibe(),
    [selected, setSelected] = useState([]),
    [selecting, setSelecting] = useState(false);
  const downloads = useMemo(
    () => new Map(offline.downloads.map((d) => [d.id, d])),
    [offline.downloads],
  );
  const ids = selected
    .map((id) => songs.find((s) => s.id === id))
    .filter(Boolean);
  const like = (s) =>
    update((l) => ({
      ...l,
      songs: {
        ...l.songs,
        [s.id]: s,
      },
      liked: l.liked.includes(s.id)
        ? l.liked.filter((id) => id !== s.id)
        : [s.id, ...l.liked],
    }));
  const removeSelected = () => {
    update((l) => ({
      ...l,
      playlists: l.playlists.map((p) =>
        p.id === playlist
          ? {
              ...p,
              ids: p.ids.filter((id) => !selected.includes(id)),
            }
          : p,
      ),
    }));
    setSelected([]);
    notify("Selected tracks removed");
  };
  const reorder = (index, delta) =>
    update((l) => ({
      ...l,
      playlists: l.playlists.map((p) => {
        if (p.id !== playlist) return p;
        const ids = [...p.ids],
          j = index + delta;
        if (j < 0 || j >= ids.length) return p;
        [ids[index], ids[j]] = [ids[j], ids[index]];
        return {
          ...p,
          ids,
        };
      }),
    }));
  if (!songs.length)
    return (
      <Empty
        title="Nothing here yet"
        description="Find something you love and make it yours."
      />
    );
  return (
    <>
      <div className="list-toolbar">
        <span>{songs.length} tracks</span>
        <button
          className="text-button"
          onClick={() => {
            setSelecting(!selecting);
            setSelected([]);
          }}
        >
          <CheckSquare size={16} />
          {selecting ? "Done" : "Select"}
        </button>
      </div>
      {selecting && (
        <div className="bulk-bar">
          <button
            onClick={() =>
              setSelected(
                selected.length === songs.length ? [] : songs.map((s) => s.id),
              )
            }
          >
            {selected.length === songs.length ? "Deselect" : "Select all"}
          </button>
          <span>{selected.length} selected</span>
          <button disabled={!ids.length} onClick={() => downloadAll(ids)}>
            <Download size={16} /> Download
          </button>
          <button
            disabled={!ids.length}
            onClick={() => {
              ids.forEach((s) => enqueue(s));
              setSelected([]);
            }}
          >
            <ListMusic size={16} /> Queue
          </button>
          {playlist && (
            <button disabled={!ids.length} onClick={removeSelected}>
              <Trash2 size={16} />
            </button>
          )}
        </div>
      )}
      <div className="tracks">
        {songs.map((s, i) => {
          const active = current?.id === s.id;
          const badge = downloadBadge(downloads.get(s.id));
          return (
            <div
              className={`track ${active ? "playing" : ""}`}
              key={`${s.id}-${i}`}
            >
              {selecting ? (
                <input
                  type="checkbox"
                  aria-label={`Select ${text(s.name)}`}
                  checked={selected.includes(s.id)}
                  onChange={() =>
                    setSelected((a) =>
                      a.includes(s.id)
                        ? a.filter((id) => id !== s.id)
                        : [...a, s.id],
                    )
                  }
                />
              ) : (
                numbered && (
                  <span className="track-number">
                    {active && state.playing ? (
                      <span className="equal-bars">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : (
                      String(i + 1).padStart(2, "0")
                    )}
                  </span>
                )
              )}
              <button
                className="track-main"
                onClick={() =>
                  selecting
                    ? setSelected((a) =>
                        a.includes(s.id)
                          ? a.filter((id) => id !== s.id)
                          : [...a, s.id],
                      )
                    : (onPlay?.(s), playList(songs, i))
                }
                aria-label={`Play ${text(s.name)}`}
              >
                <Cover song={s} />
                <span className="track-info">
                  <strong>{text(s.name)}</strong>
                  {badge && (
                    <span
                      className={`download-badge ${badge.ready ? "ready" : ""}`}
                    >
                      <Download size={11} />
                      {badge.text}
                    </span>
                  )}
                  <span>
                    {s.local && <FolderOpen size={11} />} {text(artistsOf(s))}
                  </span>
                </span>
              </button>
              <span className="track-album">
                {text(s.album?.name || "Single")}
              </span>
              <span className="track-duration">{fmt(s.duration)}</span>
              {playlist && (
                <div className="reorder">
                  <IconButton
                    icon={ArrowUp}
                    label="Move track up"
                    disabled={i === 0}
                    onClick={() => reorder(i, -1)}
                  />
                  <IconButton
                    icon={ArrowDown}
                    label="Move track down"
                    disabled={i === songs.length - 1}
                    onClick={() => reorder(i, 1)}
                  />
                </div>
              )}
              <IconButton
                icon={Heart}
                label={
                  library.liked.includes(s.id) ? "Unlike track" : "Like track"
                }
                active={library.liked.includes(s.id)}
                onClick={() => like(s)}
              />
              <IconButton
                icon={MoreHorizontal}
                label={`More options for ${text(s.name)}`}
                onClick={() => onMenu(s)}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
// Nested dialogs preserve previous inert states and return focus to their trigger.
export function useModal(ref) {
  useEffect(() => {
    const el = ref.current,
      previous = document.activeElement,
      changed = [];
    let node = el;
    while (node?.parentElement && node.parentElement !== document.body) {
      for (const sibling of node.parentElement.children)
        if (sibling !== node) {
          changed.push([sibling, sibling.inert]);
          sibling.inert = true;
        }
      node = node.parentElement;
    }
    const controls = () =>
      [
        ...el.querySelectorAll(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,[tabindex="0"]',
        ),
      ].filter((e) => e.getClientRects().length);
    controls()[0]?.focus();
    const key = (e) => {
      if (e.key !== "Tab") return;
      const buttons = controls(),
        first = buttons[0],
        last = buttons.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    el.addEventListener("keydown", key);
    return () => {
      el.removeEventListener("keydown", key);
      for (const [sibling, inert] of changed) sibling.inert = inert;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
}

export function Sheet({ children, title, onClose }) {
  const ref = useRef();
  useModal(ref);
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="sheet-heading">
          <h2>{title}</h2>
          <IconButton icon={X} label="Close dialog" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}
