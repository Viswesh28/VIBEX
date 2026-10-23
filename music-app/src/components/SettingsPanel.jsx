import { useEffect, useState } from 'react'
import {
  LAW_HINTS,
  LAW_LABELS,
  MAX_CROSSFADE_SEC,
  describePlan,
  planTransition,
} from '../lib/transition.js'
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
import { BROWSE_ONLY_NOTE, SOURCES } from '../lib/sources.js'
import { Icon } from './Icon.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'
import { needsIOSInstallHint, isStandalone } from '../lib/platform.js'
import { promptInstall, subscribeInstall } from '../lib/install.js'

const SLEEP_OPTIONS = [0, 15, 30, 60]
const CAP_ICONS = {
  [STATUS.available]: 'check',
  [STATUS.strength]: 'sparkle',
  [STATUS.local]: 'clock',
  [STATUS.unavailable]: 'close',
  [STATUS.blocked]: 'clock',
}
const IOS_STEPS = 'Tap the Share button in Safari, scroll down, then choose “Add to Home Screen”.'

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
    else if (result === 'dismissed')
      setNote('Install dismissed — you can try again from the browser menu.')
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

/** Playback preferences, Studio Audio FX, Offline Vault & Live Cloud Sync. */
export function SettingsPanel({ open, sleep }) {
  const s = useSettings()
  const { setStatus } = useStatus()
  const { setDspOpen, setImportModalOpen, openShareToVibex } = useUI() || {}
  const {
    resetHistory,
    hasAccountProvider,
    accountProvider,
    account,
    syncState,
    connectAccount,
    syncNow,
    pauseSync,
    resumeSync,
    disconnectAccount,
    clearRemoteMirror,
    downloadLibraryExport,
    deleteLocalLibrary,
    offlineTracks,
    offlineBytes,
    clearOfflineDownloads,
  } = useLibrary()
  const { current, currentQuality } = usePlayer()
  const est = estimate(currentQuality, current?.duration)
  const plan = mediaPlan({ dataSaver: s.dataSaver, qualityPref: s.qualityPref })
  const visual = describeVisual({ enabled: s.viz.on, style: s.viz.style, liveOK: s.liveOK })
  const caps = summary()

  const [resetArmed, setResetArmed] = useState(false)
  const [deleteLibArmed, setDeleteLibArmed] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [cloudMsg, setCloudMsg] = useState('')

  const isSupabaseCloud = Boolean(accountProvider?.isSupabase)

  const handleCloudAuth = async (mode) => {
    if (!emailInput.trim()) {
      setCloudMsg('Enter your email address first.')
      return
    }
    setSyncBusy(true)
    setCloudMsg('')
    try {
      if (mode === 'magic') {
        await accountProvider.sendMagicLink(emailInput.trim())
        setCloudMsg('Magic sign-in link sent! Check your email inbox.')
        setStatus('Sent magic sign-in link to your email.')
      } else {
        if (!passwordInput || passwordInput.length < 6) {
          setCloudMsg('Password must be at least 6 characters.')
          setSyncBusy(false)
          return
        }
        await connectAccount({
          collections: ['liked', 'playlists'],
          credentials: { mode, email: emailInput.trim(), password: passwordInput },
        })
        setPasswordInput('')
        setCloudMsg('Connected! Your library is now synced to Supabase Cloud.')
        setStatus('Cloud sync active.')
      }
    } catch (err) {
      setCloudMsg(err?.message || 'Sign-in failed. Check your email and password.')
    } finally {
      setSyncBusy(false)
    }
  }

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
          <Icon name="sliders" size={16} />
          <span>Studio EQ &amp; Audio DSP</span>
        </div>
        <label className="switch-row">
          <span>Slowed + Reverb (0.84x + Hall)</span>
          <span>
            <input
              type="checkbox"
              aria-label="Slowed and reverb audio mode"
              checked={Boolean(s.dsp?.slowedReverb)}
              onChange={(e) => s.updateDsp({ slowedReverb: e.target.checked })}
            />
            <span className="switch" />
          </span>
        </label>
        <label className="switch-row">
          <span>Loudness normalizer</span>
          <span>
            <input
              type="checkbox"
              aria-label="Loudness normalizer"
              checked={Boolean(s.dsp?.loudnessNorm)}
              onChange={(e) => s.updateDsp({ loudnessNorm: e.target.checked })}
            />
            <span className="switch" />
          </span>
        </label>
        <div className="set-row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setDspOpen(true)}
          >
            Open 10-Band EQ ({s.dsp?.eqPreset || 'flat'})
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setImportModalOpen(true)}
          >
            Import playlist
          </button>
        </div>
      </div>

      <div className="set-sec">
        <div className="set-head">
          <Icon name="download" size={16} />
          <span>Data saver &amp; Offline vault</span>
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
          {(s.dataSaver ? 'Saver on: ' : 'Now: ') +
            `${currentQuality} ≈ ${est.perMin.toFixed(1)} MB/min ≈ ${est.songMB.toFixed(1)} MB/song` +
            (plan.artwork === 'small' ? ' · small artwork' : '')}
        </p>
        <div className="set-row">
          <span className="set-label">
            Offline audio ({offlineTracks.length} saved · {(offlineBytes / 1048576).toFixed(1)} MB)
          </span>
          {offlineTracks.length > 0 && (
            <button
              type="button"
              className="btn-ghost"
              onClick={async () => {
                await clearOfflineDownloads()
                setStatus('Cleared offline cached songs.')
              }}
            >
              Clear offline
            </button>
          )}
        </div>
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
          {s.crossfade.dur === 0 ? 'Gapless cut at track boundary.' : LAW_HINTS[s.crossfade.law]}{' '}
          {describePlan(
            planTransition({
              crossfadeOn: s.crossfade.on,
              crossfadeSec: s.crossfade.dur,
              law: s.crossfade.law,
            })
          )}
        </p>
      </div>

      <div className="set-sec">
        <div className="set-head">
          <Icon name="shuffle" size={16} />
          <span>Suggestions &amp; Languages</span>
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
        <div className="exclude-list" role="group" aria-label="Preferred home languages">
          {(s.availableLanguages || []).map((lang) => {
            const on = (s.languages || []).includes(lang.id)
            return (
              <button
                key={lang.id}
                type="button"
                className={'chip' + (on ? ' active' : '')}
                aria-pressed={on}
                onClick={() => s.toggleLanguage(lang.id)}
              >
                {lang.label}
              </button>
            )
          })}
        </div>
        <p className="set-note">
          {s.shuffleMode === 'smart'
            ? `One suggestion every ${DEFAULT_REC.insertEvery} tracks, marked in your queue.`
            : `Autoplay adds ${REC_REASON_SENTENCE.same_artist.toLowerCase()} once your queue ends.`}
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
          <select
            aria-label="Visualiser style"
            value={s.viz.style}
            onChange={(e) => s.setVizStyle(e.target.value)}
          >
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
        <p className="set-note">{visual.note}</p>
      </div>

      <div className="set-sec">
        <div className="set-head">
          <Icon name="cloud" size={16} />
          <span>Cloud Sync &amp; Privacy</span>
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

        {hasAccountProvider ? (
          <>
            <div className="set-row">
              <span className="set-label">
                Account sync{account ? ` (${account.displayName})` : ''}
              </span>
              {account ? (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={syncBusy}
                  onClick={async () => {
                    setSyncBusy(true)
                    try {
                      await syncNow()
                    } finally {
                      setSyncBusy(false)
                    }
                  }}
                >
                  Sync now
                </button>
              ) : !isSupabaseCloud ? (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={syncBusy}
                  onClick={async () => {
                    setSyncBusy(true)
                    try {
                      await connectAccount({ collections: ['liked', 'playlists'] })
                    } finally {
                      setSyncBusy(false)
                    }
                  }}
                >
                  Opt in &amp; connect
                </button>
              ) : null}
            </div>

            {!account && isSupabaseCloud && (
              <div className="cloud-auth-box">
                <input
                  type="email"
                  aria-label="Cloud sync email address"
                  placeholder="you@example.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                />
                <input
                  type="password"
                  aria-label="Cloud sync password"
                  placeholder="Password (min 6 chars — optional for Magic Link)"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                />
                <div className="cloud-auth-btns">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={syncBusy}
                    onClick={() => handleCloudAuth('signin')}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={syncBusy}
                    onClick={() => handleCloudAuth('signup')}
                  >
                    Create account
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={syncBusy}
                    onClick={() => handleCloudAuth('magic')}
                  >
                    Magic Link
                  </button>
                </div>
              </div>
            )}

            {account && (
              <div className="set-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {syncState?.status === 'paused' ? (
                  <button type="button" className="btn-ghost" onClick={() => resumeSync()}>
                    Resume sync
                  </button>
                ) : (
                  <button type="button" className="btn-ghost" onClick={() => pauseSync()}>
                    Pause sync
                  </button>
                )}
                <button type="button" className="btn-ghost" onClick={() => clearRemoteMirror()}>
                  Clear synced copy
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => disconnectAccount({ deleteMirror: false })}
                >
                  Disconnect account
                </button>
              </div>
            )}

            {cloudMsg && <p className="set-note">{cloudMsg}</p>}
            <p className="set-note">
              {syncState?.status === 'auth_required'
                ? 'Provider session expired or was revoked — sign in again to resume sync.'
                : account
                  ? `Synced live across devices (${syncState?.status || 'idle'}). Local items stay safe offline.`
                  : 'Sign in with Email + Password or 1-tap Magic Link to sync likes & playlists across devices.'}
            </p>
          </>
        ) : (
          <p className="set-note">
            Local-first storage active. Export or import portable JSON snapshots anytime below.
          </p>
        )}

        <div className="set-row">
          <span className="set-label">Excluded artists</span>
          <span className="set-count">{s.excludedArtists.length}</span>
        </div>
        {s.excludedArtists.length > 0 && (
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

        <div className="set-row">
          <span className="set-label">Library backup</span>
          <button type="button" className="btn-ghost" onClick={() => downloadLibraryExport()}>
            Export library
          </button>
        </div>

        <div className="set-row">
          <span className="set-label">Local library data</span>
          <button
            type="button"
            className={'btn-ghost' + (deleteLibArmed ? ' danger' : '')}
            onClick={() => {
              if (!deleteLibArmed) {
                setDeleteLibArmed(true)
                return
              }
              deleteLocalLibrary()
              setDeleteLibArmed(false)
            }}
            onBlur={() => setDeleteLibArmed(false)}
          >
            {deleteLibArmed ? 'Tap again to delete library' : 'Delete library copy'}
          </button>
        </div>
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
        {s.source === 'ytmusic' && (
          <label className="set-field" style={{ marginTop: 8 }}>
            <span>YouTube Data API key (optional)</span>
            <input
              type="password"
              aria-label="YouTube Data API v3 key"
              placeholder="Built-in search active — paste key to override"
              value={s.ytApiKey || ''}
              onChange={(e) => s.setYtApiKey(e.target.value)}
              autoComplete="off"
            />
          </label>
        )}
        <p className="set-note">
          {s.source === 'ytmusic'
            ? BROWSE_ONLY_NOTE
            : 'JioSaavn provides both the catalogue and the audio, on every device.'}
        </p>
      </div>

      <div className="set-sec">
        <div className="set-head">
          <Icon name="info" size={16} />
          <span>Capabilities</span>
        </div>
        <p className="set-note">
          Audio streams natively from {SOURCE.label} and YouTube Music — up to {SOURCE.maxKbps} kbps{' '}
          {SOURCE.format}, with YouTube items streamed strictly as pure audio tracks.{' '}
          {caps.available} of {caps.total} capabilities below are active.
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
                {f.status !== STATUS.available && f.status !== STATUS.strength && (
                  <span className="cap-detail">{f.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <InstallSection />

      {openShareToVibex && (
        <div className="set-sec">
          <div className="set-head">
            <Icon name="link" size={16} />
            <span>Share to VIBEX (Cross-Device)</span>
          </div>
          <p className="set-note">
            Share songs, albums, or playlists from YouTube, YT Music, Spotify, JioSaavn, or Apple
            Music directly into VIBEX across Android, iPhone/iPad, Windows, and macOS.
          </p>
          <div className="set-row" style={{ marginTop: 8 }}>
            <span className="set-label">Open link &amp; OS setup</span>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => openShareToVibex()}
            >
              Open Share to VIBEX
            </button>
          </div>
        </div>
      )}

      <div className="set-sec">
        <div className="set-head">
          <Icon name="info" size={16} />
          <span>Independent service notice</span>
        </div>
        <p className="set-note">
          VIBEX is an independent application and is not affiliated with, endorsed by, or sponsored
          by Google, YouTube, YouTube Music, JioSaavn, or any music provider.
        </p>
      </div>
    </div>
  )
}
