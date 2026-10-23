import { decodeHtml } from '../lib/format.js'
import { artistsOf, imgOf } from '../lib/song.js'
import { Icon } from './Icon.jsx'
import { useSettings } from '../state/SettingsContext.jsx'

const fade = (e) => {
  e.currentTarget.style.opacity = 0.22
}

function subtitleOf(item, kind) {
  if (kind === 'song')
    return [artistsOf(item), item.language || item.year].filter(Boolean).join(' · ')
  if (kind === 'album')
    return [item.year, item.language, item.songCount ? item.songCount + ' songs' : '']
      .filter(Boolean)
      .join(' · ')
  return [item.songCount ? item.songCount + ' songs' : '', item.language]
    .filter(Boolean)
    .join(' · ')
}

/** One tile. Artwork first, then a two-line title — the shelf's unit. */
export function Card({ item, kind = 'playlist', onOpen, round = false, dataSaver }) {
  const sub = subtitleOf(item, kind) || item.type || ''
  return (
    <button
      type="button"
      className={'card' + (round ? ' round' : '')}
      onClick={() => onOpen(item)}
      aria-label={`${kind === 'song' ? 'Play' : 'Open'} ${decodeHtml(item.name)}`}
    >
      <span className="card-media">
        <img src={imgOf(item, dataSaver)} loading="lazy" alt="" onError={fade} />
        <span className="card-play" aria-hidden="true">
          <Icon name="play" size={15} />
        </span>
      </span>
      <span className="meta">
        <span className="t">{decodeHtml(item.name)}</span>
        <span className="c">{decodeHtml(sub)}</span>
      </span>
    </button>
  )
}

/** Album / playlist tiles in a wrapping grid. */
export function CardGrid({ items, kind, onOpen }) {
  const { dataSaver } = useSettings()
  return (
    <div className="grid card-grid">
      {items.map((item) => (
        <Card key={item.id} item={item} kind={kind} onOpen={onOpen} dataSaver={dataSaver} />
      ))}
    </div>
  )
}

/**
 * A horizontal, snap-scrolling shelf — the Listen Now building block.
 * It scrolls inside its own track, so a long row never widens the page.
 */
export function Shelf({ title, items, kind, onOpen, onMore, moreLabel = 'See all' }) {
  const { dataSaver } = useSettings()
  if (!items?.length) return null
  return (
    <section className="shelf feed-sec" aria-label={title}>
      <div className="shelf-head">
        <h3 className="shelf-title">
          {title} <span>{items.length}</span>
        </h3>
        {onMore && (
          <button type="button" className="shelf-more" onClick={onMore}>
            {moreLabel}
          </button>
        )}
      </div>
      <div className="shelf-row">
        {items.map((item) => (
          <Card key={item.id} item={item} kind={kind} onOpen={onOpen} dataSaver={dataSaver} />
        ))}
      </div>
    </section>
  )
}

/** Artists get circular art and a centred caption. */
export function ArtistGrid({ items, onOpen }) {
  const { dataSaver } = useSettings()
  return (
    <div className="grid card-grid">
      {items.map((a) => (
        <button
          type="button"
          className="card round"
          key={a.id}
          onClick={() => onOpen(a)}
          aria-label={`Open artist ${decodeHtml(a.name)}`}
        >
          <span className="card-media">
            <img src={imgOf(a, dataSaver)} loading="lazy" alt="" onError={fade} />
          </span>
          <span className="meta">
            <span className="t">{decodeHtml(a.name)}</span>
            <span className="c">{decodeHtml(a.role || a.type || 'Artist')}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
