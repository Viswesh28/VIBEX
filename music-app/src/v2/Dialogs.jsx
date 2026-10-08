import { useState } from "react";
import {
  Download,
  SkipForward,
  Heart,
  Plus,
  ChevronRight,
  ListMusic,
  Radio,
  ExternalLink,
} from "lucide-react";
import { useVibe } from "./Model.jsx";
import { native } from "./native.js";
import { artistsOf, dlUrlFor } from "../lib/song.js";
import { decodeHtml } from "../lib/format.js";
import { Cover, Sheet } from "./ui.jsx";
const text = decodeHtml;
export function PlaylistSheet({ song, onClose }) {
  const { library, update, notify } = useVibe(),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  const create = () => {
    const n = name.trim();
    if (!n) return setError("Give your playlist a name.");
    if (library.playlists.some((p) => p.name.toLowerCase() === n.toLowerCase()))
      return setError("A playlist with that name already exists.");
    update((l) => ({
      ...l,
      songs: song
        ? {
            ...l.songs,
            [song.id]: song,
          }
        : l.songs,
      playlists: [
        {
          id: crypto.randomUUID(),
          name: n,
          ids: song ? [song.id] : [],
        },
        ...l.playlists,
      ],
    }));
    notify("Playlist created");
    onClose();
  };
  return (
    <Sheet
      title={song ? "Add to a playlist" : "Make it a playlist"}
      onClose={onClose}
    >
      {song &&
        library.playlists.map((p) => (
          <button
            className="playlist-pick"
            key={p.id}
            onClick={() => {
              if (p.ids.includes(song.id)) {
                notify("This song is already in that playlist");
                return;
              }
              update((l) => ({
                ...l,
                songs: {
                  ...l.songs,
                  [song.id]: song,
                },
                playlists: l.playlists.map((x) =>
                  x.id === p.id
                    ? {
                        ...x,
                        ids: [...x.ids, song.id],
                      }
                    : x,
                ),
              }));
              notify(`Added to ${p.name}`);
              onClose();
            }}
          >
            <ListMusic />
            <span>
              <strong>{p.name}</strong>
              <small>{p.ids.length} tracks</small>
            </span>
            <Plus size={18} />
          </button>
        ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label className="field-label">NEW PLAYLIST NAME</label>
        <div className="search-box">
          <input
            placeholder="Late nights, long drives…"
            maxLength={80}
            aria-label="New playlist name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="primary wide" type="submit">
          <Plus size={17} /> Create playlist
        </button>
      </form>
    </Sheet>
  );
}
export function SongSheet({ song, onClose, onPlaylist }) {
  const { enqueue, download, radio, library, update, notify, run, settings } =
    useVibe();
  return (
    <Sheet title="Make it your next favorite" onClose={onClose}>
      <div className="song-sheet-header">
        <Cover song={song} />
        <div>
          <h3>{text(song.name)}</h3>
          <p>{text(artistsOf(song))}</p>
        </div>
      </div>
      {[
        [SkipForward, "Play next", () => enqueue(song, true)],
        [ListMusic, "Add to queue", () => enqueue(song)],
        [Plus, "Add to playlist", () => onPlaylist(song)],
        [
          Heart,
          library.liked.includes(song.id)
            ? "Remove from liked songs"
            : "Add to liked songs",
          () =>
            update((l) => ({
              ...l,
              songs: {
                ...l.songs,
                [song.id]: song,
              },
              liked: l.liked.includes(song.id)
                ? l.liked.filter((id) => id !== song.id)
                : [song.id, ...l.liked],
            })),
        ],
        ...(!song.local
          ? [
              [Download, "Download for offline", () => download(song)],
              [Radio, "Start artist radio", () => radio(song)],
            ]
          : []),
      ].map(([Icon, label, fn]) => (
        <button
          className="menu-action"
          key={label}
          onClick={() => {
            fn();
            if (label !== "Add to playlist") onClose();
          }}
        >
          <Icon size={20} />
          {label}
          <ChevronRight size={16} />
        </button>
      ))}
      {!song.local && native && (
        <button
          className="menu-action"
          onClick={() =>
            run(async () => {
              onClose();
              const { downloadSongNative } = await import("../lib/download.js");
              const r = await downloadSongNative(
                song,
                settings.downloadQuality,
                (stage) => notify(stage),
              );
              notify(`Exported ${r.name} to Documents/VIBEX`);
            })
          }
        >
          <ExternalLink size={20} /> Export tagged audio{" "}
          <ChevronRight size={16} />
        </button>
      )}
      {!song.local && !native && (
        <a
          className="menu-action"
          href={dlUrlFor(song, "320kbps")}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={20} /> Export tagged audio{" "}
          <ChevronRight size={16} />
        </a>
      )}
    </Sheet>
  );
}
