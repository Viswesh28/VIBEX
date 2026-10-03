// Small pure formatters shared across the UI.

/** Decode HTML entities the JioSaavn API leaves in names ("Guzarish &amp; Co"). */
export function decodeHtml(s) {
  const t = document.createElement('textarea')
  t.innerHTML = s || ''
  return t.value
}

/** Seconds -> "m:ss". */
export function fmt(sec) {
  const n = Math.max(0, Math.floor(sec || 0))
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0')
}

/** 1234567 -> "1.2M". Used for artist follower counts. */
export function fmtNum(n) {
  const v = +n || 0
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return '' + v
}
