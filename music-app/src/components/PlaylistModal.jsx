import { useEffect, useRef, useState } from 'react'
import { decodeHtml } from '../lib/format.js'
import { Icon } from './Icon.jsx'
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
    if (!open) return undefined
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
          ? `Add “${decodeHtml(plModal.song.name)}” to…`
          : 'Your playlists'

  const submit = () => {
    const n = name.trim()
    if (!n) {
      setStatus('Type a playlist name first.', true)
      return
    }
    if (mode === 'rename') {
      renamePlaylist(plModal.id, n)
      setStatus(`Renamed to “${n}”.`)
    } else {
      const err = createPlaylist(n, plModal.song)
      if (err) {
        setStatus(err, true)
        return
      }
      setStatus(plModal.song ? `Created “${n}” with 1 song.` : `Created playlist “${n}”.`)
    }
    closePlaylistModal()
  }

  return (
    <div
      id="plModal"
      className="open"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.target.id === 'plModal' && closePlaylistModal()}
    >
      <div id="plSheet">
        <h3 id="plModalTitle">{title}</h3>

        {mode !== 'rename' && (
          <div id="plListWrap">
            <div id="plList">
              {playlists.length === 0 ? (
                <div className="pl-empty">No playlists yet — create one below.</div>
              ) : (
                playlists.map((p) => (
                  <button
                    type="button"
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
                    <Icon name="music" size={16} />
                    {decodeHtml(p.name)}
                    <span>{p.songs.length} songs</span>
                  </button>
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
            aria-label="Playlist name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button type="button" className="btn-primary" onClick={submit}>
            {mode === 'rename' ? 'Save' : 'Create'}
          </button>
        </div>

        <button type="button" className="btn-ghost" id="plCloseBtn" onClick={closePlaylistModal}>
          Cancel
        </button>
      </div>
    </div>
  )
}
