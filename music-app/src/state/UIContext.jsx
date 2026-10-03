import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

const Ctx = createContext(null)
export const useUI = () => useContext(Ctx)

/**
 * View routing and the shared overlays.
 *
 * Views are plain objects, e.g. { kind: 'album', id, title }. A small history
 * stack replaces the pre-React build's single mutable `backFn`, which could
 * only ever remember one step back.
 */
export function UIProvider({ children }) {
  const [view, setView] = useState({ kind: 'feed' })
  const [searchQuery, setSearchQuery] = useState('anirudh hits')
  const [searchTab, setSearchTab] = useState('songs')
  const [plModal, setPlModal] = useState(null)
  const [fullOpen, setFullOpen] = useState(false)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const history = useRef([])

  const navigate = useCallback((next, { push = true } = {}) => {
    setView((prev) => {
      if (push && prev.kind !== next.kind) history.current.push(prev)
      else if (push) history.current.push(prev)
      if (history.current.length > 20) history.current.shift()
      return next
    })
  }, [])

  const back = useCallback(() => {
    const prev = history.current.pop()
    setView(prev || { kind: 'feed' })
  }, [])

  const canGoBack = () => history.current.length > 0

  const search = useCallback(
    (query, tab) => {
      const q = (query ?? '').trim()
      if (q) setSearchQuery(q)
      if (tab) setSearchTab(tab)
      navigate({ kind: 'search', query: q || 'anirudh hits', tab: tab || searchTab })
    },
    [navigate, searchTab]
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
      searchQuery, setSearchQuery, searchTab, setSearchTab, search,
      plModal, openPlaylistModal, openNewPlaylistModal, openRenameModal, closePlaylistModal,
      fullOpen, setFullOpen,
      lyricsOpen, setLyricsOpen,
    }),
    [
      view, navigate, back, searchQuery, searchTab, search, plModal,
      openPlaylistModal, openNewPlaylistModal, openRenameModal, closePlaylistModal,
      fullOpen, lyricsOpen,
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
