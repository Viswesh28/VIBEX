import { useCallback, useEffect, useMemo, useState } from 'react'
import { probeApi } from './lib/api.js'
import { dlUrlFor } from './lib/song.js'
import { isNative } from './lib/config.js'
import { decodeHtml } from './lib/format.js'
import { isLocalOrigin } from './lib/platform.js'

import { ArtistView } from './components/ArtistView.jsx'
import { DetailView } from './components/DetailView.jsx'
import { FeedView } from './components/FeedView.jsx'
import { FullPlayer } from './components/FullPlayer.jsx'
import { Icon } from './components/Icon.jsx'
import { LibraryView } from './components/LibraryView.jsx'
import { LyricsOverlay } from './components/LyricsOverlay.jsx'
import { NowPlaying } from './components/NowPlaying.jsx'
import { PlayerBar } from './components/PlayerBar.jsx'
import { PlaylistModal } from './components/PlaylistModal.jsx'
import { PlaylistView } from './components/PlaylistView.jsx'
import { SearchView } from './components/SearchView.jsx'
import { Sidebar } from './components/Sidebar.jsx'
import { MobileNav } from './components/MobileNav.jsx'
import { StatsView } from './components/StatsView.jsx'
import { TasteView } from './components/TasteView.jsx'
import { Chips, TopBar } from './components/TopBar.jsx'
import { YouTubeEmbed } from './components/YouTubeEmbed.jsx'

import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js'
import { useMediaSession } from './hooks/useMediaSession.js'
import { useAndroidBack } from './hooks/useAndroidBack.js'
import { useSleepTimer } from './hooks/useSleepTimer.js'
import { usePlayerClock, usePlayerTransport } from './state/PlayerContext.jsx'
import { useSettings } from './state/SettingsContext.jsx'
import { useStatus } from './state/StatusContext.jsx'
import { useUI } from './state/UIContext.jsx'

function MediaSessionBridge({ current, isPlaying, dataSaver, actions }) {
  const clock = usePlayerClock()
  useMediaSession({ current, isPlaying, clock, dataSaver, actions })
  return null
}

