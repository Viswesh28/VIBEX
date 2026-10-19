import { memo } from 'react'

/**
 * VIBEX's own icon set.
 *
 * Every glyph is drawn for this app on a 24×24 grid with a consistent 1.8px
 * stroke, round joins and butt-free terminals, so the player controls, the
 * navigation and the row actions read as one family. No third-party icon
 * package and no emoji: emoji render differently on every platform, cannot
 * inherit `currentColor`, and screen readers announce them by name.
 *
 * `name` is required; everything else is optional. Icons are decorative by
 * default (`aria-hidden`), because the control around them carries the label.
 */
const STROKE = {
  // ---- navigation -------------------------------------------------------
  home: (
    <>
      <path d="M3.8 10.6 12 4l8.2 6.6" />
      <path d="M6.1 9.3v9.2A1.5 1.5 0 0 0 7.6 20h2.6v-5.2h3.6V20h2.6a1.5 1.5 0 0 0 1.5-1.5V9.3" />
    </>
  ),
  search: (
    <>
      <circle cx="10.9" cy="10.9" r="6.3" />
      <path d="m15.5 15.5 4.3 4.3" />
    </>
  ),
  library: (
    <>
      <rect x="3.9" y="3.9" width="6.8" height="6.8" rx="1.7" />
      <rect x="13.3" y="3.9" width="6.8" height="6.8" rx="1.7" />
      <rect x="3.9" y="13.3" width="6.8" height="6.8" rx="1.7" />
      <rect x="13.3" y="13.3" width="6.8" height="6.8" rx="1.7" />
    </>
  ),
  stats: (
    <>
      <path d="M4 20h16" />
      <path d="M7.4 20v-6.4" />
      <path d="M12 20V6" />
      <path d="M16.6 20v-9.4" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7.2h16" />
      <path d="M4 12h16" />
      <path d="M4 16.8h11" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.7 5.7l1.3 1.3M17 17l1.3 1.3M18.3 5.7 17 7M7 17l-1.3 1.3" />
    </>
  ),
  moon: <path d="M20.1 14.4A8.5 8.5 0 0 1 9.6 3.9a8.6 8.6 0 1 0 10.5 10.5Z" />,
  settings: (
    <>
      <path d="M4 7.4h10.2M18.6 7.4H20M4 16.6h3.2M11.6 16.6H20" />
      <circle cx="16.4" cy="7.4" r="2.2" />
      <circle cx="9.4" cy="16.6" r="2.2" />
    </>
  ),
  chevronLeft: <path d="m14.4 5.6-6.4 6.4 6.4 6.4" />,
  chevronRight: <path d="m9.6 5.6 6.4 6.4-6.4 6.4" />,
  chevronDown: <path d="m5.6 9.6 6.4 6.4 6.4-6.4" />,
  close: <path d="m6.2 6.2 11.6 11.6M17.8 6.2 6.2 17.8" />,
  plus: <path d="M12 5.2v13.6M5.2 12h13.6" />,
  check: <path d="m5.2 12.6 4.4 4.4L18.8 7.4" />,
  more: (
    <>
      <circle cx="5.6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.4" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),

  // ---- playback ---------------------------------------------------------
  play: <path d="M8.2 5.6a1 1 0 0 1 1.52-.85l9.1 6.4a1 1 0 0 1 0 1.7l-9.1 6.4a1 1 0 0 1-1.52-.85Z" />,
  pause: (
    <>
      <rect x="7.1" y="5.4" width="3.5" height="13.2" rx="1.5" />
      <rect x="13.4" y="5.4" width="3.5" height="13.2" rx="1.5" />
    </>
  ),
  prev: (
    <>
      <rect x="5.2" y="5.6" width="2.3" height="12.8" rx="1.1" />
      <path d="M18.8 6.8a1 1 0 0 0-1.55-.84l-7.4 5.2a1 1 0 0 0 0 1.68l7.4 5.2a1 1 0 0 0 1.55-.84Z" />
    </>
  ),
  next: (
    <>
      <rect x="16.5" y="5.6" width="2.3" height="12.8" rx="1.1" />
      <path d="M5.2 6.8a1 1 0 0 1 1.55-.84l7.4 5.2a1 1 0 0 1 0 1.68l-7.4 5.2A1 1 0 0 1 5.2 17.2Z" />
    </>
  ),
  shuffle: (
    <>
      <path d="M4 7.2h2.3c1.4 0 2.7.7 3.5 1.9l4.3 6.4c.8 1.2 2.1 1.9 3.5 1.9H20" />
      <path d="M4 16.8h2.3c1.4 0 2.7-.7 3.5-1.9l.8-1.2" />
      <path d="M14.6 10.4l.5-.7c.8-1.2 2.1-1.9 3.5-1.9H20" />
      <path d="m17.6 4.9 2.7 2.7-2.7 2.7" />
      <path d="m17.6 14.1 2.7 2.7-2.7 2.7" />
    </>
  ),
  repeat: (
    <>
      <path d="M7.2 6.6h9A3.8 3.8 0 0 1 20 10.4v.6" />
      <path d="m17.4 3.8 2.8 2.8-2.8 2.8" />
      <path d="M16.8 17.4h-9A3.8 3.8 0 0 1 4 13.6v-.6" />
      <path d="M6.6 20.2 3.8 17.4l2.8-2.8" />
    </>
  ),
  repeatOne: (
    <>
      <path d="M7.2 6.6h9A3.8 3.8 0 0 1 20 10.4v.6" />
      <path d="m17.4 3.8 2.8 2.8-2.8 2.8" />
      <path d="M16.8 17.4h-9A3.8 3.8 0 0 1 4 13.6v-.6" />
      <path d="M6.6 20.2 3.8 17.4l2.8-2.8" />
      <path d="M10.9 9.9 12.4 9v6" />
    </>
  ),
  volume: (
    <>
      <path d="M4.2 9.5h3.2L11.9 5.7v12.6L7.4 14.5H4.2Z" />
      <path d="M15.3 9.2a4 4 0 0 1 0 5.6" />
      <path d="M17.9 6.6a7.8 7.8 0 0 1 0 10.8" />
    </>
  ),
  queue: (
    <>
      <path d="M4 7h11" />
      <path d="M4 12h7.5" />
      <path d="M4 17h8.5" />
      <path d="M16.4 12.6 20.5 15l-4.1 2.4Z" fill="currentColor" stroke="none" />
    </>
  ),
  expand: <path d="M9.2 4.2H4.2v5M14.8 4.2h5v5M9.2 19.8H4.2v-5M19.8 14.8v5h-5" />,

  // ---- library & metadata ----------------------------------------------
  heart: (
    <path d="M12 20.1c-.6-.4-7.4-4.7-7.4-9.5a4.2 4.2 0 0 1 7.4-2.7 4.2 4.2 0 0 1 7.4 2.7c0 4.8-6.8 9.1-7.4 9.5Z" />
  ),
  heartFilled: (
    <path
      d="M12 20.1c-.6-.4-7.4-4.7-7.4-9.5a4.2 4.2 0 0 1 7.4-2.7 4.2 4.2 0 0 1 7.4 2.7c0 4.8-6.8 9.1-7.4 9.5Z"
      fill="currentColor"
    />
  ),
  download: (
    <>
      <path d="M12 4.2v10.4" />
      <path d="m7.9 10.7 4.1 4.1 4.1-4.1" />
      <path d="M4.8 19.6h14.4" />
    </>
  ),
  lyrics: (
    <>
      <rect x="9.1" y="3.4" width="5.8" height="10.4" rx="2.9" />
      <path d="M5.9 11.2a6.1 6.1 0 0 0 12.2 0" />
      <path d="M12 17.4v3.2" />
    </>
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="1.9" />
      <path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4" />
      <path d="M15.7 8.3a5.2 5.2 0 0 1 0 7.4" />
      <path d="M5.4 5.4a9.3 9.3 0 0 0 0 13.2" />
      <path d="M18.6 5.4a9.3 9.3 0 0 1 0 13.2" />
    </>
  ),
  sparkle: (
    <path d="M12 4.2l1.7 5.1 5.1 1.7-5.1 1.7L12 17.8l-1.7-5.1L5.2 11l5.1-1.7Z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.4V12l3.1 2" />
    </>
  ),
  music: (
    <>
      <path d="M9.2 17.9V6.6l9.4-1.9v11" />
      <circle cx="6.8" cy="18" r="2.4" />
      <circle cx="16.2" cy="15.7" r="2.4" />
    </>
  ),
  trash: (
    <>
      <path d="M4.6 7h14.8" />
      <path d="M9.2 7V4.7h5.6V7" />
      <path d="m6.4 7 .9 12.1A1.5 1.5 0 0 0 8.8 20h6.4a1.5 1.5 0 0 0 1.5-1.4L17.6 7" />
    </>
  ),
  pencil: (
    <>
      <path d="M4.5 19.5h4.3L20 8.3a2 2 0 0 0 0-2.8l-1.5-1.5a2 2 0 0 0-2.8 0L4.5 15.2Z" />
      <path d="m14.4 5.3 4.3 4.3" />
    </>
  ),
  verified: (
    <>
      <path d="M12 3.3l2.3 1.6 2.8-.2 1 2.6 2.3 1.6-.9 2.7.9 2.7-2.3 1.6-1 2.6-2.8-.2L12 20.7l-2.3-1.6-2.8.2-1-2.6-2.3-1.6.9-2.7-.9-2.7L5.9 7.3l1-2.6 2.8.2Z" />
      <path d="m8.7 12 2.2 2.2 4.4-4.4" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.8v4.9" />
      <circle cx="12" cy="16.1" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11v4.6" />
      <circle cx="12" cy="7.9" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
}

const FILLED = new Set(['play', 'pause', 'prev', 'next', 'heartFilled'])

export const ICON_NAMES = Object.keys(STROKE)

export const Icon = memo(function Icon({
  name,
  size = 20,
  strokeWidth = 1.8,
  className = '',
  ...rest
}) {
  const glyph = STROKE[name]
  if (!glyph) return null
  const filled = FILLED.has(name)
  return (
    <svg
      className={'icon' + (className ? ' ' + className : '')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? undefined : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {glyph}
    </svg>
  )
})

/**
 * The VIBEX mark: a red badge holding three waveform bars that step down and
 * back up like a V. Original, and legible at 20px in a tab bar.
 */
export function Logo({ size = 34 }) {
  return (
    <span className="logo-badge" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="#fff">
        <rect x="3.6" y="7.4" width="3.1" height="9.2" rx="1.55" />
        <rect x="10.45" y="3.6" width="3.1" height="16.8" rx="1.55" />
        <rect x="17.3" y="7.4" width="3.1" height="9.2" rx="1.55" />
      </svg>
    </span>
  )
}
