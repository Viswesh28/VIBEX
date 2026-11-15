import { useState } from 'react'
import { apiUrl } from '../lib/config.js'
import { decodeHtml } from '../lib/format.js'
import { artistsOf, imgOf } from '../lib/song.js'
import { Icon } from './Icon.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayerTransport } from '../state/PlayerContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

export function ImportPlaylistModal() {
  const { importModalOpen, setImportModalOpen, navigate } = useUI()
  const { saveSongsAsPlaylist } = useLibrary()
  const { playFromList } = usePlayerTransport()
  const { setStatus } = useStatus()

  const [sourceUrl, setSourceUrl] = useState('')
  const [customText, setCustomText] = useState('')
  const [nameOverride, setNameOverride] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [errMsg, setErrMsg] = useState('')

  if (!importModalOpen) return null

  const close = () => {
    setImportModalOpen(false)
    setErrMsg('')
  }

  const runImportPreview = async () => {
    if (!sourceUrl.trim() && !customText.trim()) {
      setErrMsg('Paste a Spotify, YouTube, or JioSaavn playlist URL — or paste a song list.')
      return
    }
    setLoading(true)
    setErrMsg('')
    try {
      const res = await fetch(apiUrl('/import-playlist'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: sourceUrl.trim(),
          text: customText.trim(),
          name: nameOverride.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Could not import that playlist.')
      }
      setPreview(json.data)
      if (!nameOverride.trim() && json.data?.name) {
        setNameOverride(json.data.name)
      }
    } catch (err) {
      setErrMsg(err?.message || 'Import failed. Check the link and try again.')
    } finally {
      setLoading(false)
    }
  }

  const commitImport = (andPlay = false) => {
    if (!preview?.tracks?.length) return
    const finalName = nameOverride.trim() || preview.name || 'Imported Playlist'
    const plId = saveSongsAsPlaylist(finalName, preview.tracks)
    setStatus(`Imported “${finalName}” (${preview.tracks.length} playable tracks).`)
    if (andPlay) {
      playFromList(preview.tracks, 0)
    }
    close()
    navigate({ kind: 'myplaylist', id: plId })
    setPreview(null)
    setSourceUrl('')
    setCustomText('')
    setNameOverride('')
  }

  return (
    <div id="plModal" className="open" onClick={close}>
      <div
        className="modal-card dsp-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Import external playlist"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head-row">
          <h3>
            <Icon name="import" size={18} /> Import Playlist
          </h3>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close import modal"
            onClick={close}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <p className="set-note" style={{ marginBottom: 10 }}>
          Paste a public <b>Spotify</b>, <b>YouTube / YT Music</b>, or <b>JioSaavn</b> playlist URL —
          or paste <code>Artist - Song</code> lines directly.
        </p>

        <input
          type="url"
          aria-label="Playlist URL"
          placeholder="https://open.spotify.com/playlist/... or YouTube / JioSaavn link"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        />

        <textarea
          rows={3}
          aria-label="Plain text track list"
          placeholder="Or paste lines here (optional):&#10;Anirudh Ravichander - Hukum&#10;A.R. Rahman - Kun Faya Kun"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          className="import-textarea"
        />

        <div className="set-row" style={{ marginTop: 8, gap: 8 }}>
          <input
            type="text"
            aria-label="Imported playlist name"
            placeholder="Playlist title (auto-detected if blank)"
            value={nameOverride}
            onChange={(e) => setNameOverride(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={loading}
            onClick={runImportPreview}
          >
            {loading ? 'Matching…' : 'Fetch tracks'}
          </button>
        </div>

        {errMsg && (
          <p className="set-note" style={{ color: 'var(--accent)', marginTop: 8 }}>
            {errMsg}
          </p>
        )}

        {preview && (
          <div className="import-preview">
            <div className="import-preview-head">
              <span>
                Matched <b>{preview.matchedCount}</b> of {preview.requestedCount} tracks from{' '}
                <b>{preview.source}</b>
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={!preview.tracks?.length}
                  onClick={() => commitImport(false)}
                >
                  Save to Library
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!preview.tracks?.length}
                  onClick={() => commitImport(true)}
                >
                  <Icon name="play" size={14} /> Save &amp; Play
                </button>
              </div>
            </div>
            <div className="import-preview-list">
              {(preview.tracks || []).slice(0, 25).map((t, idx) => (
                <div key={t.id || idx} className="import-preview-row">
                  <img src={imgOf(t, true)} alt="" />
                  <div>
                    <div className="q-t">{decodeHtml(t.name)}</div>
                    <div className="q-a">{decodeHtml(artistsOf(t))}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
