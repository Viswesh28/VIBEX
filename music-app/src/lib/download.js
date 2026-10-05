/**
 * Tagged downloads, performed entirely on the device.
 *
 * This is the native counterpart to the gateway's `/dl` endpoint, and it runs
 * the *same* `tagger.mjs` the server does — that module is plain Uint8Array,
 * so one implementation covers both. Steps mirror the server exactly:
 * re-resolve the CDN link (JioSaavn's links rotate and expire), fetch the
 * audio, fetch cover art and LRCLIB lyrics, write the metadata in, save.
 */
import { addTags } from '../../tagger.mjs'
import { apiFetch } from './api.js'

const CDN_HOSTS = ['saavncdn.com', 'jiosaavn.com', 'akamaized.net', 'akamaihd.net']

const hostOK = (t) => {
  try {
    const u = new URL(t)
    if (u.protocol !== 'https:') return false
    const h = u.hostname.toLowerCase()
    return CDN_HOSTS.some((x) => h === x || h.endsWith('.' + x))
  } catch {
    return false
  }
}

const safeName = (s) => String(s || 'song').replace(/[\\/:*?"<>|\r\n]/g, '').trim().slice(0, 120) || 'song'

/**
 * Uint8Array -> base64, via the platform's own encoder.
 *
 * A hand-rolled `btoa(String.fromCharCode(...))` blows the argument limit on a
 * 13 MB file; FileReader does the conversion off-thread instead.
 */
function toBase64(bytes, mime) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not encode the file'))
    reader.onload = () => {
      const s = String(reader.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    reader.readAsDataURL(new Blob([bytes], { type: mime }))
  })
}

/**
 * @returns {Promise<{ name: string, bytes: number, uri: string, tagged: boolean }>}
 */
export async function downloadSongNative(song, quality, onStage = () => {}) {
  const id = song?.id
  if (!id) throw new Error('This song has no id to resolve.')

  // Always re-resolve: a link held in memory since app start may have expired.
  onStage('Resolving…')
  let fresh = null
  try {
    const r = await apiFetch(`/songs/${encodeURIComponent(id)}`)
    const j = await r.json()
    const d = j?.data
    fresh = Array.isArray(d) ? d[0] : d?.songs?.[0] || d?.song || d
  } catch {
    /* fall back to what the UI already has */
  }
  const meta = fresh || song

  const urls = meta?.downloadUrl || []
  if (!urls.length) throw new Error('No downloadable link for this song.')
  const hit = urls.find((x) => x.quality === quality) || urls[urls.length - 1]
  const target = hit?.url
  if (!target || !hostOK(target)) throw new Error('The download link looked wrong; try replaying it.')

  onStage('Downloading…')
  // The CDN sends Access-Control-Allow-Origin: *, so the WebView's own fetch
  // handles this — no need to drag megabytes across the native bridge.
  const res = await fetch(target, { redirect: 'follow' })
  const ct = (res.headers.get('content-type') || '').split(';')[0] || 'audio/mp4'
  if (!res.ok || ct.includes('application/json') || ct.includes('text/html')) {
    throw new Error(`The CDN refused the file (${res.status}).`)
  }
  const raw = new Uint8Array(await res.arrayBuffer())
  if (!raw.length) throw new Error('The download came back empty.')

  onStage('Tagging…')
  let out = raw
  let tagged = false
  try {
    out = await addTags(raw, ct, meta)
    tagged = out !== raw && out.length > 0
  } catch {
    out = raw // never let a metadata failure cost the user the audio
  }

  onStage('Saving…')
  const ext = /mp4|m4a|aac/i.test(ct) ? 'm4a' : 'mp3'
  const name = `${safeName(meta?.name)}.${ext}`
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const data = await toBase64(out, ct)
  const { uri } = await Filesystem.writeFile({
    path: `VIBEX/${name}`,
    data,
    directory: Directory.Documents,
    recursive: true,
  })

  return { name, bytes: out.length, uri, tagged }
}
