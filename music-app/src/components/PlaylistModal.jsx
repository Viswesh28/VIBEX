import { useEffect, useRef, useState } from 'react'
import { decodeHtml } from '../lib/format.js'
import { useLibrary } from '../state/LibraryContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

export function PlaylistModal() {
  const { playlists, createPlaylist, renamePlaylist, addToPlaylist } = useLibrary()
  const { plModal, closePlaylistModal } = useUI()
  const { setStatus } = useStatus()
  const [name, setName] = useState('')
  const inputRef = useRef(null)

  const open = !!plModal
  const mode = plModal?.mode || 'add'

  useEffect(() => {
    if (!open) return
    setName(mode === 'rename' ? plModal.name : '')
    const t = setTimeout(() => {
      inputRef.current?.focus()
      if (mode === 'rename') inputRef.current?.select()
    }, 50)
    return () => clearTimeout(t)
  }, [open, mode, plModal])

  if (!open) return null

  const title =
    mode === 'rename'
      ? 'Rename playlist'
      : mode === 'new'
        ? 'New playlist'
        : plModal.song
          ? `Add "${decodeHtml(plModal.song.name)}" to…`
          : 'Your playlists'

  const submit = () => {
    const n = name.trim()
    if (!n) {
      setStatus('Type a playlist name first.', true)
      return
    }
    if (mode === 'rename') {
      renamePlaylist(plModal.id, n)
      setStatus(`Renamed to "${n}".`)
    } else {
      const err = createPlaylist(n, plModal.song)
      if (err) {
        setStatus(err, true)
        return
      }
      setStatus(plModal.song ? `Created "${n}" with 1 song.` : `Created playlist "${n}".`)
    }
    closePlaylistModal()
  }

  return (
    <div id="plModal" className="open" onClick={(e) => e.target.id === 'plModal' && closePlaylistModal()}>
      <div id="plSheet">
        <h3 id="plModalTitle">{title}</h3>
        {mode !== 'rename' && (
          <div id="plListWrap">
            <div id="plList">
              {playlists.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  No playlists yet — create one below.
                </div>
              ) : (
                playlists.map((p) => (
                  <div
                    className="pl-pick"
                    key={p.id}
                    onClick={() => {
                      if (mode === 'add' && plModal.song) {
                        const msg = addToPlaylist(p.id, plModal.song)
                        if (msg) setStatus(msg, msg.startsWith('Playlist is full'))
                        closePlaylistModal()
                      }
                    }}
                  >
                    {decodeHtml(p.name)}
                    <span>{p.songs.length} songs</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        <div className="pl-newrow">
          <input
            ref={inputRef}
            id="plNewName"
            maxLength={60}
            placeholder="New playlist name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button onClick={submit}>{mode === 'rename' ? 'Save' : 'Create'}</button>
        </div>
        <button className="ghost" onClick={closePlaylistModal}>
          Cancel
        </button>
      </div>
    </div>
  )
}
