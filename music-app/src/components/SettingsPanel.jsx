import { useEffect, useState } from 'react'
import { LAW_HINTS, LAW_LABELS, MAX_CROSSFADE_SEC, describePlan, planTransition } from '../lib/transition.js'
import { DEFAULT_REC, REC_REASON_SENTENCE } from '../lib/recommend.js'
import { estimate } from '../lib/song.js'
import { describeSleep } from '../lib/sleep.js'
import {
  FEATURES,
  SOURCE,
  STATUS,
  describeVisual,
  mediaPlan,
  summary,
} from '../lib/capabilities.js'
import { SOURCES, sourceOf } from '../lib/sources.js'
import { Icon } from './Icon.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { needsIOSInstallHint, isStandalone } from '../lib/platform.js'
import { promptInstall, subscribeInstall } from '../lib/install.js'

const SLEEP_OPTIONS = [0, 15, 30, 60]
// Icons for the capability matrix. `unavailable` is a plain cross on purpose:
// it is a fact about the source, not an error the user caused.
const CAP_ICONS = {
  [STATUS.available]: 'check',
  [STATUS.strength]: 'sparkle',
  [STATUS.local]: 'clock',
  [STATUS.unavailable]: 'close',
  [STATUS.blocked]: 'clock',
}
const IOS_STEPS = 'Tap the Share button in Safari, scroll down, then choose “Add to Home Screen”.'

/**
 * Installed web apps get the whole iPhone treatment: no Safari bars, a real
 * home-screen icon, a launch screen, and audio that can keep playing with the
 * screen off. Safari has no one-tap install API, so on iOS this explains the
 * share-sheet flow instead of showing a button that does nothing.
 */
function InstallSection() {
  const [canPrompt, setCanPrompt] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [note, setNote] = useState('')
  const standalone = isStandalone()
  const iosHint = needsIOSInstallHint()

  useEffect(
    () =>
      subscribeInstall((next) => {
        setCanPrompt(next.canPrompt)
        setInstalled(next.installed)
      }),
    []
  )

  const install = async () => {
    const result = await promptInstall()
    if (result === 'accepted') setNote('Installing VIBEX…')
    else if (result === 'dismissed') setNote('Install dismissed — you can try again from the browser menu.')
    else setNote('Open your browser menu and choose “Install app”.')
  }

  return (
    <div className="set-sec">
      <div className="set-head">
        <Icon name="download" size={16} />
        <span>Install VIBEX</span>
      </div>
      {standalone || installed ? (
        <p className="set-note">
          Installed. VIBEX opens full screen and keeps playing with the screen locked.
        </p>
      ) : (
        <>
          {canPrompt && (
            <button type="button" className="set-install-btn" onClick={install}>
              <Icon name="download" size={15} />
              Install app
            </button>
          )}
          {iosHint && (
            <button
              type="button"
              className="set-install-btn"
              aria-expanded={!!note}
              onClick={() => setNote(note ? '' : IOS_STEPS)}
            >
              <Icon name="share" size={15} />
              How to install on iPhone
            </button>
          )}
          {!canPrompt && !iosHint && (
            <p className="set-note">Open this page in Safari, then Share → Add to Home Screen.</p>
          )}
          {note && <p className="set-note">{note}</p>}
          <p className="set-note">
            Full screen, a home-screen icon, launch screen and lock-screen controls.
          </p>
        </>
      )}
    </div>
  )
}

