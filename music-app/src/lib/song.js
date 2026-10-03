// Readers for the JioSaavn song shape. Everything here tolerates partial or
// missing fields, because search, album, playlist and artist endpoints each
// return slightly different objects.
import { decodeHtml } from './format.js'

export function imgOf(s, dataSaver = false, pickLast = true) {
  if (!s?.image?.length) return ''
  if (dataSaver) return s.image[0].url
  return pickLast ? s.image[s.image.length - 1].url : s.image[0].url
}

export function artistsOf(s) {
  const a = s?.artists?.primary?.length ? s.artists.primary : s?.artists?.all || []
  return a.map((x) => x.name).join(', ') || decodeHtml(s?.subtitle || '') || 'Unknown artist'
}

/** The quality actually used: the preference when offered, else the best on hand. */
export function effQ(s, qualityPref = '320kbps', dataSaver = false) {
  const urls = s?.downloadUrl || []
  if (!urls.length) return qualityPref
  if (dataSaver) return urls[0].quality
  return urls.some((d) => d.quality === qualityPref) ? qualityPref : urls[urls.length - 1].quality
}

export function streamOf(s, q) {
  if (!s?.downloadUrl?.length) return ''
  return (s.downloadUrl.find((d) => d.quality === q) || s.downloadUrl[s.downloadUrl.length - 1]).url
}

export function firstArtistId(s) {
  return s?.artists?.primary?.[0]?.id || null
}

/** Approximate transfer size, so the UI can warn before a 13 MB download. */
export function estimate(quality, durationSec) {
  const m = /(\d+)/.exec(quality || '')
  const kb = m ? +m[1] : 128
  const perMin = (kb * 60) / 8 / 1024
  const mins = durationSec ? durationSec / 60 : 3
  return { perMin, songMB: perMin * mins }
}

function safeName(x) {
  return (x || '').replace(/[\\/:*?"<>|]/g, '').trim() || 'song'
}

export function dlBaseName(s) {
  return `${safeName(artistsOf(s))} - ${safeName(decodeHtml(s.name))}`
}

/** URL for the gateway's /dl endpoint, which tags the file before sending it. */
export function dlUrlFor(s, quality) {
  const params = new URLSearchParams({
    songId: s.id,
    q: quality,
    url: streamOf(s, quality),
    name: dlBaseName(s),
  })
  return `/dl?${params}`
}
