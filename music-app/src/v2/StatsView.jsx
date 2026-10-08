import { useState, useMemo } from "react";
import {
  Mic2,
  Music2,
  Clock,
  Headphones,
  Disc3,
  BarChart3,
} from "lucide-react";
import { useVibe } from "./Model.jsx";
import { decodeHtml } from "../lib/format.js";
import { summarize } from "./core.js";
import { Empty, Section } from "./ui.jsx";
const text = decodeHtml;
export function StatsView() {
  const { events, library } = useVibe(),
    [days, setDays] = useState(7),
    stats = useMemo(() => summarize(events, days), [events, days]);
  const artists = Object.create(null);
  for (const s of stats.top)
    artists[s.artist] = (artists[s.artist] || 0) + s.seconds;
  return (
    <>
      <div className="page-title">
        <span className="eyebrow">A SOUNDTRACK THAT’S UNIQUELY YOU</span>
        <h1>Your listening story</h1>
        <p>Private by default. Counted only while music is playing.</p>
      </div>
      <div className="mood-chips">
        {[1, 7, 30, 365].map((n) => (
          <button
            key={n}
            className={days === n ? "selected" : ""}
            onClick={() => setDays(n)}
          >
            {n === 1
              ? "Last 24 hours"
              : n === 7
                ? "Last 7 days"
                : n === 30
                  ? "Last 30 days"
                  : "Last 365 days"}
          </button>
        ))}
      </div>
      <div className="stats-grid">
        <div>
          <Headphones />
          <strong>{Math.round(stats.seconds / 60)}</strong>
          <span>minutes listened</span>
        </div>
        <div>
          <Disc3 />
          <strong>{stats.plays}</strong>
          <span>plays · 5+ seconds</span>
        </div>
        <div>
          <Music2 />
          <strong>{stats.top.length}</strong>
          <span>different tracks</span>
        </div>
      </div>
      {library.legacyStats && (
        <div className="info-banner">
          <Clock />
          <p>
            Your previous version’s totals are preserved:{" "}
            {library.legacyStats.plays || 0} plays ·{" "}
            {Math.round((library.legacyStats.seconds || 0) / 60)} minutes. New
            insights use measured playback time.
          </p>
        </div>
      )}
      <Section title="Your most-played tracks">
        {!stats.top.length ? (
          <Empty
            icon={BarChart3}
            title="Your story starts with a song"
            description="Play something you love. Your listening insights will appear here."
          />
        ) : (
          stats.top.slice(0, 10).map((s, i) => (
            <div className="stat-song" key={s.id}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <div>
                <strong>{text(s.name)}</strong>
                <small>{text(s.artist)}</small>
                <div className="stat-meter">
                  <i
                    style={{
                      width: `${(s.seconds / stats.top[0].seconds) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <b>{Math.round(s.seconds / 60)} min</b>
            </div>
          ))
        )}
      </Section>
      <Section title="Artists on repeat">
        <div className="artist-stat-grid">
          {Object.entries(artists)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([name, sec]) => (
              <div key={name}>
                <Mic2 />
                <strong>{text(name)}</strong>
                <span>{Math.round(sec / 60)} minutes</span>
              </div>
            ))}
        </div>
      </Section>
    </>
  );
}
