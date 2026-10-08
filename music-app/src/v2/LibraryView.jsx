import { useRef, useState } from "react";
import {
  Search,
  Download,
  Play,
  Heart,
  Plus,
  Trash2,
  FolderOpen,
  Pin,
} from "lucide-react";
import { useVibe } from "./Model.jsx";
import { sortedPlaylists } from "./core.js";
import { native } from "./native.js";
import { artistsOf } from "../lib/song.js";
import { decodeHtml } from "../lib/format.js";
import { IconButton, Cover, TrackList } from "./ui.jsx";
const text = decodeHtml;
export function LibraryView({ view, onNavigate, onMenu, onNewPlaylist }) {
  const {
      library,
      settings,
      setSetting,
      update,
      playList,
      pickLocal,
      remember,
      notify,
      downloadAll,
    } = useVibe(),
    [filter, setFilter] = useState(view.filter || "all"),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("recent");
  const playlist = library.playlists.find((p) => p.id === view.id);
  let songs = playlist
    ? playlist.ids.map((id) => library.songs[id])
    : filter === "liked"
      ? library.liked.map((id) => library.songs[id])
      : filter === "local"
        ? Object.values(library.songs).filter((s) => s.local)
        : library.recent.map((id) => library.songs[id]);
  songs = songs
    .filter(Boolean)
    .filter((s) =>
      `${s.name} ${artistsOf(s)}`.toLowerCase().includes(query.toLowerCase()),
    );
  if (sort === "title")
    songs = [...songs].sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "artist")
    songs = [...songs].sort((a, b) => artistsOf(a).localeCompare(artistsOf(b)));
  const input = useRef();
  const importLocal = async (e) => {
    const tracks = Array.from(e.target.files || [])
      .filter((f) => f.type.startsWith("audio/"))
      .map((f) => ({
        id: `local:${crypto.randomUUID()}`,
        name: f.name.replace(/\.[^.]+$/, ""),
        subtitle: "Local audio",
        local: true,
        localUri: URL.createObjectURL(f),
        image: [],
        duration: 0,
      }));
    remember(tracks);
    notify(`${tracks.length} tracks added for this browser session`);
  };
  return (
    <>
      <div className="page-title split">
        <div>
          <span className="eyebrow">YOUR OWN LITTLE MUSIC WORLD</span>
          <h1>{playlist ? playlist.name : "Your library"}</h1>
          <p>
            {playlist
              ? `${playlist.ids.length} tracks · ${Math.round(songs.reduce((a, s) => a + (+s.duration || 0), 0) / 60)} minutes`
              : "The songs you love, always close."}
          </p>
        </div>
        <button className="primary" onClick={onNewPlaylist}>
          <Plus size={18} /> New playlist
        </button>
      </div>
      {!playlist && (
        <div className="mood-chips">
          {[
            ["all", "Overview"],
            ["liked", "Liked songs"],
            ["recent", "Recently played"],
            ["local", "Local files"],
          ].map(([id, name]) => (
            <button
              key={id}
              className={id === filter ? "selected" : ""}
              onClick={() => setFilter(id)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {!playlist && filter === "all" && (
        <>
          <div className="collection-controls">
            <span className="setting-note">
              Pinned playlists stay at the top
            </span>
            <select
              aria-label="Sort playlists"
              value={settings.playlistSort}
              onChange={(e) => setSetting("playlistSort", e.target.value)}
            >
              <option value="recent">Recently created</option>
              <option value="name">Name A–Z</option>
              <option value="tracks">Most tracks</option>
            </select>
          </div>
          <div className="playlist-grid">
            <button
              className="playlist-tile liked-tile"
              onClick={() => setFilter("liked")}
            >
              <Heart size={30} fill="currentColor" />
              <strong>Liked songs</strong>
              <span>{library.liked.length} favorites</span>
            </button>
            {sortedPlaylists(library.playlists, settings.playlistSort).map(
              (p) => (
                <button
                  className="playlist-tile"
                  key={p.id}
                  onClick={() =>
                    onNavigate({
                      kind: "library",
                      id: p.id,
                    })
                  }
                >
                  <Cover song={library.songs[p.ids[0]]} />
                  {p.pinned && (
                    <Pin size={15} aria-hidden="true" className="pin-mark" />
                  )}
                  <strong>{p.name}</strong>
                  <span>{p.ids.length} tracks</span>
                </button>
              ),
            )}
            <button
              className="playlist-tile create-tile"
              onClick={onNewPlaylist}
            >
              <Plus size={28} />
              <strong>Make a playlist</strong>
              <span>A home for your favorites</span>
            </button>
          </div>
        </>
      )}
      {filter === "local" && !playlist && (
        <div className="info-banner">
          <FolderOpen size={25} />
          <div>
            <strong>Your files. Your collection.</strong>
            <p>
              {native
                ? "Choose audio files from your device. No broad storage permission needed."
                : "Browser file access lasts for this session. The Android app remembers imported files."}
            </p>
          </div>
          <button
            className="secondary"
            onClick={() => (native ? pickLocal() : input.current.click())}
          >
            Import audio
          </button>
          <input
            ref={input}
            type="file"
            accept="audio/*"
            multiple
            hidden
            onChange={importLocal}
          />
        </div>
      )}
      <div className="collection-controls">
        <div className="search-box compact">
          <Search size={18} />
          <input
            placeholder="Filter this collection"
            aria-label="Filter collection"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Sort tracks"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="recent">Original order</option>
          <option value="title">Title A–Z</option>
          <option value="artist">Artist A–Z</option>
        </select>
        <button
          className="small-primary"
          onClick={() => playList(songs)}
          disabled={!songs.length}
        >
          <Play size={16} /> Play
        </button>
        <IconButton
          icon={Download}
          label="Download collection"
          onClick={() => downloadAll(songs)}
          disabled={!songs.length}
        />
      </div>
      {playlist && (
        <div className="playlist-edit">
          <button
            className="secondary"
            aria-pressed={!!playlist.pinned}
            onClick={() =>
              update((l) => ({
                ...l,
                playlists: l.playlists.map((p) =>
                  p.id === playlist.id ? { ...p, pinned: !p.pinned } : p,
                ),
              }))
            }
          >
            <Pin size={16} />{" "}
            {playlist.pinned ? "Unpin playlist" : "Pin playlist"}
          </button>
          <input
            aria-label="Playlist name"
            maxLength={80}
            value={playlist.name}
            onChange={(e) => {
              const name = e.target.value;
              update((l) => ({
                ...l,
                playlists: l.playlists.map((p) =>
                  p.id === playlist.id
                    ? {
                        ...p,
                        name,
                      }
                    : p,
                ),
              }));
            }}
          />
          <button
            className="danger"
            onClick={() => {
              if (
                confirm(
                  "Delete this playlist? Your songs and downloads will remain.",
                )
              ) {
                update((l) => ({
                  ...l,
                  playlists: l.playlists.filter((p) => p.id !== playlist.id),
                }));
                onNavigate({
                  kind: "library",
                });
              }
            }}
          >
            <Trash2 size={16} /> Delete playlist
          </button>
        </div>
      )}
      <TrackList
        songs={songs}
        onMenu={onMenu}
        playlist={playlist && sort === "recent" && !query ? playlist.id : null}
      />
    </>
  );
}
