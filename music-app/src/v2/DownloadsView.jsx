import {
  Download,
  Play,
  Pause,
  MoreHorizontal,
  Wifi,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { useVibe } from "./Model.jsx";
import { Audio, native } from "./native.js";
import { decodeHtml } from "../lib/format.js";
import { IconButton, Cover, Empty } from "./ui.jsx";
const text = decodeHtml;
export function DownloadsView({ onMenu }) {
  const { offline, playList, settings, setSetting, run, setOffline } =
    useVibe();
  const complete = offline.downloads.filter((d) => d.state === 3),
    songs = complete.map((d) => d.song).filter(Boolean);
  const action = (d, a) =>
    run(async () => {
      await Audio.download({
        action: a,
        id: d.id,
      });
      setOffline(await Audio.downloads());
    });
  return (
    <>
      <div className="page-title">
        <span className="eyebrow">LESS BUFFERING. MORE LISTENING.</span>
        <h1>Your offline world</h1>
        <p>Take your favorites wherever life takes you.</p>
      </div>
      <div className="download-summary">
        <div>
          <Download size={26} />
          <strong>
            {complete.length}
            <span>tracks ready</span>
          </strong>
        </div>
        <div>
          <strong>
            {((offline.downloadBytes || 0) / 1048576).toFixed(1)}
            <span>MB on device</span>
          </strong>
        </div>
        <button
          className="primary"
          disabled={!songs.length}
          onClick={() => playList(songs)}
        >
          <Play size={17} /> Play downloads
        </button>
      </div>
      <label className="toggle-row">
        <span>
          <Wifi size={20} />
          <b>Download on Wi-Fi only</b>
          <small>Protect your mobile data</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={settings.wifiOnly}
          onChange={(e) => setSetting("wifiOnly", e.target.checked)}
        />
      </label>
      {!native ? (
        <Empty
          icon={Download}
          title="Offline, without compromises"
          description="Managed downloads run in the Android app, even when this screen is closed. Browser audio export is available from a song’s menu."
        />
      ) : (
        <>
          {offline.waiting && (
            <div className="info-banner">
              <Wifi />
              <p>Downloads are waiting for the required network connection.</p>
            </div>
          )}
          {!offline.downloads.length && (
            <Empty
              icon={Download}
              title="Make room for your favorites"
              description="Open any song, album, or playlist menu to download it."
            />
          )}
          <div className="tracks">
            {offline.downloads.map((d) => (
              <div className="download-row" key={d.id}>
                <Cover song={d.song} />
                <div className="track-info">
                  <strong>{text(d.song?.name || d.id)}</strong>
                  <span>
                    {{
                      0: "Queued",
                      1: "Paused",
                      2: "Downloading",
                      3: "Ready offline",
                      4: "Failed — retry",
                      5: "Removing",
                      7: "Restarting",
                    }[d.state] || "Waiting"}
                    {d.state === 2 ? ` · ${Math.round(d.percent)}%` : ""}
                  </span>
                  {d.state === 2 && <progress value={d.percent} max={100} />}
                </div>
                {d.state === 3 ? (
                  <IconButton
                    icon={Play}
                    label="Play downloaded track"
                    onClick={() =>
                      playList(
                        songs,
                        songs.findIndex((s) => s.id === d.id),
                      )
                    }
                  />
                ) : d.state === 4 ? (
                  <IconButton
                    icon={RefreshCw}
                    label="Retry download"
                    onClick={() =>
                      run(() =>
                        Audio.download({
                          song: d.song,
                        }),
                      )
                    }
                  />
                ) : (
                  <IconButton
                    icon={d.state === 1 ? Play : Pause}
                    label={d.state === 1 ? "Resume download" : "Pause download"}
                    onClick={() =>
                      action(d, d.state === 1 ? "resume" : "pause")
                    }
                  />
                )}
                <IconButton
                  icon={Trash2}
                  label="Remove download"
                  onClick={() => action(d, "remove")}
                />
                <IconButton
                  icon={MoreHorizontal}
                  label="Track options"
                  onClick={() => onMenu(d.song)}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