export default function App() {
  const [apiOnline, setApiOnline] = useState(null)
  const [checking, setChecking] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [heading, setHeading] = useState({ title: 'Listen Now', count: '' })

  const { status, setStatus } = useStatus()
  const {
    current, currentQuality, isPlaying,
    togglePlay, nextTrack, prevTrack, seekBy, seekTo, pause, resumeFromSystem,
    setSleepGain,
  } = usePlayerTransport()
  const { dataSaver } = useSettings()
  const {
    view, back, canGoBack, navigate, searchQuery, searchTab,
    plModal, fullOpen, setFullOpen, lyricsOpen, setLyricsOpen, closePlaylistModal,
  } = useUI()

  // The timer fades over the last 20s rather than cutting: see lib/sleep.js.
  const sleep = useSleepTimer(
    useCallback(() => {
      pause()
      setStatus('Sleep timer stopped playback.')
    }, [pause, setStatus]),
    setSleepGain
  )

  // The failure advice has to match where the app is actually running: the
  // native shell and the deployed site have no local server to start, and a
  // phone that is offline needs a different sentence from a dev machine whose
  // gateway is down.
  const checkApi = useCallback(() => {
    setChecking(true)
    return probeApi().then((ok) => {
      setApiOnline(ok)
      setChecking(false)
      if (ok) return
      if (isNative())
        setStatus('Cannot reach JioSaavn. Check your internet connection and tap Retry.', true)
      else if (typeof navigator !== 'undefined' && navigator.onLine === false)
        setStatus('You are offline. Your saved library still works; reconnect to stream.', true)
      else if (isLocalOrigin())
        setStatus(
          'The local API is unavailable. Start jiosaavn-api on port 3001 and the UI gateway on port 8000.',
          true
        )
      else
        setStatus('The music service is not responding. Check your connection and tap Retry.', true)
    })
  }, [setStatus])

  useEffect(() => {
    checkApi()
  }, [checkApi])

  // An installed app can sit backgrounded for hours. When the connection comes
  // back, retry the probe instead of leaving the user on the offline screen.
  useEffect(() => {
    const onOnline = () => {
      if (apiOnline === false) checkApi()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [apiOnline, checkApi])

  // Escape closes the top-most layer only.
  const onEscape = useCallback(() => {
    if (plModal) closePlaylistModal()
    else if (lyricsOpen) setLyricsOpen(false)
    else if (fullOpen) setFullOpen(false)
  }, [plModal, lyricsOpen, fullOpen, closePlaylistModal, setLyricsOpen, setFullOpen])

  // Lockscreen / notification controls. Essential once this runs on a phone,
  // and a genuine upgrade for desktop media keys too.
  const mediaActions = useMemo(
    () => ({
      // The system play button must recover a torn-down iOS audio session, not
      // just call play() on a dead element.
      play: () => resumeFromSystem(),
      pause,
      next: nextTrack,
      prev: prevTrack,
      seekBy,
      seekTo,
    }),
    [resumeFromSystem, pause, nextTrack, prevTrack, seekBy, seekTo]
  )

  const backActions = useMemo(
    () => ({ closeDrawer: () => setDrawer(false), closePlaylistModal, setLyricsOpen, setFullOpen, back }),
    [closePlaylistModal, setLyricsOpen, setFullOpen, back]
  )
  useAndroidBack({ drawer, plModal, lyricsOpen, fullOpen, canGoBack, actions: backActions })

  useKeyboardShortcuts({
    onToggle: togglePlay,
    onNext: nextTrack,
    onPrev: prevTrack,
    onSeek: seekBy,
    onEscape,
  })

  // An overlay owns the scroll lock while it is up.
  useEffect(() => {
    const locked = fullOpen || lyricsOpen
    document.body.style.overflow = locked ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [fullOpen, lyricsOpen])

  const onTitle = useCallback((title, count) => setHeading({ title, count: count || '' }), [])
  const onCount = useCallback((count) => setHeading((h) => ({ ...h, count })), [])

  useEffect(() => {
    if (view.kind === 'feed') setHeading({ title: 'Listen Now', count: '' })
    else if (view.kind === 'search')
      setHeading({
        title: `${view.tab[0].toUpperCase() + view.tab.slice(1)} for “${view.query}”`,
        count: '',
      })
  }, [view])

  /**
   * Opening in a named window keeps the click gesture intact, so Chrome treats
   * the response as a real user-initiated download rather than a popup.
   */
  const onDownload = useCallback(
    async (e) => {
      e?.preventDefault()
      if (!current) {
        setStatus('No downloadable link for this song — replay it and retry.', true)
        return
      }
      // Android has no gateway to ask, so it fetches, tags and saves the file
      // itself using the very same tagger the server uses.
      if (isNative()) {
        try {
          const { downloadSongNative } = await import('./lib/download.js')
          const r = await downloadSongNative(current, currentQuality, (stage) =>
            setStatus(`${stage} ${decodeHtml(current.name)}`)
          )
          const mb = (r.bytes / 1048576).toFixed(1)
          setStatus(`Saved ${r.name} (${mb} MB${r.tagged ? ', tagged' : ''}) to Documents/VIBEX`)
        } catch (err) {
          setStatus(err?.message || 'Download failed.', true)
        }
        return
      }
      const url = dlUrlFor(current, currentQuality)
      const w = window.open(url, 'vibex_dl')
      if (!w) setStatus('Popup blocked — right-click the download button and choose “Save link as…”.', true)
      else setStatus(`Downloading: ${decodeHtml(current.name)} — check your Downloads folder.`)
    },
    [current, currentQuality, setStatus]
  )

  // Library, playlists and stats live entirely on this device, so an installed
  // app is still useful with no connection. Only catalogue views need the API.
  const offlineSafe =
    view.kind === 'library' || view.kind === 'myplaylist' || view.kind === 'stats'

  const renderView = () => {
    if (apiOnline === false && !offlineSafe)
      return (
        <div className="empty-lib">
          <span className="empty-icon" aria-hidden="true">
            <Icon name="alert" size={28} />
          </span>
          <p>{isNative() || !isLocalOrigin() ? 'No connection' : 'API offline'}</p>
          <span>
            {isNative()
              ? 'VIBEX needs the internet to reach JioSaavn. Reconnect, then try again.'
              : isLocalOrigin()
                ? 'Start jiosaavn-api on port 3001, then reload.'
                : 'VIBEX could not reach the music service. Check your connection, then try again.'}
          </span>
          <button className="btn-ghost retry-btn" onClick={checkApi} disabled={checking}>
            {checking ? 'Checking…' : 'Retry'}
          </button>
          <button className="btn-ghost retry-btn" onClick={() => navigate({ kind: 'library' })}>
            Open your library
          </button>
        </div>
      )
    switch (view.kind) {
      case 'search':
        return <SearchView query={view.query} tab={view.tab} onCount={onCount} />
      case 'detail':
        return <DetailView type={view.type} id={view.id} onTitle={onTitle} />
      case 'artist':
        return <ArtistView id={view.id} onTitle={onTitle} />
      case 'library':
        return <LibraryView onTitle={onTitle} />
      case 'myplaylist':
        return <PlaylistView id={view.id} onTitle={onTitle} />
      case 'taste':
        return <TasteView onTitle={onTitle} />
      case 'stats':
        return <StatsView onTitle={onTitle} />
      case 'feed':
      default:
        return <FeedView />
    }
  }

  const showChips = view.kind === 'feed' || view.kind === 'search'
  const showHeading = view.kind === 'feed' || view.kind === 'search'
  const showBack = canGoBack() && (view.kind === 'detail' || view.kind === 'artist')

  return (
    <>
      <div id="app">
        <Sidebar apiOnline={apiOnline} open={drawer} onClose={() => setDrawer(false)} />
        {drawer && (
          <div className="drawer-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
        )}
        <div id="mainCol">
          <TopBar sleep={sleep} onMenu={() => setDrawer(true)} />
          <main id="content">
            {showChips && <Chips />}
            {showBack && (
              <button id="backBtn" onClick={back}>
                <Icon name="chevronLeft" size={15} />
                Back
              </button>
            )}
            {showHeading && (
              <div className="page-head">
                <h2 id="resultTitle">
                  {heading.title} <span id="resultCount">{heading.count}</span>
                </h2>
              </div>
            )}
            <div id="status" className={status.err ? 'error' : ''} role="status">
              {status.msg}
            </div>
            <div id="results">{renderView()}</div>
          </main>
        </div>
        <NowPlaying onDownload={onDownload} />
      </div>

      <MobileNav />
      <PlayerBar onDownload={onDownload} />
      <FullPlayer onDownload={onDownload} />
      <LyricsOverlay />
      <PlaylistModal />
      <YouTubeEmbed />
      <MediaSessionBridge
        current={current}
        isPlaying={isPlaying}
        dataSaver={dataSaver}
        actions={mediaActions}
      />
    </>
  )
}
