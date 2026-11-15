import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { store } from '../lib/storage.js'
import { buildPathForView, parseRouteFromLocation } from '../lib/shareUrl.js'
import {
  isSupportedMusicUrl,
  parseSharedInput,
  readIncomingShareFromLocation,
  stripConsumedShareParams,
  subscribeLaunchQueueShare,
} from '../lib/shareTarget.js'
import { subscribeNativeShare } from '../lib/native.js'

const Ctx = createContext(null)
export const useUI = () => useContext(Ctx)

const RECENT_SEARCH_KEY = 'svRecentSearches'

export function UIProvider({ children }) {
  const initialRoute = useMemo(() => parseRouteFromLocation(), [])
  const initialShare = useMemo(() => readIncomingShareFromLocation(), [])

  const [view, setView] = useState(() => initialRoute.view)
  const [deepLinkPlay] = useState(() =>
    initialRoute.playTrackId ? { id: initialRoute.playTrackId, sec: initialRoute.seekSec } : null
  )
  const [searchQuery, setSearchQuery] = useState(() =>
    initialRoute.view.kind === 'search' ? initialRoute.view.query || '' : ''
  )
  const [searchTab, setSearchTab] = useState(() =>
    initialRoute.view.kind === 'search' ? initialRoute.view.tab || 'songs' : 'songs'
  )
  const [recentSearches, setRecentSearches] = useState(() => {
    const v = store.getJSON(RECENT_SEARCH_KEY, [])
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, 10) : []
  })
  const [plModal, setPlModal] = useState(null)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [shareTargetState, setShareTargetState] = useState(() =>
    initialShare
      ? { open: true, payload: initialShare.openLauncherOnly ? null : initialShare.parsed }
      : { open: false, payload: null }
  )
  const [cmdOpen, setCmdOpen] = useState(false)
  const [dspOpen, setDspOpen] = useState(false)
  const [fullOpen, setFullOpen] = useState(false)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const history = useRef([])

  const openShareToVibex = useCallback((payload = null) => {
    setShareTargetState({ open: true, payload })
  }, [])

  const closeShareToVibex = useCallback(() => {
    setShareTargetState({ open: false, payload: null })
  }, [])

  // Strip transient `?vibex_share=1&share_url=...` after cold-launch intake and subscribe to
  // live zero-reload cross-device intake channels (`window.launchQueue`, Native Android Intent,
  // and Global Smart Music-Link Paste `Ctrl+V` / `Cmd+V`).
  useEffect(() => {
    if (initialShare) {
      stripConsumedShareParams()
    }

    const unsubLaunchQueue = subscribeLaunchQueueShare((hit) => {
      openShareToVibex(hit.openLauncherOnly ? null : hit.parsed)
      stripConsumedShareParams()
    })

    let unsubNative = () => {}
    subscribeNativeShare((rawPayload) => {
      const parsed = parseSharedInput(rawPayload)
      if (parsed) openShareToVibex(parsed)
    }).then((fn) => {
      unsubNative = fn
    })

    const onGlobalPaste = (event) => {
      const target = event.target
      const tag = target?.tagName
      const isEditable =
        target?.isContentEditable ||
        tag === 'TEXTAREA' ||
        (tag === 'INPUT' && target.id !== 'searchInput')
      if (isEditable) return

      const pasted = event.clipboardData?.getData?.('text/plain')?.trim() || ''
      if (!pasted || !isSupportedMusicUrl(pasted)) return

      const parsed = parseSharedInput({ url: pasted, text: pasted })
      if (!parsed) return
      event.preventDefault()
      if (target?.id === 'searchInput') setSearchQuery('')
      openShareToVibex(parsed)
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('paste', onGlobalPaste)
    }

    return () => {
      unsubLaunchQueue()
      unsubNative()
      if (typeof window !== 'undefined') {
        window.removeEventListener('paste', onGlobalPaste)
      }
    }
  }, [initialShare, openShareToVibex])

  const syncBrowserUrl = useCallback((nextView, replace = false) => {
    if (typeof window === 'undefined' || !window.history?.pushState) return
    try {
      const targetPath = buildPathForView(nextView)
      const curPath = window.location.pathname + window.location.search
      if (targetPath === curPath) return
      if (replace) window.history.replaceState({ vibexView: nextView }, '', targetPath)
      else window.history.pushState({ vibexView: nextView }, '', targetPath)
    } catch {
      /* ignore sandboxed history errors */
    }
  }, [])

  // Support native browser Back / Forward buttons seamlessly.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onPopState = (event) => {
      const restored = event.state?.vibexView || parseRouteFromLocation(window.location).view
      setView(restored)
      if (restored.kind === 'search') {
        setSearchQuery(restored.query || '')
        setSearchTab(restored.tab || 'songs')
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback(
    (next, { push = true } = {}) => {
      setView((prev) => {
        if (push) history.current.push(prev)
        if (history.current.length > 30) history.current.shift()
        return next
      })
      syncBrowserUrl(next, !push)
    },
    [syncBrowserUrl]
  )

  const back = useCallback(() => {
    const prev = history.current.pop() || { kind: 'feed' }
    setView(prev)
    syncBrowserUrl(prev, true)
  }, [syncBrowserUrl])

  const canGoBack = () => history.current.length > 0

  const addRecentSearch = useCallback((raw) => {
    const q = String(raw || '').trim()
    if (!q) return
    setRecentSearches((prev) => {
      const next = [q, ...prev.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 10)
      store.setJSON(RECENT_SEARCH_KEY, next)
      return next
    })
  }, [])

  const removeRecentSearch = useCallback((raw) => {
    const target = String(raw || '').trim().toLowerCase()
    setRecentSearches((prev) => {
      const next = prev.filter((x) => x.toLowerCase() !== target)
      store.setJSON(RECENT_SEARCH_KEY, next)
      return next
    })
  }, [])

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([])
    store.remove(RECENT_SEARCH_KEY)
  }, [])

  const search = useCallback(
    (query, tab) => {
      const q = (query ?? '').trim()
      // Smart cross-device UX: submitting any Spotify / YouTube / YT Music / JioSaavn link in
      // Search opens Share-to-VIBEX resolution directly instead of searching literal URL text.
      if (q && isSupportedMusicUrl(q)) {
        const parsed = parseSharedInput({ url: q, text: q })
        if (parsed) {
          setSearchQuery('')
          openShareToVibex(parsed)
          return
        }
      }
      if (q) {
        setSearchQuery(q)
        addRecentSearch(q)
      }
      const nextTab = tab || searchTab
      if (tab) setSearchTab(tab)
      navigate({ kind: 'search', query: q || 'anirudh hits', tab: nextTab })
    },
    [addRecentSearch, navigate, openShareToVibex, searchTab]
  )

  const openPlaylistModal = useCallback((song) => {
    setPlModal({ mode: 'add', song })
  }, [])
  const openNewPlaylistModal = useCallback(() => {
    setPlModal({ mode: 'new', song: null })
  }, [])
  const openRenameModal = useCallback((id, name) => {
    setPlModal({ mode: 'rename', id, name })
  }, [])
  const closePlaylistModal = useCallback(() => setPlModal(null), [])

  const value = useMemo(
    () => ({
      view, navigate, back, canGoBack,
      deepLinkPlay,
      searchQuery, setSearchQuery, searchTab, setSearchTab, search,
      recentSearches, addRecentSearch, removeRecentSearch, clearRecentSearches,
      plModal, openPlaylistModal, openNewPlaylistModal, openRenameModal, closePlaylistModal,
      importModalOpen, setImportModalOpen,
      shareTargetState, openShareToVibex, closeShareToVibex,
      cmdOpen, setCmdOpen,
      dspOpen, setDspOpen,
      fullOpen, setFullOpen,
      lyricsOpen, setLyricsOpen,
    }),
    [
      view, navigate, back, deepLinkPlay, searchQuery, searchTab, search,
      recentSearches, addRecentSearch, removeRecentSearch, clearRecentSearches,
      plModal, openPlaylistModal, openNewPlaylistModal, openRenameModal, closePlaylistModal,
      importModalOpen, shareTargetState, openShareToVibex, closeShareToVibex,
      cmdOpen, dspOpen, fullOpen, lyricsOpen,
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
