import { useCallback, useEffect, useMemo, useState } from 'react'
import { probeApi } from './lib/api.js'
import { dlUrlFor } from './lib/song.js'
import { isNative } from './lib/config.js'
import { decodeHtml } from './lib/format.js'

import { ArtistView } from './components/ArtistView.jsx'
import { DetailView } from './components/DetailView.jsx'
import { FeedView } from './components/FeedView.jsx'
import { FullPlayer } from './components/FullPlayer.jsx'
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
import { Chips, TopBar } from './components/TopBar.jsx'

import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js'
import { useMediaSession } from './hooks/useMediaSession.js'
import { useAndroidBack } from './hooks/useAndroidBack.js'
import { useSleepTimer } from './hooks/useSleepTimer.js'
import { usePlayer } from './state/PlayerContext.jsx'
import { useSettings } from './state/SettingsContext.jsx'
import { useStatus } from './state/StatusContext.jsx'
import { useUI } from './state/UIContext.jsx'

export default function App() {
  const [apiOnline, setApiOnline] = useState(null)
  const [checking, setChecking] = useState(false)
  const [drawer, setDrawer] = useState(false)
  // Native builds with no backend address can't probe anything yet.
  const [heading, setHeading] = useState({ title: 'Home', count: '' })

  const { status, setStatus } = useStatus()
  const {
    current, currentQuality, isPlaying, clock,
    togglePlay, nextTrack, prevTrack, seekBy, seekTo, play, pause,
  } = usePlayer()
  const { dataSaver } = useSettings()
  const {
    view, back, canGoBack, searchQuery, searchTab,
    plModal, fullOpen, setFullOpen, lyricsOpen, setLyricsOpen, closePlaylistModal,
  } = useUI()

  const sleep = useSleepTimer(
    useCallback(() => {
      pause()
      setStatus('😴 Sleep timer stopped playback.')
    }, [pause, setStatus])
  )

  // The standalone Android build has no gateway to start, so the failure
  // advice has to differ by platform — telling a phone user to run a server
  // on port 3001 is nonsense.
  const checkApi = useCallback(() => {
    setChecking(true)
    return probeApi().then((ok) => {
      setApiOnline(ok)
      setChecking(false)
      if (!ok)
        setStatus(
          isNative()
            ? 'Cannot reach JioSaavn. Check your internet connection and tap Retry.'
            : 'The local API is unavailable. Start jiosaavn-api on port 3001 and the UI gateway on port 8000.',
          true
        )
    })
  }, [setStatus])

  useEffect(() => {
    checkApi()
  }, [checkApi])

  // Escape closes the top-most layer only.
  const onEscape = useCallback(() => {
    if (plModal) closePlaylistModal()
    else if (lyricsOpen) setLyricsOpen(false)
    else if (fullOpen) setFullOpen(false)
  }, [plModal, lyricsOpen, fullOpen, closePlaylistModal, setLyricsOpen, setFullOpen])

  // Lockscreen / notification controls. Essential once this runs on a phone,
  // and a genuine upgrade for desktop media keys too.
  const mediaActions = useMemo(
    () => ({ play, pause, next: nextTrack, prev: prevTrack, seekBy, seekTo }),
    [play, pause, nextTrack, prevTrack, seekBy, seekTo]
  )
  useMediaSession({ current, isPlaying, clock, dataSaver, actions: mediaActions })

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
    if (view.kind === 'feed') setHeading({ title: 'Home', count: '' })
    else if (view.kind === 'search')
      setHeading({
        title: `${view.tab[0].toUpperCase() + view.tab.slice(1)} for "${view.query}"`,
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
      if (!w) setStatus("Popup blocked — right-click the ⬇ button and choose 'Save link as…'.", true)
      else setStatus(`Downloading: ${decodeHtml(current.name)} — check your Downloads folder.`)
    },
    [current, currentQuality, setStatus]
  )

  const renderView = () => {
    if (apiOnline === false)
      return (
        <div className="empty-lib">
          <b>🔌</b>
          <p>{isNative() ? 'No connection' : 'API offline'}</p>
          <span>
            {isNative()
              ? 'VIBEX needs the internet to reach JioSaavn. Reconnect, then try again.'
              : 'Start jiosaavn-api on port 3001, then reload.'}
          </span>
          <button className="ghost retry-btn" onClick={checkApi} disabled={checking}>
            {checking ? 'Checking…' : 'Retry'}
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
      case 'stats':
        return <StatsView onTitle={onTitle} />
      case 'feed':
      default:
        return <FeedView />
    }
  }

  const showChips = view.kind === 'feed' || view.kind === 'search'
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
              <button className="ghost" style={{ display: 'inline-block' }} onClick={back}>
                ← Back
              </button>
            )}
            <h2 id="resultTitle">
              {heading.title} <span id="resultCount">{heading.count}</span>
            </h2>
            <div id="status" className={status.err ? 'error' : ''}>
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
    </>
  )
}
