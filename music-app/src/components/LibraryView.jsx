import { useEffect } from 'react'
import { decodeHtml } from '../lib/format.js'
import { imgOf } from '../lib/song.js'
import { Icon } from './Icon.jsx'
import { SongList } from './SongList.jsx'
import { EmptyState, SectionTitle } from './Spinner.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { usePlayerTransport } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

/** Liked songs and the playlists kept on this device. */
export function LibraryView({ onTitle }) {
  const { liked, playlists } = useLibrary()
  const { setStatus } = useStatus()
  const { playFromList } = usePlayerTransport()
  const { dataSaver } = useSettings()
  const { navigate, openNewPlaylistModal } = useUI()

  useEffect(() => {
    onTitle?.('Your Library', `(${liked.length} liked)`)
    setStatus('')
  }, [liked.length, onTitle, setStatus])

  const minutes = Math.round(liked.reduce((sum, s) => sum + (s.duration || 0), 0) / 60)

  return (
    <div className="lib">
      <section className="hero" aria-labelledby="libraryTitle">
        <div className="hero-scrim" aria-hidden="true" />
        <div className="hero-cover hero-placeholder" aria-hidden="true">
          <Icon name="heartFilled" size={54} />
        </div>
        <div className="hero-body">
          <span className="eyebrow">
            <span className="dot" aria-hidden="true" />
            Your library
          </span>
          <h3 id="libraryTitle">Liked songs</h3>
          <div className="hero-meta">
            {liked.length} {liked.length === 1 ? 'song' : 'songs'}
            {liked.length > 0 && ` · ${minutes} min`}
          </div>
          <div className="hero-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => liked.length && playFromList(liked, 0)}
              disabled={!liked.length}
            >
              <Icon name="play" size={15} />
              Play
            </button>
            <button type="button" className="btn-ghost on-art" onClick={openNewPlaylistModal}>
              <Icon name="plus" size={15} />
              New playlist
            </button>
          </div>
        </div>
      </section>

      {liked.length ? (
        <SongList songs={liked} />
      ) : (
        <EmptyState
          icon="heart"
          title="Nothing liked yet"
          hint="Tap the heart on any song to save it here."
        />
      )}

      <SectionTitle>
        Your playlists <span>{playlists.length}</span>
      </SectionTitle>
      {playlists.length ? (
        <div className="card-grid">
          {playlists.map((p) => {
            const art = p.songs[0] ? imgOf(p.songs[0], dataSaver) : ''
            return (
              <button
                key={p.id}
                type="button"
                className="card"
                onClick={() => navigate({ kind: 'myplaylist', id: p.id })}
                aria-label={`Open playlist ${decodeHtml(p.name)}`}
              >
                <span className="card-media">
                  {art ? (
                    <img src={art} loading="lazy" alt="" />
                  ) : (
                    <span className="card-fallback" aria-hidden="true">
                      <Icon name="music" size={30} />
                    </span>
                  )}
                  <span className="card-play" aria-hidden="true">
                    <Icon name="play" size={15} />
                  </span>
                </span>
                <span className="meta">
                  <span className="t">{decodeHtml(p.name)}</span>
                  <span className="c">{p.songs.length} songs</span>
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="lib-hint">
          No playlists yet — create one here or tap <Icon name="plus" size={13} /> on any song.
        </p>
      )}
    </div>
  )
}
