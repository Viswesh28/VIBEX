import { REC_REASON_LABEL, REC_REASON_SENTENCE, STOP_LABEL } from '../lib/recommend.js'
import { Icon } from './Icon.jsx'

/**
 * Where a queued song came from.
 *
 * Spotify's queue is explicitly partitioned into user items and autoplay items,
 * and every recommendation carries a reason. Both ideas are cheap to copy and
 * expensive to retrofit: without them a "smart" queue is just an unexplained
 * shuffle, and the listener has no way to say "not this".
 */
export function RecBadge({ prov, onDismiss, label = null }) {
  if (!prov) return null
  const smart = prov.kind === 'smart_insert'
  const reason = REC_REASON_LABEL[prov.reason] || (smart ? 'For you' : 'Autoplay')
  const title = smart
    ? `Suggested — ${REC_REASON_SENTENCE[prov.reason] || 'picked for you'}. Dismiss to hear fewer like it.`
    : 'Autoplay tail — plays after your own queue'
  return (
    <span className={'rec-badge' + (smart ? ' smart' : '')} title={title}>
      <Icon name={smart ? 'sparkle' : 'radio'} size={11} />
      <span className="rec-badge-t">{label || reason}</span>
      {onDismiss && (
        <button
          type="button"
          className="rec-dismiss"
          title="Dismiss this suggestion"
          aria-label={`Dismiss suggestion: ${reason}`}
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  )
}

/** The "Mixing" badge — driven by playback truth, never by a timer of its own. */
export function TransitionBadge({ transition, compact = false }) {
  if (!transition || transition.state !== 'mixing') return null
  const secs = Math.max(1, Math.round(transition.dur || 0))
  return (
    <span
      className={'mix-badge' + (compact ? ' compact' : '')}
      role="status"
      aria-live="polite"
      title={`${transition.kind === 'hard_cut' ? 'Cut' : 'Crossfade'} in progress — ${secs}s`}
    >
      <span className="mix-dot" aria-hidden="true" />
      Mixing{compact ? '' : ` ${secs}s`}
    </span>
  )
}

/**
 * A typed stop reason with the recovery that actually applies. "Queue
 * finished" and "we couldn't find anything similar" are different problems.
 */
export function StopNote({ stopReason, onRetry, onRadio }) {
  if (!stopReason) return null
  const message = STOP_LABEL[stopReason] || STOP_LABEL.unknown
  const canRetry = stopReason === 'autoplay_failed'
  return (
    <div className="stop-note" role="status">
      <Icon name={canRetry ? 'alert' : 'info'} size={15} />
      <span>{message}</span>
      {canRetry && onRetry && (
        <button type="button" className="btn-ghost tiny" onClick={onRetry}>
          Try again
        </button>
      )}
      {canRetry && onRadio && (
        <button type="button" className="btn-ghost tiny" onClick={onRadio}>
          Start radio
        </button>
      )}
    </div>
  )
}
