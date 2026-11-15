/**
 * Tagged on-device audio downloads for Android (`Music/VIBEX` via `window.VibexAndroid`
 * with MediaStore indexing, falling back to `@capacitor/filesystem` `Documents/VIBEX`).
 *
 * Supports BOTH JioSaavn studio tracks (embedded with cover art + synced LRCLIB lyrics
 * via `tagger.mjs`) AND YouTube / YT Music tracks (`yt:<videoId>` pure audio `.m4a`).
 */
import { addTags } from '../../tagger.mjs'
import { apiFetch } from './api.js'
import { apiUrl, hasAndroidBridge } from './config.js'

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

const safeName = (s) =>
  String(s || 'song')
    .replace(/[\\/:*?"<>|\r\n]/g, '')
    .trim()
    .slice(0, 120) || 'song'

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

async function persistBytes(out, ct, name) {
  const data = await toBase64(out, ct)
  if (hasAndroidBridge() && window.VibexAndroid?.saveAudioBase64) {
    const savedUri = window.VibexAndroid.saveAudioBase64(name, ct || 'audio/mp4', data)
    if (!savedUri) throw new Error('Android storage refused to write the file.')
    return { uri: savedUri, folder: 'Music/VIBEX' }
  }
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { uri } = await Filesystem.writeFile({
    path: `VIBEX/${name}`,
    data,
    directory: Directory.Documents,
    recursive: true,
  })
  return { uri, folder: 'Documents/VIBEX' }
}

/**
 * @returns {Promise<{ name: string, bytes: number, uri: string, tagged: boolean, folder?: string }>}
 */
export async function downloadSongNative(song, quality, onStage = () => {}) {
  const id = String(song?.id || '')
  if (!id) throw new Error('This song has no id to resolve.')

  // Pure-audio YouTube / YT Music track (`yt:<videoId>`)
  if (id.startsWith('yt:')) {
    const videoId = id.slice(3).trim()
    if (!videoId) throw new Error('Invalid track identifier.')
    onStage('Downloading…')
    const streamEndpoint = apiUrl(`/ytaudio?id=${encodeURIComponent(videoId)}`)
    const res = await fetch(streamEndpoint, { redirect: 'follow' })
    const ct = (res.headers.get('content-type') || '').split(';')[0] || 'audio/mp4'
    if (!res.ok || ct.includes('application/json') || ct.includes('text/html')) {
      throw new Error(`Could not fetch audio stream (${res.status}).`)
    }
    const raw = new Uint8Array(await res.arrayBuffer())
    if (!raw.length) throw new Error('The audio stream came back empty.')

    onStage('Tagging…')
    let out = raw
    let tagged = false
    try {
      out = await addTags(raw, ct, song)
      tagged = out !== raw && out.length > 0
    } catch {
      out = raw
    }

    onStage('Saving…')
    const ext = /mp4|m4a|aac/i.test(ct) ? 'm4a' : 'webm'
    const name = `${safeName(song?.name)}.${ext}`
    const { uri, folder } = await persistBytes(out, ct, name)
    return { name, bytes: out.length, uri, tagged, folder }
  }

  // Always re-resolve JioSaavn CDN URLs in case the in-memory link expired.
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
  if (!target || !hostOK(target))
    throw new Error('The download link looked wrong; try replaying it.')

  onStage('Downloading…')
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
    out = raw
  }

  onStage('Saving…')
  const ext = /mp4|m4a|aac/i.test(ct) ? 'm4a' : 'mp3'
  const name = `${safeName(meta?.name)}.${ext}`
  const { uri, folder } = await persistBytes(out, ct, name)

  return { name, bytes: out.length, uri, tagged, folder }
}
