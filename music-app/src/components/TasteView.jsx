import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import {
  artistKeysOf,
  buildTaste,
  describeTaste,
  pickSeeds,
  rankByTaste,
  recentlyPlayedIds,
} from '../lib/taste.js'
import { Icon } from './Icon.jsx'
import { SongList } from './SongList.jsx'
import { EmptyState, SectionTitle, Spinner } from './Spinner.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

/**
 * F-01: a feed built from what this device has actually played.
 *
 * The algorithm lives in lib/taste.js and is pure, so this view only does the
 * three things a view should: read the history, fetch the pools the history
 * points at, and render what comes back. Nothing here decides what a listener
 * likes — every ordering question belongs to the sibling module.
 */
export function TasteView({ onTitle }) {
  const { loadStats, flushStats } = useLibrary()
  const { excludedArtists, isExcluded, excludeArtist, unexcludeArtist } = useSettings()
  const { setStatus } = useStatus()
  const { navigate } = useUI()
  const [pool, setPool] = useState(null)
  const [error, setError] = useState(null)
  // One snapshot per mount: the list must not reshuffle under the listener
  // every time a play nudges the scores.
  const snapshot = useRef(null)

  const { stats, taste, seeds } = useMemo(() => {
    if (snapshot.current) return snapshot.current
    flushStats()
    const st = loadStats()
    const t = buildTaste(st, { excluded: excludedArtists })
    const s = pickSeeds(t)
    snapshot.current = { stats: st, taste: t, seeds: s }
    return snapshot.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Artist ids come from the history itself, so a taste seed never costs an
  // extra search that could resolve to a different artist of the same name.
  const seedIds = useMemo(() => {
    const byKey = new Map()
    for (const entry of Object.values(stats.songs || {})) {
      const id = entry?.artistId
      if (!id) continue
      for (const key of artistKeysOf(entry?.artist)) {
        if (!byKey.has(key)) byKey.set(key, id)
      }
    }
    return seeds.map((label) => ({ label, id: byKey.get(label.trim().toLowerCase()) || null }))
  }, [seeds, stats])

  useEffect(() => {
    onTitle?.('Made for you', '')
    setStatus('')
  }, [onTitle, setStatus])

  useEffect(() => {
    const ids = seedIds.filter((s) => s.id)
    if (!taste.ready || !ids.length) {
      setPool([])
      return undefined
    }
    let alive = true
    setPool(null)
    setError(null)
    setStatus('Building your mix…')
    Promise.all(
      ids.map((s) =>
        api(`/artists/${s.id}?songCount=25&albumCount=0`)
          .then((d) => d?.topSongs || [])
          .catch(() => [])
      )
    )
      .then((lists) => {
        if (!alive) return
        const merged = lists.flat()
        setPool(merged)
        setStatus(merged.length ? '' : 'No tracks came back for your artists.')
      })
      .catch((e) => {
        if (!alive) return
        setError(e.message)
        setStatus('Could not build your mix: ' + e.message, true)
      })
    return () => {
      alive = false
    }
  }, [seedIds, taste.ready, setStatus])

  const songs = useMemo(() => {
    if (!pool?.length) return []
    return rankByTaste(pool, taste, {
      excluded: excludedArtists,
      recentlyPlayed: recentlyPlayedIds(stats),
    }).slice(0, 50)
  }, [pool, taste, excludedArtists, stats])

  const reason = describeTaste(taste)

  if (!taste.ready)
    return (
      <div className="stats">
        <header className="view-head">
          <span className="eyebrow">
            <span className="dot" aria-hidden="true" />
            Taste profile
          </span>
          <h2 className="view-title">Made for you</h2>
          <p className="view-sub">
            This mix is learned from your own listening history — nothing leaves this device.
          </p>
        </header>
        <EmptyState
          icon="sparkle"
          title="Not enough listening yet"
          hint={
            taste.plays > 0
              ? `${taste.plays} of 5 plays counted. Skip less and listen longer and the mix will get sharper.`
              : 'Play a few songs and VIBEX will start building a mix from what you actually finish.'
          }
        />
        <button className="btn-ghost retry-btn" onClick={() => navigate({ kind: 'stats' })}>
          See your listening stats
        </button>
      </div>
    )

  return (
    <div className="stats">
      <header className="view-head">
        <span className="eyebrow">
          <span className="dot" aria-hidden="true" />
          Taste profile
        </span>
        <h2 className="view-title">Made for you</h2>
        <p className="view-sub">
          {reason
            ? `${reason} — weighted by how much of each track you actually finish, and nudged towards what you played this week.`
            : 'Built from what you actually finish, not what you skip.'}
        </p>
      </header>

      <div className="taste-seeds" aria-label="Artists behind this mix">
        {seeds.map((name) => (
          <button
            type="button"
            key={name}
            className={'chip' + (isExcluded(name) ? ' off' : '')}
            onClick={() => (isExcluded(name) ? unexcludeArtist(name) : excludeArtist(name))}
            title={isExcluded(name) ? `Suggest ${name} again` : `Don't suggest ${name}`}
          >
            <Icon name="music" size={13} />
            {name}
            <Icon name={isExcluded(name) ? 'plus' : 'close'} size={12} />
          </button>
        ))}
      </div>

      {!pool && !error && <Spinner />}

      {error && (
        <EmptyState
          icon="alert"
          title="Could not build your mix"
          hint={`${error} — your history is safe; try again when the connection is back.`}
        />
      )}

      {pool && songs.length > 0 && (
        <SectionTitle>
          {songs.length} picks
          <span>ranked by your taste</span>
        </SectionTitle>
      )}
      {songs.length > 0 && (
        <SongList songs={songs} allowExclude onExclude={excludeArtist} />
      )}

      {pool && !songs.length && !error && (
        <EmptyState
          icon="sparkle"
          title="Nothing new to suggest"
          hint="You have played everything this mix could find recently. Exclude an artist or play something else to refresh it."
        />
      )}
    </div>
  )
}