/** Playback preferences. Everything here persists across reloads. */
export function SettingsPanel({ open, sleep }) {
  const s = useSettings()
  const { resetHistory } = useLibrary()
  const { current, currentQuality } = usePlayer()
  const est = estimate(currentQuality, current?.duration)
  const plan = mediaPlan({ dataSaver: s.dataSaver, qualityPref: s.qualityPref })
  const visual = describeVisual({ enabled: s.viz.on, style: s.viz.style, liveOK: s.liveOK })
  const caps = summary()
  // Two-step reset: a history wipe is irreversible, so the first tap only arms
  // the button and tells the listener exactly what will survive.
  const [resetArmed, setResetArmed] = useState(false)

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
            `${currentQuality} ≈ ${est.perMin.toFixed(1)} MB/min ≈ ${est.songMB.toFixed(1)} MB/song` +
            (plan.artwork === 'small' ? ' · small artwork' : '')}
        </p>
      </div>

      <div className="set-sec">
        <div className="set-head">
          <Icon name="sparkle" size={16} />
          <span>Transitions</span>
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
            min="0"
            max={MAX_CROSSFADE_SEC}
            step="1"
            aria-label="Crossfade duration in seconds"
            value={s.crossfade.dur}
            disabled={!s.crossfade.on}
            onChange={(e) => s.setCrossfadeDur(+e.target.value)}
          />
          <span>{s.crossfade.dur === 0 ? 'Gapless' : `${s.crossfade.dur}s`}</span>
        </div>

        <label className="set-field">
          <span>Curve</span>
          <select
            aria-label="Crossfade curve"
            value={s.crossfade.law}
            disabled={!s.crossfade.on || s.crossfade.dur === 0}
            onChange={(e) => s.setCrossfadeLaw(e.target.value)}
          >
            {s.crossfadeLaws.map((law) => (
              <option key={law} value={law}>
                {LAW_LABELS[law]}
              </option>
            ))}
          </select>
        </label>
        <p className="set-note">
          {s.crossfade.dur === 0
            ? 'Gapless: the next track is cut in exactly at the boundary. Not a 0-second crossfade — no ramp at all.'
            : LAW_HINTS[s.crossfade.law]}
        </p>
        <p className="set-note">
          {describePlan(
            planTransition({
              crossfadeOn: s.crossfade.on,
              crossfadeSec: s.crossfade.dur,
              law: s.crossfade.law,
            })
          )}{' '}
          · A manual skip uses a short {Math.round(0.35 * 1000)}ms hand-over instead.
        </p>
      </div>

      <div className="set-sec">
        <div className="set-head">
          <Icon name="shuffle" size={16} />
          <span>Suggestions</span>
        </div>
        <div className="set-row">
          <select
            aria-label="Shuffle mode"
            value={s.shuffleMode}
            onChange={(e) => s.setShuffleMode(e.target.value)}
          >
            <option value="off">Shuffle off</option>
            <option value="on">Shuffle on</option>
            <option value="smart">Smart shuffle</option>
          </select>
        </div>
        <label className="switch-row">
          <span>Keep playing after the queue</span>
          <span>
            <input
              type="checkbox"
              aria-label="Autoplay similar songs when the queue ends"
              checked={s.autoplay}
              onChange={(e) => s.setAutoplay(e.target.checked)}
            />
            <span className="switch" />
          </span>
        </label>
        <p className="set-note">
          {s.shuffleMode === 'smart'
            ? `One suggestion every ${DEFAULT_REC.insertEvery} tracks, and only in queues longer than ${DEFAULT_REC.minTracks}. They are marked in the queue and never added to your playlist.`
            : `Autoplay adds ${REC_REASON_SENTENCE.same_artist.toLowerCase()} once your own queue runs out. Every added track is marked, and you can dismiss it with −.`}
        </p>
        <p className="set-note">
          A skip in the first {DEFAULT_REC.earlySkipSec} seconds counts as “not this”, and dismissed
          suggestions stay away for {DEFAULT_REC.dismissDays} days.
        </p>
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
          {sleep.minutes > 0
            ? describeSleep(sleep.left, sleep.minutes * 60)
            : 'Playback continues.'}
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
        <label className="switch-row">
          <span>Canvas video in the full player</span>
          <span>
            <input
              type="checkbox"
              aria-label="Canvas video in the full player"
              checked={s.canvas}
              onChange={(e) => s.setCanvas(e.target.checked)}
            />
            <span className="switch" />
          </span>
        </label>
        <p className="set-note">
          {s.dataSaver
            ? 'Off while Data Saver is on — the clip would be a second download.'
            : s.canvas
              ? 'Looks up a looping clip on YouTube Music when you open the full player. Audio stays on JioSaavn; falls back to artwork if none is found. YouTube needs a signed-in session for music tracks, which this server does not have, so artwork is what you will see.'
              : 'Off — the full player shows artwork only, and nothing is requested from YouTube.'}
        </p>
        <p className="set-note">
          {visual.reason === 'live_audio_unavailable'
            ? s.ios
              ? 'On iPhone the spectrum is simulated: routing audio through Web Audio stops playback when the screen locks.'
              : 'Live spectrum blocked by the stream’s CORS headers — using simulated visuals.'
            : visual.note}{' '}
          It is drawn on this device from audio that is already playing, so Data Saver leaves it
          alone — hiding it would save no data.
        </p>
      </div>

      <div className="set-sec">
        <div className="set-head">
          <Icon name="alert" size={16} />
          <span>Privacy &amp; history</span>
        </div>
        <label className="switch-row">
          <span>Private session</span>
          <span>
            <input
              type="checkbox"
              aria-label="Private session — stop recording listening history"
              checked={s.privateSession}
              onChange={(e) => s.setPrivateSession(e.target.checked)}
            />
            <span className="switch" />
          </span>
        </label>
        <p className="set-note">
          {s.privateSession
            ? 'Private: nothing played from now on is added to your history, your taste mix or your stats. Likes and playlists are unaffected.'
            : 'Playback is counted on this device only. Turn this on for a session nothing is recorded from.'}
        </p>

        <div className="set-row">
          <span className="set-label">Excluded artists</span>
          <span className="set-count">{s.excludedArtists.length}</span>
        </div>
        {s.excludedArtists.length === 0 ? (
          <p className="set-note">
            None. Use “Don’t suggest this artist” on any row in your mix, or on an artist page.
          </p>
        ) : (
          <div className="exclude-list" aria-label="Artists excluded from suggestions">
            {s.excludedArtists.map((name) => (
              <button
                type="button"
                key={name}
                className="chip"
                title={`Suggest ${name} again`}
                onClick={() => s.unexcludeArtist(name)}
              >
                {name}
                <Icon name="close" size={12} />
              </button>
            ))}
          </div>
        )}

        <div className="set-row">
          <span className="set-label">Listening history</span>
          <button
            type="button"
            className={'btn-ghost' + (resetArmed ? ' danger' : '')}
            onClick={() => {
              if (!resetArmed) {
                setResetArmed(true)
                return
              }
              resetHistory()
              setResetArmed(false)
            }}
            onBlur={() => setResetArmed(false)}
          >
            {resetArmed ? 'Tap again to erase' : 'Reset history'}
          </button>
        </div>
        <p className="set-note">
          {resetArmed
            ? 'This erases plays, minutes and the taste profile. Likes and playlists stay.'
            : 'Reset erases plays, minutes and the taste profile — likes and playlists stay.'}
        </p>
      </div>

      <div className="set-sec">
        <div className="set-head">
          <Icon name="music" size={16} />
          <span>Music source</span>
        </div>
        <div className="set-row">
          <select
            aria-label="Music source"
            value={s.source}
            onChange={(e) => s.setSource(e.target.value)}
          >
            {SOURCES.map((src) => (
              <option key={src.id} value={src.id}>
                {src.label}
              </option>
            ))}
          </select>
        </div>
        <p className="set-note">
          {sourceOf(s.source).plays === 'catalogue-only'
            ? 'YouTube Music is browse-and-search only: YouTube will not serve audio to this server, so these tracks cannot play here. Switch back to JioSaavn to listen.'
            : 'JioSaavn provides both the catalogue and the audio, on every device.'}
        </p>
      </div>

      <div className="set-sec">
        <div className="set-head">
          <Icon name="info" size={16} />
          <span>What VIBEX can and can’t do</span>
        </div>
        <p className="set-note">
          Audio comes from one source, {SOURCE.label} — up to {SOURCE.maxKbps} kbps {SOURCE.format}.{' '}
          {caps.available} of {caps.total} capabilities below work; the rest are listed because no
          setting would produce them. Canvas video is the one cross-source extra — the clip would
          come from YouTube Music, but YouTube will not describe music tracks without a signed-in
          session, so it stays artwork.
        </p>
        <ul className="cap-list">
          {FEATURES.map((f) => (
            <li key={f.id} className={'cap-row ' + f.status}>
              <span className="cap-ico" aria-hidden="true">
                <Icon name={CAP_ICONS[f.status]} size={13} />
              </span>
              <span className="cap-text">
                <span className="cap-line">
                  <span className="cap-label">{f.label}</span>
                  <span className="cap-claim">{f.claim}</span>
                </span>
                {/* Detail only where it has to justify an absence — a full
                    detail column would be the wall of text this avoids. */}
                {f.status !== STATUS.available && f.status !== STATUS.strength && (
                  <span className="cap-detail">{f.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="set-note">
          Nothing above changes by switching quality or toggling anything else — there is no
          higher tier to unlock here.
        </p>
      </div>

      <InstallSection />
    </div>
  )
}
