import { useEffect } from 'react'
import { SongList } from './SongList.jsx'
import { EmptyState } from './Spinner.jsx'
import { useLibrary } from '../state/LibraryContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'

export function LibraryView({ onTitle }) {
  const { liked } = useLibrary()
  const { setStatus } = useStatus()

  useEffect(() => {
    onTitle?.('Your Library', `(${liked.length} liked)`)
    setStatus(liked.length ? `${liked.length} liked songs. Click to play.` : 'Your library is empty.')
  }, [liked.length, onTitle, setStatus])

  if (!liked.length)
    return (
      <EmptyState
        icon="♥"
        title="Nothing liked yet"
        hint="Hover any song and tap the heart to save it here."
      />
    )
  return <SongList songs={liked} />
}
