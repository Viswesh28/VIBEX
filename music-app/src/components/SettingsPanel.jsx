import { fmt } from '../lib/format.js'
import { estimate } from '../lib/song.js'
import { Icon } from './Icon.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'

const SLEEP_OPTIONS = [0, 15, 30, 60]

/** Playback preferences. Everything here persists across reloads. */
export function SettingsPanel({ open, sleep }) {
  const s = useSettings()
  const { current, currentQuality } = usePlayer()
  const est = estimate(currentQuality, current?.duration)

  return (
    <div
      id="setPanel"
      className={open ? 'open' : ''}
      role="dialog"
      aria-label="Playback settings"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="set-sec">
        <div className="set-head">
          <Icon name="download" size={16} />
          <span>Data saver</span>
          <em style={{ fontStyle: 'normal', fontSize: 10.5, color: 'var(--muted)' }}>Beta</em>
        </div>
        <label className="switch-row">
          <span>Smaller art and audio</span>
          <span>
            <input
              type="checkbox"
              aria-label="Data saver"
              checked={s.dataSaver}
              onChange={(e) => s.setDataSaver(e.target.checked)}
            />
            <span className="switch" />
          </span>
        </label>
        <p className="set-note">
          {s.saverAuto && s.dataSaver
            ? 'Auto-enabled: your browser reports a slow connection.'
            : s.dataSaver
              ? 'On — lowest audio quality and smaller artwork.'
              : 'Locks the lowest quality and small artwork. Auto-enables on slow connections.'}
        </p>
        <p className="set-note">
          {(s.dataSaver ? 'Saver on: ' : 'Now: ') +
            `${currentQuality} ≈ ${est.perMin.toFixed(1)} MB/min ≈ ${est.songMB.toFixed(1)} MB/song`}
        </p>
      </div>

      <div className="set-sec">
        <div className="set-head">
          <Icon name="sparkle" size={16} />
          <span>Crossfade</span>
        </div>
        <label className="switch-row">
          <span>Blend tracks</span>
          <span>
            <input
              type="checkbox"
              aria-label="Crossfade"
              checked={s.crossfade.on}
              onChange={(e) => s.setCrossfadeOn(e.target.checked)}
            />
            <span className="switch" />
          </span>
        </label>
        <div className="set-row">
          <input
            type="range"
            min="1"
            max="12"
            step="1"
            aria-label="Crossfade duration in seconds"
            value={s.crossfade.dur}
            disabled={!s.crossfade.on}
            onChange={(e) => s.setCrossfadeDur(+e.target.value)}
          />
          <span>{s.crossfade.dur}s</span>
        </div>
        <p className="set-note">Overlap between auto-advancing tracks. Skips use a quick fade.</p>
      </div>

      <div className="set-sec">
        <div className="set-head">
          <Icon name="clock" size={16} />
          <span>Sleep timer</span>
        </div>
        <div className="sleep-pills">
          {SLEEP_OPTIONS.map((m) => (
            <button
              type="button"
              key={m}
              className={sleep.minutes === m ? 'on' : ''}
              aria-pressed={sleep.minutes === m}
              onClick={() => sleep.setMinutes(m)}
            >
              {m === 0 ? 'Off' : `${m}m`}
            </button>
          ))}
        </div>
        <p className="set-note">
          {sleep.minutes > 0 ? `Stops playback in ${fmt(sleep.left / 1000)}.` : 'Playback continues.'}
        </p>
      </div>

      <div className="set-sec">
        <div className="set-head">
          <Icon name="stats" size={16} />
          <span>Visuals</span>
        </div>
        <label className="switch-row">
          <span>Canvas animations</span>
          <span>
            <input
              type="checkbox"
              aria-label="Canvas animations"
              checked={s.viz.on}
              onChange={(e) => s.setVizOn(e.target.checked)}
            />
            <span className="switch" />
          </span>
        </label>
        <div className="set-row">
          <select aria-label="Visualiser style" value={s.viz.style} onChange={(e) => s.setVizStyle(e.target.value)}>
            <option value="spectrum">Live spectrum (real audio data)</option>
            <option value="bars">Bars (simulated)</option>
            <option value="wave">Waves (simulated)</option>
            <option value="orbit">Orbit (simulated)</option>
          </select>
        </div>
        <p className="set-note">
          {!s.liveOK
            ? 'Live spectrum blocked by the stream’s CORS headers — using simulated visuals.'
            : s.viz.style === 'spectrum'
              ? 'Real-time frequency data from the audio stream.'
              : 'Simulated animation (no audio analysis).'}
        </p>
      </div>
    </div>
  )
}
