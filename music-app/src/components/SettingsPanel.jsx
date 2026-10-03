import { fmt } from '../lib/format.js'
import { estimate } from '../lib/song.js'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'

const SLEEP_OPTIONS = [0, 15, 30, 60]

export function SettingsPanel({ open, sleep }) {
  const s = useSettings()
  const { current, currentQuality } = usePlayer()
  const est = estimate(currentQuality, current?.duration)

  return (
    <div id="setPanel" className={open ? 'open' : ''} onClick={(e) => e.stopPropagation()}>
      <div className="set-sec">
        <label className="switch-row">
          <span>
            💾 Data Saver <em>(Beta)</em>
          </span>
          <span>
            <input
              type="checkbox"
              checked={s.dataSaver}
              onChange={(e) => s.setDataSaver(e.target.checked)}
            />
            <span className="switch" />
          </span>
        </label>
        <p className="set-note">
          {s.saverAuto && s.dataSaver
            ? 'Auto-enabled: slow connection or Data Saver detected (Beta).'
            : s.dataSaver
              ? 'ON: lowest audio quality + smaller artwork. ~90% less data (Beta).'
              : 'Locks lowest audio + smaller artwork. Auto-enables on slow connections.'}
        </p>
        <p className="set-note">
          {(s.dataSaver ? 'Saver ON: ' : 'Now: ') +
            `${currentQuality} ≈ ${est.perMin.toFixed(1)} MB/min ≈ ${est.songMB.toFixed(1)} MB/song`}
        </p>
      </div>

      <div className="set-sec">
        <label className="switch-row">
          <span>🎚️ Crossfade</span>
          <span>
            <input
              type="checkbox"
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
            value={s.crossfade.dur}
            disabled={!s.crossfade.on}
            onChange={(e) => s.setCrossfadeDur(+e.target.value)}
          />
          <span>{s.crossfade.dur}s</span>
        </div>
        <p className="set-note">
          Overlap between auto-advancing tracks. Manual skips use a quick 0.5s fade.
        </p>
      </div>

      <div className="set-sec">
        <div className="switch-row">
          <span>😴 Sleep timer</span>
        </div>
        <div className="sleep-pills">
          {SLEEP_OPTIONS.map((m) => (
            <button
              key={m}
              className={sleep.minutes === m ? 'on' : ''}
              onClick={() => sleep.setMinutes(m)}
            >
              {m === 0 ? 'Off' : `${m}m`}
            </button>
          ))}
        </div>
        <p className="set-note">
          {sleep.minutes > 0 ? `Stops in ${fmt(sleep.left / 1000)}` : 'Off'}
        </p>
      </div>

      <div className="set-sec">
        <label className="switch-row">
          <span>✨ Canvas animations</span>
          <span>
            <input type="checkbox" checked={s.viz.on} onChange={(e) => s.setVizOn(e.target.checked)} />
            <span className="switch" />
          </span>
        </label>
        <div className="set-row">
          <select value={s.viz.style} onChange={(e) => s.setVizStyle(e.target.value)}>
            <option value="spectrum">Live spectrum (real audio data)</option>
            <option value="bars">Bars (simulated)</option>
            <option value="wave">Waves (simulated)</option>
            <option value="orbit">Orbit (simulated)</option>
          </select>
        </div>
        <p className="set-note">
          {!s.liveOK
            ? 'Live spectrum blocked by stream CORS — using simulated visuals.'
            : s.viz.style === 'spectrum'
              ? 'Real-time frequency data from the audio stream.'
              : 'Simulated animation (no audio analysis).'}
        </p>
      </div>
    </div>
  )
}
