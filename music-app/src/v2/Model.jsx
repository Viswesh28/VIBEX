import { startVisiblePolling } from "./performance.js";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { Audio, native } from "./native.js";
import { BrowserPlayer } from "./browser-player.js";
import { loadLibrary, writeDocument } from "./storage.js";
import { api } from "../lib/api.js";
import { artistsOf } from "../lib/song.js";
import { uniqueSongs, appendEvents, rankDiscovery } from "./core.js";
const Ctx = createContext(null);
const Progress = createContext(null);
export const usePlayback = () => useContext(Progress);
export const useVibe = () => useContext(Ctx);
const blank = {
  queue: [],
  index: 0,
  position: 0,
  duration: 0,
  playing: false,
  hydrated: false,
  returnToPlayer: "",
};
export function VibeProvider({ children }) {
  const [library, setLibrary] = useState(null),
    [fatal, setFatal] = useState(""),
    [state, setState] = useState(blank),
    [offline, setOffline] = useState({
      downloads: [],
    }),
    [toast, setToast] = useState(""),
    [events, setEvents] = useState([]);
  const lib = useRef(null),
    browser = useRef(null),
    eventBuffer = useRef([]),
    mounted = useRef(false),
    toastTimer = useRef(),
    currentRef = useRef(null),
    latest = useRef(blank),
    queueJSON = useRef("");
  const acceptSnapshot = useCallback((s) => {
    const prev = latest.current;
    if (
      native &&
      prev.epoch === s.epoch &&
      prev.snapshotSerial > s.snapshotSerial
    )
      return;
    let queue = prev.queue;
    if (s.queue && s.queue !== prev.queue) {
      const raw = JSON.stringify(s.queue);
      if (raw !== queueJSON.current) {
        queueJSON.current = raw;
        queue = s.queue;
      }
    }
    const next = {
      ...s,
      queue,
      hydrated: true,
      returnToPlayer: s.returnToPlayer || prev.returnToPlayer || "",
    };
    latest.current = next;
    // Version tokens need not cause a UI update by themselves.
    const keys = [
      "queue",
      "index",
      "position",
      "duration",
      "playing",
      "buffering",
      "error",
      "sleepUntil",
      "eqAvailable",
      "autoplayMessage",
      "hydrated",
      "returnToPlayer",
    ];
    if (keys.some((key) => next[key] !== prev[key])) setState(next);
  }, []);
  const notify = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  const update = useCallback(
    (fn) =>
      setLibrary((prev) => {
        if (!prev) return prev;
        const next = typeof fn === "function" ? fn(prev) : fn;
        lib.current = next;
        return next;
      }),
    [],
  );
  useEffect(() => {
    let alive = true;
    loadLibrary()
      .then((d) => {
        if (alive) {
          lib.current = d;
          setLibrary(d);
          setEvents(d.events || []);
        }
      })
      .catch((e) =>
        setFatal(
          `Could not open your library: ${e.message}. Your old data has not been deleted.`,
        ),
      );
    return () => {
      alive = false;
    };
  }, []);
  const flushBrowserEvents = useCallback(() => {
    const buffered = eventBuffer.current.splice(0);
    if (buffered.length)
      update((l) => ({ ...l, events: appendEvents(l.events, buffered) }));
  }, [update]);
  const ready = !!library;
  useEffect(() => {
    if (!ready) return;
    mounted.current = true;
    let alive = true,
      timer,
      stopPlayerPoll,
      stopLibraryPoll,
      stopEventsPoll,
      subscription,
      downloadSubscription;
    const accept = (s) => {
      if (alive) acceptSnapshot(s);
    };
    const refresh = async () => {
      try {
        accept(
          await Audio.snapshot({ queueToken: latest.current.queueToken || "" }),
        );
      } catch (e) {
        if (alive) notify(e.message);
      }
    };
    if (native) {
      Audio.addListener("playerState", (s) => {
        if (!alive || document.hidden) return;
        const wasPlaying = latest.current.playing;
        accept(s);
        if (!wasPlaying && s.playing) stopPlayerPoll?.refresh();
      }).then((handle) => {
        if (alive) subscription = handle;
        else handle.remove();
      });
      stopPlayerPoll = startVisiblePolling(refresh, {
        interval: () =>
          latest.current.playing || latest.current.buffering
            ? lib.current.settings.batterySaver
              ? 2000
              : 1000
            : null,
      });
      Audio.addListener("downloadsChanged", () => {
        if (alive && !document.hidden) stopLibraryPoll?.refresh();
      }).then((handle) => {
        if (alive) downloadSubscription = handle;
        else handle.remove();
      });
      let previousDownloads = "",
        revision = "",
        activeDownloads = false;
      stopLibraryPoll = startVisiblePolling(
        async () => {
          try {
            const d = await Audio.downloads();
            if (!alive) return;
            activeDownloads = d.downloads.some((item) =>
              [0, 2, 5, 7].includes(item.state),
            );
            const ds = JSON.stringify(d);
            if (ds !== previousDownloads) {
              previousDownloads = ds;
              setOffline(d);
            }
          } catch {}
        },
        {
          interval: () =>
            activeDownloads
              ? lib.current.settings.batterySaver
                ? 8000
                : 4000
              : 30000,
        },
      );
      stopEventsPoll = startVisiblePolling(
        async () => {
          try {
            const e = await Audio.events({ revision });
            if (alive) {
              revision = e.revision;
              if (e.events) setEvents(e.events);
            }
          } catch {}
        },
        { interval: 30000 },
      );
    } else {
      browser.current = new BrowserPlayer(
        accept,
        (e) => {
          eventBuffer.current.push(e);
          if (!timer)
            timer = setTimeout(() => {
              timer = null;
              flushBrowserEvents();
            }, 30000);
        },
        lib.current.session,
      );
      browser.current.configure(lib.current.settings);
    }
    return () => {
      alive = false;
      mounted.current = false;
      clearInterval(timer);
      stopEventsPoll?.();
      subscription?.remove();
      downloadSubscription?.remove();
      stopPlayerPoll?.();
      stopLibraryPoll?.();
      browser.current?.destroy();
      browser.current = null;
    };
  }, [ready, notify, update, acceptSnapshot]);
  useEffect(() => {
    if (!library) return;
    // Persist user edits immediately. A debounce loses rapid edits on reload/app dismissal.
    writeDocument("library", library).catch((e) =>
      notify(`Storage error: ${e.message}. Please export a backup.`),
    );
  }, [library, notify]);
  useEffect(() => {
    if (!library) return;
    document.documentElement.dataset.theme = library.settings.theme;
    document.documentElement.dataset.saver = String(
      library.settings.batterySaver,
    );
    if (native)
      Audio.settings({
        settings: library.settings,
      }).catch((e) => notify(e.message));
    else browser.current?.configure(library.settings);
  }, [library?.settings, notify]);
  useEffect(() => {
    const visibility = () => {
      document.documentElement.dataset.hidden = String(document.hidden);
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    if (!ready || native) return;
    let saved = "";
    const save = () => {
      flushBrowserEvents();
      const s = browser.current?.snapshot();
      if (!s) return;
      const session = { queue: s.queue, index: s.index, position: s.position };
      const value = JSON.stringify(session);
      if (value === saved) return;
      saved = value;
      update((l) => ({ ...l, session }));
    };
    const stop = startVisiblePolling(save, {
      interval: () => (lib.current.settings.batterySaver ? 30000 : 15000),
    });
    const hide = () => {
      if (document.hidden) save();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", save);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", save);
    };
  }, [ready, update]);
  useEffect(() => {
    if (native || !ready) return;
    if (!state.playing) flushBrowserEvents();
    const s = browser.current?.snapshot();
    if (s)
      update((l) => ({
        ...l,
        session: { queue: s.queue, index: s.index, position: s.position },
      }));
  }, [ready, state.queue, state.index, state.playing, update]);
  const current = state.queue[state.index] || null;
  useEffect(() => {
    if (!current || currentRef.current === current.id) return;
    currentRef.current = current.id;
    update((l) => ({
      ...l,
      songs: {
        ...l.songs,
        [current.id]: current,
      },
      recent: [current.id, ...l.recent.filter((id) => id !== current.id)].slice(
        0,
        100,
      ),
    }));
  }, [current?.id, update]);
  const run = async (task) => {
    try {
      return await task();
    } catch (e) {
      notify(e.message || "Something went wrong. Please retry.");
    }
  };
  const command = (action, args = {}) =>
    run(async () => {
      if (native)
        acceptSnapshot(
          await Audio.command({
            action,
            ...args,
          }),
        );
      else {
        const p = browser.current;
        if (!p) return;
        if (action === "select") await p.load(args.index);
        else if (action === "seek") p.seek(args.position);
        else if (action === "move") p.move(args.from, args.to);
        else if (action === "remove") p.remove(args.index);
        else if (action === "sleep") {
          p.setSleep(args.minutes);
        } else await p[action]?.();
      }
    });
  const remember = (songs) =>
    update((l) => ({
      ...l,
      songs: {
        ...l.songs,
        ...Object.fromEntries(songs.map((s) => [s.id, s])),
      },
    }));
  const playList = (songs, index = 0) =>
    run(async () => {
      if (!songs.length) return;
      remember(songs);
      if (native) {
        await Audio.requestPermissions({
          permissions: ["notifications"],
        }).catch(() => {});
        acceptSnapshot(
          await Audio.setQueue({
            songs,
            index,
            play: true,
          }),
        );
      } else await browser.current.setQueue(songs, index, true);
    });
  const enqueue = (song, next = false) =>
    run(async () => {
      remember([song]);
      if (native)
        acceptSnapshot(
          await Audio.enqueue({
            song,
            next,
          }),
        );
      else browser.current.enqueue(song, next);
      notify(next ? "Playing next" : "Added to queue");
    });
  const download = (song) =>
    run(async () => {
      if (!native) {
        notify(
          "Managed offline downloads are available in the Android app. Use Export audio for a browser download.",
        );
        return;
      }
      remember([song]);
      await Audio.requestPermissions({
        permissions: ["notifications"],
      }).catch(() => {});
      await Audio.download({
        song,
      });
      setOffline(await Audio.downloads());
      notify("Added to downloads");
    });
  const downloadAll = async (songs) => {
    if (!native) {
      notify("Offline downloads require the Android app.");
      return;
    }
    remember(songs);
    await Audio.requestPermissions({
      permissions: ["notifications"],
    }).catch(() => {});
    let n = 0;
    for (const song of uniqueSongs(songs).filter((s) => !s.local)) {
      try {
        await Audio.download({
          song,
        });
        n++;
      } catch (e) {
        notify(e.message);
        break;
      }
    }
    setOffline(await Audio.downloads());
    notify(`${n} tracks queued for download`);
  };
  const pickLocal = () =>
    run(async () => {
      if (!native) {
        notify("Choose audio files using the Local files import button.");
        return;
      }
      const { songs, skipped = 0 } = await Audio.pickAudio();
      remember(songs);
      notify(
        `${songs.length} local tracks imported${skipped ? `; ${skipped} files could not be read` : ""}`,
      );
    });
  const radio = (song) =>
    run(async () => {
      notify("Finding your next favorites…");
      const q = artistsOf(song).split(",")[0];
      const d = await api(
        `/search/songs?query=${encodeURIComponent(q)}&limit=30`,
      );
      const fresh = rankDiscovery(d.results || [], lib.current).filter(
        (s) =>
          s.id !== song.id && !lib.current.recent.slice(0, 8).includes(s.id),
      );
      const songs = uniqueSongs([song, ...fresh]);
      await playList(songs);
      notify(
        fresh.length
          ? "Artist radio started"
          : "No new related tracks found. Playing your seed track.",
      );
    });
  const structuralState = useMemo(
    () => ({ ...state, position: 0, duration: 0 }),
    [
      state.queue,
      state.index,
      state.playing,
      state.buffering,
      state.error,
      state.sleepUntil,
      state.eqAvailable,
      state.autoplayMessage,
      state.hydrated,
      state.returnToPlayer,
    ],
  );
  // Commands below read live refs or use functional updates. Progress-only changes intentionally
  // do not replace this context; only the mini player / full player / lyrics subscribe to Progress.
  const contextValue = useMemo(
    () => ({
      library,
      update,
      settings: library?.settings,
      setSetting: (key, value) =>
        update((l) => ({
          ...l,
          settings: {
            ...l.settings,
            [key]: value,
          },
        })),
      state: structuralState,
      current,
      offline,
      events: native ? events : library?.events,
      notify,
      toast,
      command,
      playList,
      enqueue,
      download,
      downloadAll,
      pickLocal,
      radio,
      remember,
      native,
      run,
      setOffline,
    }),
    [library, structuralState, offline, events, toast, notify, update],
  );
  if (fatal)
    return (
      <div className="boot">
        <h1>Your library is safe.</h1>
        <p>{fatal}</p>
        <button onClick={() => location.reload()}>Retry</button>
      </div>
    );
  if (!library)
    return (
      <div className="boot">
        <div className="brand-mark">v</div>
        <h1>Vibex</h1>
        <p>Making room for your music…</p>
      </div>
    );
  return (
    <Progress.Provider value={state}>
      <Ctx.Provider value={contextValue}>{children}</Ctx.Provider>
    </Progress.Provider>
  );
}
