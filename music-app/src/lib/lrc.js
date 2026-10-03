// Lyrics from LRCLIB, synced when the track has timestamps.
import { decodeHtml } from './format.js'
import { artistsOf } from './song.js'

export function cleanTrackName(name) {
  return decodeHtml(name || '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s*-\s*From\s+.*/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** "[01:23.45] text" -> [{ t: 83.45, text }], sorted by time. */
export function parseLRC(lrc) {
  const lines = []
  ;(lrc || '').split('\n').forEach((raw) => {
    const m = raw.match(/^\[(\d+):(\d+)(?:\.(\d+))?\]/)
    if (!m) return
    const frac = m[3] || ''
    const t = +m[1] * 60 + +m[2] + (frac ? +frac / Math.pow(10, frac.length) : 0)
    const text = raw
      .slice(m[0].length)
      .replace(/^\s*(\[\d+:\d+(?:\.\d+)?\]\s*)+/, '')
      .trim()
    if (text) lines.push({ t, text })
  })
  lines.sort((a, b) => a.t - b.t)
  return lines
}

/** Index of the line that should be highlighted at time `t`. */
export function activeLineIndex(lines, t) {
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= t + 0.15) idx = i
    else break
  }
  return idx
}

const cache = new Map()

/** Resolves to { type: 'synced'|'plain'|'instrumental'|'none'|'error', ... }. */
export async function fetchLyrics(song) {
  if (cache.has(song.id)) return cache.get(song.id)
  let res
  try {
    const q = encodeURIComponent(`${artistsOf(song).split(',')[0]} ${cleanTrackName(song.name)}`)
    const r = await fetch(`https://lrclib.net/api/search?q=${q}`)
    if (!r.ok) throw new Error('lyrics HTTP ' + r.status)
    const arr = await r.json()
    if (!Array.isArray(arr) || !arr.length) res = { type: 'none' }
    else {
      const dur = song.duration || 0
      arr.sort((a, b) => Math.abs((a.duration || 0) - dur) - Math.abs((b.duration || 0) - dur))
      const best = arr[0]
      if (best.instrumental) res = { type: 'instrumental' }
      else if (best.syncedLyrics && parseLRC(best.syncedLyrics).length)
        res = { type: 'synced', lines: parseLRC(best.syncedLyrics) }
      else if (best.plainLyrics) res = { type: 'plain', text: best.plainLyrics }
      else res = { type: 'none' }
    }
  } catch {
    res = { type: 'error' }
  }
  cache.set(song.id, res)
  return res
}

export function cachedLyrics(id) {
  return cache.get(id)
}
