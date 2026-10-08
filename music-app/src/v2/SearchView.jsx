import { useState } from "react";
import { Search, X, Clock } from "lucide-react";
import { useVibe } from "./Model.jsx";
import { addRecentSearch } from "./core.js";
import { decodeHtml } from "../lib/format.js";
import {
  IconButton,
  Cover,
  useRemote,
  Empty,
  Loading,
  Failure,
  TrackList,
} from "./ui.jsx";
const text = decodeHtml;
export function SearchView({ onMenu, onNavigate }) {
  const { library, update, notify } = useVibe();
  const [query, setQuery] = useState(""),
    [tab, setTab] = useState("songs");
  const trimmed = query.trim();
  const history = addRecentSearch(library.searchHistory, "");
  const remember = () => {
    if (trimmed)
      update((l) => ({
        ...l,
        searchHistory: addRecentSearch(l.searchHistory, query, tab),
      }));
  };
  const remote = useRemote(
    trimmed
      ? `/search/${tab}?query=${encodeURIComponent(trimmed)}&limit=30`
      : null,
  );
  return (
    <>
      <div className="page-title">
        <span className="eyebrow">FIND YOUR NEXT OBSESSION</span>
        <h1>Search & discover</h1>
      </div>
      <form
        className="search-box"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          remember();
          e.currentTarget.querySelector("input")?.blur();
        }}
      >
        <Search />
        <input
          autoFocus
          autoComplete="off"
          enterKeyHint="search"
          maxLength={120}
          placeholder="Songs, artists, albums…"
          aria-label="Search music"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <IconButton
            type="button"
            icon={X}
            label="Clear search"
            onClick={() => setQuery("")}
          />
        )}
      </form>
      <div className="mood-chips">
        {["songs", "albums", "artists", "playlists"].map((t) => (
          <button
            className={t === tab ? "selected" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {!trimmed ? (
        <>
          {!!history.length && (
            <section className="recent-searches" aria-label="Recent searches">
              <div className="section-heading">
                <h2>Recent searches</h2>
                <button
                  className="text-button"
                  onClick={() => {
                    update((l) => ({ ...l, searchHistory: [] }));
                    notify("Search history cleared");
                  }}
                >
                  Clear history
                </button>
              </div>
              <div className="recent-search-grid">
                {history.map((h) => (
                  <button
                    className="recent-search-chip"
                    key={`${h.tab}:${h.query}`}
                    aria-label={`Search again for ${h.query} in ${h.tab}`}
                    onClick={() => {
                      setQuery(h.query);
                      setTab(h.tab);
                    }}
                  >
                    <Clock size={16} />
                    <span>
                      <strong>{h.query}</strong>
                      <small>{h.tab}</small>
                    </span>
                  </button>
                ))}
              </div>
              <p className="setting-note">
                Only on this device. Saved when you submit a search or play/open
                a result.
              </p>
            </section>
          )}
          <Empty
            icon={Search}
            title="What do you want to hear?"
            description="Search the JioSaavn catalog for a favorite or a new discovery."
          />
        </>
      ) : remote.loading ? (
        <Loading />
      ) : remote.error ? (
        <Failure remote={remote} />
      ) : tab === "songs" ? (
        <TrackList
          songs={remote.data?.results || []}
          onMenu={onMenu}
          onPlay={remember}
        />
      ) : (
        <div className="album-grid">
          {(remote.data?.results || []).map((s) => (
            <button
              className="album-card"
              key={s.id}
              onClick={() => {
                remember();
                onNavigate({
                  kind: "detail",
                  type: tab.slice(0, -1),
                  id: s.id,
                });
              }}
            >
              <Cover song={s} />
              <strong>{text(s.name)}</strong>
              <span>{tab.slice(0, -1)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
