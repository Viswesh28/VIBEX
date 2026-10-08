import { useEffect, useRef, useState } from "react";
import {
  Home,
  Leaf,
  Search,
  Library,
  Download,
  Settings,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Heart,
  MoreHorizontal,
  Plus,
  ArrowLeft,
  ListMusic,
  Mic2,
  Headphones,
  CheckCircle2,
  BarChart3,
} from "lucide-react";
import { VibeProvider, useVibe, usePlayback } from "./Model.jsx";
import { createPlayerReturnGate } from "./player-return.js";
import { native } from "./native.js";
import { artistsOf } from "../lib/song.js";
import { decodeHtml, fmt } from "../lib/format.js";
import { onBackButton } from "../lib/native.js";
import "./theme.css";
import { IconButton, Cover } from "./ui.jsx";
import { HomeView } from "./HomeView.jsx";
import { SearchView } from "./SearchView.jsx";
import { DetailView } from "./DetailView.jsx";
import { LibraryView } from "./LibraryView.jsx";
import { DownloadsView } from "./DownloadsView.jsx";
import { StatsView } from "./StatsView.jsx";
import { SettingsView } from "./SettingsView.jsx";
import { Player, Queue } from "./Player.jsx";
import { PlaylistSheet, SongSheet } from "./Dialogs.jsx";
const text = decodeHtml;
function Shell() {
  const { library, state, current, command, toast, notify } = useVibe(),
    [view, setView] = useState({
      kind: "home",
    }),
    [history, setHistory] = useState([]),
    [mood, setMood] = useState("All"),
    [menu, setMenu] = useState(null),
    [playlist, setPlaylist] = useState(null),
    [full, setFull] = useState(false),
    [tab, setTab] = useState("queue");
  const main = useRef(),
    backRef = useRef(),
    transport = useRef(),
    returnGate = useRef(createPlayerReturnGate());
  useEffect(() => {
    const open = () => {
      if (
        returnGate.current.consume({
          token: state.returnToPlayer,
          ready: state.hydrated,
          visible: !document.hidden,
          current,
          blocked: !!menu || !!playlist,
        })
      ) {
        setMenu(null);
        setPlaylist(null);
        setFull(true);
      }
    };
    open();
    document.addEventListener("visibilitychange", open);
    return () => document.removeEventListener("visibilitychange", open);
  }, [state.returnToPlayer, state.hydrated, current, menu, playlist]);
  const navigate = (next) => {
    if (next.kind === "player") {
      setFull(true);
      return;
    }
    setHistory((h) => [...h, view].slice(-20));
    setView(next);
    main.current?.scrollTo(0, 0);
  };
  const back = () => {
    if (menu) setMenu(null);
    else if (playlist) setPlaylist(null);
    else if (full) setFull(false);
    else if (history.length) {
      setView(history.at(-1));
      setHistory((h) => h.slice(0, -1));
    } else return false;
    return true;
  };
  backRef.current = back;
  transport.current = { command, playing: state.playing };
  useEffect(() => {
    let off = () => {},
      alive = true;
    onBackButton(() => backRef.current()).then((fn) => {
      if (alive) off = fn;
      else fn();
    });
    const key = (e) => {
      if (e.key === "Escape") backRef.current();
      if (
        e.code === "Space" &&
        !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(e.target.tagName)
      ) {
        e.preventDefault();
        transport.current.command(transport.current.playing ? "pause" : "play");
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      alive = false;
      off();
      document.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    const listener = () =>
      notify(
        navigator.onLine
          ? "Back online. Your music is waiting."
          : "You’re offline. Downloaded and local tracks are still available.",
      );
    addEventListener("online", listener);
    addEventListener("offline", listener);
    return () => {
      removeEventListener("online", listener);
      removeEventListener("offline", listener);
    };
  }, []);
  const nav = [
    ["home", Home, "Home"],
    ["search", Search, "Search"],
    ["library", Library, "Library"],
    ["downloads", Download, "Downloads"],
  ];
  const topTitle = {
    home: "Discover your sound",
    search: "Find your next favorite",
    library: "Made by you",
    downloads: "Always with you",
    stats: "Your listening story",
    settings: "A little more you",
    detail: "Explore the collection",
  }[view.kind];
  return (
    <div className="vibe-app">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() =>
            navigate({
              kind: "home",
            })
          }
        >
          <span className="brand-mark">v</span>
          <span>
            Vibex<span className="brand-dot">.</span>
          </span>
        </button>
        <span className="nav-caption">YOUR DAILY ESCAPE</span>
        <nav>
          {nav.map(([id, Icon, label]) => (
            <button
              className={view.kind === id ? "selected" : ""}
              key={id}
              onClick={() =>
                navigate({
                  kind: id,
                })
              }
            >
              <Icon size={21} />
              {label}
              {id === "downloads" && <span className="nav-dot" />}
            </button>
          ))}
          <button
            className={view.kind === "stats" ? "selected" : ""}
            onClick={() =>
              navigate({
                kind: "stats",
              })
            }
          >
            <BarChart3 size={21} /> Listening insights
          </button>
        </nav>
        <div className="sidebar-playlists">
          <div>
            <span>YOUR PLAYLISTS</span>
            <IconButton
              icon={Plus}
              label="Create playlist"
              onClick={() =>
                setPlaylist({
                  song: null,
                })
              }
            />
          </div>
          <button
            onClick={() =>
              navigate({
                kind: "library",
                filter: "liked",
              })
            }
          >
            <span className="liked-small">
              <Heart size={15} fill="currentColor" />
            </span>{" "}
            Liked songs <small>{library.liked.length}</small>
          </button>
          {library.playlists.slice(0, 5).map((p) => (
            <button
              key={p.id}
              onClick={() =>
                navigate({
                  kind: "library",
                  id: p.id,
                })
              }
            >
              <ListMusic size={18} />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="offline-note">
            <div>
              <Headphones size={23} />
              <span>
                Music for your
                <br />
                <strong>every mood.</strong>
              </span>
            </div>
            <p>No account. Just your favorites.</p>
          </div>
          <button
            className={view.kind === "settings" ? "selected" : ""}
            onClick={() =>
              navigate({
                kind: "settings",
              })
            }
          >
            <Settings size={20} /> Settings & preferences
          </button>
        </div>
      </aside>
      <main ref={main} className="main-scroll">
        <header className="topbar">
          <div className="topbar-left">
            {view.kind === "home" ? (
              <span className="desktop-only">{topTitle}</span>
            ) : (
              <IconButton
                icon={ArrowLeft}
                label="Go back"
                onClick={() =>
                  history.length
                    ? back()
                    : setView({
                        kind: "home",
                      })
                }
              />
            )}
            <button
              className="brand mobile-only"
              onClick={() =>
                navigate({
                  kind: "home",
                })
              }
            >
              <span className="brand-mark small">v</span>Vibex
              <span className="brand-dot">.</span>
            </button>
          </div>
          <div className="topbar-actions">
            {library.settings.batterySaver && (
              <IconButton
                icon={Leaf}
                label="Battery Saver is on"
                active
                onClick={() => navigate({ kind: "settings" })}
              />
            )}
            <button
              className="top-search desktop-only"
              onClick={() =>
                navigate({
                  kind: "search",
                })
              }
            >
              <Search size={17} />
              <span>Search your next favorite</span>
              <kbd>/</kbd>
            </button>
            <IconButton
              icon={BarChart3}
              label="Listening insights"
              onClick={() =>
                navigate({
                  kind: "stats",
                })
              }
            />
            <IconButton
              icon={Settings}
              label="Settings"
              onClick={() =>
                navigate({
                  kind: "settings",
                })
              }
            />
          </div>
        </header>
        <div
          className="page-content"
          key={view.kind + (view.id || "") + (view.filter || "")}
        >
          {view.kind === "home" ? (
            <HomeView
              onMenu={setMenu}
              onNavigate={navigate}
              mood={mood}
              setMood={setMood}
            />
          ) : view.kind === "search" ? (
            <SearchView onMenu={setMenu} onNavigate={navigate} />
          ) : view.kind === "library" ? (
            <LibraryView
              view={view}
              onMenu={setMenu}
              onNavigate={navigate}
              onNewPlaylist={() =>
                setPlaylist({
                  song: null,
                })
              }
            />
          ) : view.kind === "downloads" ? (
            <DownloadsView onMenu={setMenu} />
          ) : view.kind === "stats" ? (
            <StatsView />
          ) : view.kind === "settings" ? (
            <SettingsView />
          ) : (
            <DetailView view={view} onMenu={setMenu} />
          )}
        </div>
      </main>
      <aside className="right-panel">
        <div className="right-heading">
          <span>ON YOUR RADAR</span>
          <IconButton
            icon={MoreHorizontal}
            label="Open player"
            onClick={() => setFull(true)}
          />
        </div>
        <Cover song={current} className="right-art" />
        <span className="eyebrow">
          {current ? "NOW PLAYING" : "YOUR NEXT MOMENT"}
        </span>
        <h3>{text(current?.name || "Let the day find its rhythm.")}</h3>
        <p>
          {current
            ? text(artistsOf(current))
            : "A favorite song is always a good place to start."}
        </p>
        <button
          className="secondary wide"
          onClick={() =>
            current
              ? setFull(true)
              : navigate({
                  kind: "search",
                })
          }
        >
          {current ? <ListMusic size={17} /> : <Search size={17} />}{" "}
          {current ? "Open your player" : "Find your soundtrack"}
        </button>
        <div className="right-divider" />
        <Queue onMenu={setMenu} />
      </aside>
      <MiniPlayer setFull={setFull} setTab={setTab} />
      <nav className="bottom-nav" aria-label="Main navigation">
        {nav.map(([id, Icon, label]) => (
          <button
            aria-current={view.kind === id ? "page" : undefined}
            className={view.kind === id ? "selected" : ""}
            key={id}
            onClick={() =>
              navigate({
                kind: id,
              })
            }
          >
            <span>
              <Icon size={21} />
            </span>
            {label}
          </button>
        ))}
      </nav>
      {full && (
        <Player
          tab={tab}
          setTab={setTab}
          onClose={() => setFull(false)}
          onMenu={setMenu}
        />
      )}
      {menu && (
        <SongSheet
          song={menu}
          onClose={() => setMenu(null)}
          onPlaylist={(song) => {
            setMenu(null);
            setPlaylist({
              song,
            });
          }}
        />
      )}
      {playlist && (
        <PlaylistSheet song={playlist.song} onClose={() => setPlaylist(null)} />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
function MiniPlayer({ setFull, setTab }) {
  const { current, command, settings } = useVibe();
  const state = usePlayback();
  return (
    <div className={`mini-player ${current ? "has-track" : ""}`}>
      <button className="mini-info" onClick={() => setFull(true)}>
        <Cover song={current} />
        <span>
          <strong>
            {text(current?.name || "Your soundtrack starts here")}
          </strong>
          <small>
            {current ? text(artistsOf(current)) : "Find a song and press play"}
          </small>
        </span>
      </button>
      <div className="mini-controls">
        <IconButton
          icon={SkipBack}
          label="Previous track"
          onClick={() => command("previous")}
          disabled={!current}
        />
        <button
          className="mini-play"
          aria-label={state.playing ? "Pause" : "Play"}
          onClick={() =>
            command(state.playing || state.buffering ? "pause" : "play")
          }
          disabled={!current}
        >
          {state.playing || state.buffering ? (
            <Pause size={20} fill="currentColor" />
          ) : (
            <Play size={20} fill="currentColor" />
          )}
        </button>
        <IconButton
          icon={SkipForward}
          label="Next track"
          onClick={() => command("next")}
          disabled={!current}
        />
      </div>
      <div className="mini-timeline">
        <span>{fmt(state.position)}</span>
        <input
          type="range"
          aria-label="Seek in current track"
          min="0"
          max={state.duration || 1}
          value={Math.min(state.position, state.duration || 1)}
          onChange={(e) =>
            command("seek", {
              position: +e.target.value,
            })
          }
        />
        <span>{fmt(state.duration)}</span>
      </div>
      <div className="mini-extra">
        <IconButton
          icon={Mic2}
          label="Open lyrics"
          onClick={() => {
            setTab("lyrics");
            setFull(true);
          }}
        />
        <IconButton
          icon={ListMusic}
          label="Open queue"
          onClick={() => {
            setTab("queue");
            setFull(true);
          }}
        />
        <span className="quality-pill">
          {settings.batterySaver
            ? "BATTERY SAVER"
            : native
              ? "NATIVE AUDIO"
              : "WEB PLAYER"}
        </span>
      </div>
      <div
        className="mini-progress"
        style={{
          width: `${state.duration ? (state.position / state.duration) * 100 : 0}%`,
        }}
      />
    </div>
  );
}
export default function App() {
  return (
    <VibeProvider>
      <Shell />
    </VibeProvider>
  );
}
