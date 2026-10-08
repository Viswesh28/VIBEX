import { Download, Play } from "lucide-react";
import { useVibe } from "./Model.jsx";
import { decodeHtml } from "../lib/format.js";
import { Cover, useRemote, Loading, Failure, TrackList } from "./ui.jsx";
const text = decodeHtml;
export function DetailView({ view, onMenu }) {
  const { playList, downloadAll } = useVibe();
  const path =
    view.type === "artist"
      ? `/artists/${view.id}?songCount=40&albumCount=5`
      : view.type === "album"
        ? `/albums?id=${view.id}`
        : `/playlists?id=${view.id}&limit=100`;
  const r = useRemote(path);
  if (r.loading) return <Loading />;
  if (r.error) return <Failure remote={r} />;
  const data = r.data;
  if (!data) return null;
  const songs = data.songs || data.topSongs || [];
  return (
    <>
      <div className="collection-head">
        <Cover song={data} />
        <div>
          <span className="eyebrow">{view.type}</span>
          <h1>{text(data.name)}</h1>
          <p>
            {songs.length} tracks ·{" "}
            {text(
              data.description ||
                data.dominantLanguage ||
                "JioSaavn collection",
            )}
          </p>
          <div className="button-row">
            <button
              className="primary"
              onClick={() => playList(songs)}
              disabled={!songs.length}
            >
              <Play size={18} /> Play all
            </button>
            <button
              className="secondary"
              onClick={() => downloadAll(songs)}
              disabled={!songs.length}
            >
              <Download size={18} /> Download
            </button>
          </div>
        </div>
      </div>
      <TrackList songs={songs} onMenu={onMenu} numbered />
    </>
  );
}
