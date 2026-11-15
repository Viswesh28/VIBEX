import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiUrl } from '../lib/config.js'
import { decodeHtml } from '../lib/format.js'
import { promptInstall, subscribeInstall } from '../lib/install.js'
import {
  inspectCrossDeviceShareSupport,
  parseSharedInput,
} from '../lib/shareTarget.js'
import { artistsOf, imgOf } from '../lib/song.js'
import { Icon } from './Icon.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayerTransport } from '../state/PlayerContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

export function ShareToVibexModal() {
  const { shareTargetState, closeShareToVibex, navigate } = useUI()
  const {
    saveSongsAsPlaylist,
    likedIds,
    toggleLike,
    offlineIds,
    toggleOfflinePin,
  } = useLibrary()
  const {
    current,
    isPlaying,
    playFromList,
    playNext,
    addToQueue,
    startRadioFrom,
    seekTo,
  } = usePlayerTransport()
  const { setStatus } = useStatus()

  const [rawInput, setRawInput] = useState('')
  const [customName, setCustomName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [errMsg, setErrMsg] = useState('')
  const [autoPlayed, setAutoPlayed] = useState(false)
  const [copiedShortcut, setCopiedShortcut] = useState(false)
  const [canPromptInstall, setCanPromptInstall] = useState(false)
  const [installNote, setInstallNote] = useState('')
  const [setupExpanded, setSetupExpanded] = useState(false)

  const wasPlayingRef = useRef(false)
  const lastResolvedKeyRef = useRef('')

  const deviceInfo = useMemo(() => inspectCrossDeviceShareSupport(), [shareTargetState.open])
  const liveDetected = useMemo(
    () => (rawInput.trim() ? parseSharedInput({ url: rawInput.trim(), text: rawInput.trim() }) : null),
    [rawInput]
  )

  useEffect(
    () =>
      subscribeInstall((state) => {
        setCanPromptInstall(Boolean(state?.canPrompt))
      }),
    []
  )

  const resolveShareDescriptor = useCallback(
    async (descriptor, { allowAutoPlay = true } = {}) => {
      if (!descriptor) return
      setLoading(true)
      setErrMsg('')
      setResult(null)
      setAutoPlayed(false)

      const hadActivePlayback = Boolean(wasPlayingRef.current)

      try {
        // Native VIBEX deep links (`?play=...`)
        if (descriptor.kind === 'vibex' && descriptor.playId) {
          const rawId = String(descriptor.playId)
          const isYt = rawId.startsWith('yt:')
          const cleanId = isYt ? rawId.slice(3) : rawId
          const endpoint = isYt
            ? `/import-playlist?sourceUrl=${encodeURIComponent(`https://www.youtube.com/watch?v=${cleanId}`)}`
            : `/songs?ids=${encodeURIComponent(cleanId)}`
          const res = await fetch(apiUrl(endpoint))
          const json = await res.json()
          const song = isYt
            ? json?.data?.tracks?.[0] || null
            : json?.data?.[0] || json?.[0] || null
          if (!song?.id) throw new Error('Shared VIBEX track could not be loaded.')
          const data = {
            kind: 'track',
            name: song.name,
            source: isYt ? 'youtube' : 'jiosaavn',
            requestedCount: 1,
            matchedCount: 1,
            tracks: [song],
            seekSec: descriptor.seekSec || 0,
          }
          setResult(data)
          if (allowAutoPlay && !hadActivePlayback) {
            playFromList([song], 0)
            if (descriptor.seekSec > 0) setTimeout(() => seekTo(descriptor.seekSec), 450)
            setAutoPlayed(true)
            setStatus(`Playing shared song “${decodeHtml(song.name)}”.`)
          }
          return
        }

        const res = await fetch(apiUrl('/import-playlist'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: descriptor.url || '',
            text: descriptor.kind === 'query' ? descriptor.query || '' : '',
            hintTitle: descriptor.hintTitle || '',
          }),
        })
        const json = await res.json()
        if (!res.ok || !json?.success || !json?.data?.tracks?.length) {
          throw new Error(json?.message || 'Could not find playable audio for that shared link.')
        }

        const data = {
          ...json.data,
          providerLabel: descriptor.providerLabel || json.data.source || 'Shared Link',
          seekSec: descriptor.seekSec || 0,
        }
        setResult(data)
        setCustomName(data.name || 'Shared Playlist')

        const isSingleTrack =
          (data.kind === 'track' || descriptor.kind === 'track') && data.tracks.length === 1

        if (isSingleTrack && allowAutoPlay && !hadActivePlayback) {
          playFromList(data.tracks, 0)
          if (data.seekSec > 0) {
            setTimeout(() => seekTo(data.seekSec), 450)
          }
          setAutoPlayed(true)
          setStatus(`Playing “${decodeHtml(data.tracks[0].name)}” from ${data.providerLabel}.`)
        } else if (isSingleTrack) {
          setStatus(
            `Ready: “${decodeHtml(data.tracks[0].name)}” — choose Play Now, Play Next, or Add to Queue.`
          )
        } else {
          setStatus(`Matched ${data.tracks.length} playable tracks from ${data.providerLabel}.`)
        }
      } catch (err) {
        setErrMsg(err?.message || 'Could not resolve that shared link.')
      } finally {
        setLoading(false)
      }
    },
    [playFromList, seekTo, setStatus]
  )

  // Automatically process incoming OS Share Sheet / LaunchQueue / Paste payloads.
  useEffect(() => {
    if (!shareTargetState.open) {
      lastResolvedKeyRef.current = ''
      return
    }
    wasPlayingRef.current = Boolean(current && isPlaying)
    const incoming = shareTargetState.payload
    if (!incoming) {
      setResult(null)
      setErrMsg('')
      return
    }
    const key = `${incoming.kind}:${incoming.url || incoming.query || ''}:${incoming.seekSec || 0}`
    if (lastResolvedKeyRef.current === key) return
    lastResolvedKeyRef.current = key
    setRawInput(incoming.originalUrl || incoming.url || incoming.query || '')
    resolveShareDescriptor(incoming, { allowAutoPlay: true })
  }, [shareTargetState, current, isPlaying, resolveShareDescriptor])

  if (!shareTargetState.open) return null

  const close = () => {
    closeShareToVibex()
    setErrMsg('')
  }

  const handleManualSubmit = (e) => {
    e?.preventDefault()
    const parsed = parseSharedInput({ url: rawInput.trim(), text: rawInput.trim() })
    if (!parsed) {
      setErrMsg('Paste a YouTube, YT Music, Spotify, JioSaavn, or Apple Music link or song title.')
      return
    }
    wasPlayingRef.current = Boolean(current && isPlaying)
    resolveShareDescriptor(parsed, { allowAutoPlay: true })
  }

  const handleReadClipboard = async () => {
    setErrMsg('')
    if (!navigator.clipboard?.readText) {
      setErrMsg('Clipboard read requires pasting into the box below on this browser (Tap & Paste).')
      return
    }
    try {
      const clip = (await navigator.clipboard.readText())?.trim() || ''
      if (!clip) {
        setErrMsg('Your clipboard is empty — copy a song or playlist link first.')
        return
      }
      setRawInput(clip)
      const parsed = parseSharedInput({ url: clip, text: clip })
      if (parsed) {
        wasPlayingRef.current = Boolean(current && isPlaying)
        resolveShareDescriptor(parsed, { allowAutoPlay: true })
      }
    } catch {
      setErrMsg('Browser blocked automatic clipboard access — tap the box below and Paste.')
    }
  }

  const handleCopyIosShortcutUrl = async () => {
    try {
      await navigator.clipboard.writeText(deviceInfo.iosShortcutBaseUrl)
      setCopiedShortcut(true)
      setTimeout(() => setCopiedShortcut(false), 2500)
    } catch {
      /* ignore */
    }
  }

  const handleInstallPwa = async () => {
    const out = await promptInstall()
    if (out === 'accepted') setInstallNote('VIBEX installed — it will now appear in your Share menu.')
    else if (out === 'dismissed') setInstallNote('Install dismissed — install anytime from your browser menu.')
    else setInstallNote('Open your browser menu (⋮) and tap “Install app” / “Add to Home screen”.')
  }

  const singleSong =
    result?.tracks?.length === 1 && result.kind === 'track' ? result.tracks[0] : null

  return (
    <div id="plModal" className="open" onClick={close}>
      <div
        className="modal-card dsp-modal-card share-vibex-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Share to VIBEX"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head-row">
          <h3>
            <Icon name="link" size={18} /> Share to VIBEX
          </h3>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close Share to VIBEX dialog"
            onClick={close}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <p className="set-note" style={{ marginBottom: 10 }}>
          Open any <b>YouTube</b>, <b>YT Music</b>, <b>Spotify</b>, <b>JioSaavn</b>, or{' '}
          <b>Apple Music</b> song, album, or playlist directly inside VIBEX as pure high-bitrate audio.
        </p>

        {/* Fast 1-Tap Clipboard + Smart Input Form */}
        <form onSubmit={handleManualSubmit} className="share-intake-form">
          <div className="share-input-row">
            <input
              type="text"
              aria-label="Shared song or playlist link"
              placeholder="Paste YouTube, YT Music, Spotify, or JioSaavn link…"
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
            />
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Resolving…' : 'Open'}
            </button>
          </div>

          <div className="share-quick-row">
            <button
              type="button"
              className="btn-ghost"
              onClick={handleReadClipboard}
            >
              <Icon name="link" size={14} /> Paste from Clipboard
            </button>
            {liveDetected && (
              <span className="share-detected-pill">
                <Icon name="sparkle" size={12} /> {liveDetected.providerLabel} ·{' '}
                {liveDetected.kind === 'track' ? 'Single Track' : liveDetected.subKind || 'Collection'}
              </span>
            )}
          </div>
        </form>

        {loading && (
          <div className="share-loading-card" role="status">
            <span className="share-pulse-dot" aria-hidden="true" />
            <span>Matching high-quality studio stream for your shared item…</span>
          </div>
        )}

        {errMsg && (
          <p className="set-note" style={{ color: 'var(--accent)', marginTop: 10 }}>
            {errMsg}
          </p>
        )}

        {/* Resolved Single Track Card */}
        {!loading && singleSong && (
          <div className="share-resolved-card">
            <div className="share-track-hero">
              <img src={imgOf(singleSong, false)} alt="" />
              <div className="share-track-info">
                <span className="share-badge-tag">
                  {result.providerLabel || result.source} · Ready in VIBEX
                </span>
                <h4>{decodeHtml(singleSong.name)}</h4>
                <p>{decodeHtml(artistsOf(singleSong))}</p>
              </div>
            </div>

            {deviceInfo.autoplayMayRequireTap && !isPlaying && (
              <p className="set-note" style={{ marginTop: 8, marginBottom: 4 }}>
                Tap <b>Play Now</b> below to start audio on iPhone / iPad.
              </p>
            )}

            <div className="share-action-grid">
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  playFromList([singleSong], 0)
                  if (result.seekSec > 0) setTimeout(() => seekTo(result.seekSec), 450)
                  close()
                }}
              >
                <Icon name="play" size={15} />{' '}
                {autoPlayed && isPlaying ? 'Playing Now — Keep Listening' : 'Play Now'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  playNext(singleSong)
                  setStatus(`Playing next: “${decodeHtml(singleSong.name)}”.`)
                  close()
                }}
              >
                <Icon name="queueNext" size={15} /> Play Next
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  addToQueue(singleSong)
                  setStatus(`Added “${decodeHtml(singleSong.name)}” to queue.`)
                  close()
                }}
              >
                <Icon name="queueAdd" size={15} /> Add to Queue
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  startRadioFrom(singleSong)
                  close()
                }}
              >
                <Icon name="radio" size={15} /> Start Song Radio
              </button>
              <button
                type="button"
                className={'btn-ghost' + (likedIds?.has(singleSong.id) ? ' active' : '')}
                onClick={() => toggleLike(singleSong)}
              >
                <Icon name={likedIds?.has(singleSong.id) ? 'heartFilled' : 'heart'} size={15} />{' '}
                {likedIds?.has(singleSong.id) ? 'Saved in Liked' : 'Save to Liked'}
              </button>
              <button
                type="button"
                className={'btn-ghost' + (offlineIds?.has(singleSong.id) ? ' active' : '')}
                onClick={() => toggleOfflinePin(singleSong)}
              >
                <Icon name="pin" size={15} />{' '}
                {offlineIds?.has(singleSong.id) ? 'Pinned Offline' : 'Pin Offline'}
              </button>
            </div>
          </div>
        )}

        {/* Resolved Playlist / Album / Artist Collection Card */}
        {!loading && result && !singleSong && result.tracks?.length > 0 && (
          <div className="import-preview" style={{ marginTop: 12 }}>
            <div className="import-preview-head" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span>
                Matched <b>{result.matchedCount}</b> tracks from{' '}
                <b>{result.providerLabel || result.source}</b>
              </span>
              <input
                type="text"
                aria-label="Shared playlist name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Playlist name"
                style={{ minWidth: 180, flex: '1 1 180px' }}
              />
            </div>

            <div className="share-action-grid" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  playFromList(result.tracks, 0)
                  setStatus(`Playing ${result.tracks.length} shared tracks.`)
                  close()
                }}
              >
                <Icon name="play" size={15} /> Play All Now
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  const title = customName.trim() || result.name || 'Shared Playlist'
                  const plId = saveSongsAsPlaylist(title, result.tracks)
                  playFromList(result.tracks, 0)
                  setStatus(`Imported & playing “${title}” (${result.tracks.length} tracks).`)
                  close()
                  navigate({ kind: 'myplaylist', id: plId })
                }}
              >
                <Icon name="import" size={15} /> Import &amp; Play
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  result.tracks.forEach((s) => addToQueue(s))
                  setStatus(`Added ${result.tracks.length} tracks to queue.`)
                  close()
                }}
              >
                <Icon name="queueAdd" size={15} /> Queue All
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  const title = customName.trim() || result.name || 'Shared Playlist'
                  const plId = saveSongsAsPlaylist(title, result.tracks)
                  setStatus(`Saved “${title}” (${result.tracks.length} tracks).`)
                  close()
                  navigate({ kind: 'myplaylist', id: plId })
                }}
              >
                <Icon name="plus" size={15} /> Save Playlist Only
              </button>
            </div>

            <ul className="import-track-list">
              {result.tracks.slice(0, 25).map((song, idx) => (
                <li key={`${song.id}-${idx}`}>
                  <img src={imgOf(song, true)} alt="" loading="lazy" />
                  <span className="imp-meta">
                    <b>{decodeHtml(song.name)}</b>
                    <small>{decodeHtml(artistsOf(song))}</small>
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Play ${decodeHtml(song.name)}`}
                    onClick={() => playFromList(result.tracks, idx)}
                  >
                    <Icon name="play" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Cross-Device OS Share Sheet Compatibility & 1-Tap Setup Section */}
        <div className="share-device-box">
          <button
            type="button"
            className="share-device-toggle"
            aria-expanded={setupExpanded || (!singleSong && !result)}
            onClick={() => setSetupExpanded((v) => !v)}
          >
            <span>
              <Icon name="check" size={14} /> {deviceInfo.headline}
            </span>
            <Icon
              name={setupExpanded || (!singleSong && !result) ? 'chevronUp' : 'chevronDown'}
              size={15}
            />
          </button>

          {(setupExpanded || (!singleSong && !result)) && (
            <div className="share-device-body">
              <p className="set-note">{deviceInfo.detail}</p>

              {/* Android / Desktop PWA Install Action */}
              {!deviceInfo.standalone && !deviceInfo.native && !deviceInfo.ios && (
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {canPromptInstall ? (
                    <button type="button" className="btn-primary" onClick={handleInstallPwa}>
                      <Icon name="download" size={14} /> Install VIBEX for Phone Share Sheet
                    </button>
                  ) : (
                    <span className="set-note">
                      Tip: Install VIBEX from your browser menu (<b>Install app</b>) so VIBEX
                      appears natively in Android &amp; Windows Share menus — or press{' '}
                      <b>Ctrl+V / Cmd+V</b> anywhere.
                    </span>
                  )}
                  {installNote && <p className="set-note">{installNote}</p>}
                </div>
              )}

              {/* iOS / iPadOS Native Share Sheet Shortcut Helper */}
              <div className="share-ios-helper">
                <div className="share-ios-head">
                  <b>iPhone / iPad Share Sheet &amp; Universal URL Endpoint</b>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleCopyIosShortcutUrl}
                  >
                    {copiedShortcut ? 'Copied URL!' : 'Copy Shortcut URL'}
                  </button>
                </div>
                <p className="set-note" style={{ marginTop: 4 }}>
                  On iPhone/iPad: open Apple <b>Shortcuts</b> → tap <b>+</b> → enable{' '}
                  <b>Show in Share Sheet</b> (URLs &amp; Text) → add action <b>Open URLs</b> with{' '}
                  <code>{deviceInfo.iosShortcutBaseUrl}[Shortcut Input]</code>. Every Share menu in
                  Spotify, YouTube &amp; Safari will send links straight into VIBEX.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
