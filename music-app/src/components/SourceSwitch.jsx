import { BROWSE_ONLY_NOTE, SOURCE_ID, SOURCES, sourceOf } from '../lib/sources.js'
import { useSettings } from '../state/SettingsContext.jsx'

/**
 * The choice between catalogues, always in the header.
 *
 * An earlier revision put this inside the song results, which meant a listener
 * only learned the app had two sources after a search — and a listener on the
 * home feed never learned at all. It lives in the sticky top bar now, so the
 * current source is legible from every screen and switching costs one tap.
 *
 * The control is a segmented pair, not a select: with exactly two sources the
 * unpicked one is the more useful thing on screen, because it says what you
 * are missing.
 */
export function SourceSwitch() {
  const { source, setSource } = useSettings()
  return (
    <div className="src-switch topbar-src" role="group" aria-label="Music source">
      {SOURCES.map((s) => (
        <button
          key={s.id}
          type="button"
          className={'src-chip' + (s.id === source ? ' on' : '')}
          aria-pressed={s.id === source}
          title={s.note}
          onClick={() => setSource(s.id)}
        >
          {s.short}
        </button>
      ))}
      <span className="sr-only" aria-live="polite">
        {sourceOf(source).label}
      </span>
    </div>
  )
}

/**
 * The price of the choice, stated where the choice was made.
 *
 * Shown only while YouTube Music is selected, and it carries the fix — the
 * button switches back — so the note is an action rather than a disclaimer.
 * The full refusal still appears if a track is pressed; this is the earlier,
 * cheaper warning.
 */
export function SourceBanner() {
  const { source, setSource } = useSettings()
  if (source !== SOURCE_ID.ytmusic) return null
  return (
    <div className="src-banner" role="note">
      <span className="src-banner-text">{BROWSE_ONLY_NOTE}</span>
      <button type="button" className="src-banner-btn" onClick={() => setSource(SOURCE_ID.jiosaavn)}>
        Use JioSaavn
      </button>
    </div>
  )
}
