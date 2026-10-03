import { decodeHtml } from '../lib/format.js'
import { imgOf } from '../lib/song.js'
import { useSettings } from '../state/SettingsContext.jsx'

const fade = (e) => {
  e.currentTarget.style.opacity = 0.25
}

/** Album / playlist tiles. */
export function CardGrid({ items, kind, onOpen }) {
  const { dataSaver } = useSettings()
  return (
    <div className="grid">
      {items.map((item) => {
        const sub =
          kind === 'album'
            ? [item.year, item.language, item.songCount ? item.songCount + ' songs' : '']
                .filter(Boolean)
                .join(' • ')
            : [item.songCount ? item.songCount + ' songs' : '', item.language]
                .filter(Boolean)
                .join(' • ')
        return (
          <div className="card" key={item.id} onClick={() => onOpen(item)}>
            <img src={imgOf(item, dataSaver)} loading="lazy" alt="" onError={fade} />
            <div className="meta">
              <div className="t">{decodeHtml(item.name)}</div>
              <div className="c">{decodeHtml(sub || item.type || '')}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Artists get circular art and a centred caption. */
export function ArtistGrid({ items, onOpen }) {
  const { dataSaver } = useSettings()
  return (
    <div className="grid">
      {items.map((a) => (
        <div className="card" key={a.id} onClick={() => onOpen(a)}>
          <img
            src={imgOf(a, dataSaver)}
            loading="lazy"
            alt=""
            onError={fade}
            style={{ borderRadius: '50%', padding: 12 }}
          />
          <div className="meta" style={{ textAlign: 'center' }}>
            <div className="t">{decodeHtml(a.name)}</div>
            <div className="c">{decodeHtml(a.role || a.type || 'Artist')}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
