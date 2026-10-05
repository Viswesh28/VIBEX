// Dependency-free audio tag writers.
//
//   tagM4A() writes iTunes-style metadata (moov/udta/meta/ilst) into an MP4/M4A.
//   tagMP3() prepends an ID3v2.3 tag to an MP3.
//
// Both take the same plain `tags` object and an optional cover image, and both
// return the original buffer untouched if anything looks wrong — a download that
// loses its tags is a nuisance, a download that loses its audio is a bug.
//
// Everything below is plain Uint8Array rather than Buffer, so the exact same
// module runs in the Node gateway and inside the app's WebView. Buffer is a
// Uint8Array subclass, so Node callers can still hand us one directly.

const alloc = (n) => new Uint8Array(n)

const bytes = (arr) => Uint8Array.from(arr)

function concat(parts) {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

// Latin-1 is a byte-for-byte mapping, which is exactly what atom types and
// ID3 frame IDs need — TextEncoder would mangle anything above 0x7f (e.g. the
// '\xa9' that prefixes every iTunes text atom).
const latin1 = (s) => Uint8Array.from(String(s), (c) => c.charCodeAt(0) & 0xff)

const utf8 = (s) => new TextEncoder().encode(String(s))

function utf16le(s) {
  const str = String(s)
  const out = new Uint8Array(str.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < str.length; i++) view.setUint16(i * 2, str.charCodeAt(i), true)
  return out
}

const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength)

const rdU32 = (u8, off) => view(u8).getUint32(off)
const rdU64 = (u8, off) => view(u8).getBigUint64(off)
const wrU32 = (u8, off, v) => view(u8).setUint32(off, v >>> 0)
const wrU64 = (u8, off, v) => view(u8).setBigUint64(off, v)

// Latin-1 decode of a byte range, used to read 4-char atom types.
function str(u8, start, end) {
  let out = ''
  for (let i = start; i < end; i++) out += String.fromCharCode(u8[i])
  return out
}

const u32 = (n) => {
  const b = alloc(4)
  wrU32(b, 0, n)
  return b
}

const box = (type, ...parts) => {
  const body = concat(parts)
  return concat([u32(body.length + 8), latin1(type), body])
}

// ---------------------------------------------------------------- MP4 / M4A

// Boxes that hold other boxes, so we know where to recurse looking for stco.
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'mvex', 'udta'])

function iterBoxes(buf, start, end) {
  const out = []
  let off = start
  while (off + 8 <= end) {
    let size = rdU32(buf, off)
    let hdr = 8
    if (size === 1) {
      if (off + 16 > end) break
      size = Number(rdU64(buf, off + 8))
      hdr = 16
    } else if (size === 0) {
      size = end - off
    }
    if (size < hdr || off + size > end) break
    out.push({ type: str(buf, off + 4, off + 8), start: off, size, hdr })
    off += size
  }
  return out
}

// `data` box: version(1) + flags(3) + locale(4) + payload.
// flags 1 = UTF-8 text, 13 = JPEG, 14 = PNG.
const dataBox = (flags, payload) =>
  box('data', bytes([0, 0, 0, flags & 0xff]), alloc(4), payload)

const textItem = (type, value) => box(type, dataBox(1, utf8(value)))

function buildIlst(tags, cover) {
  const items = []
  const add = (type, value) => {
    if (value === undefined || value === null || String(value).trim() === '') return
    items.push(textItem(type, String(value).trim()))
  }
  add('\xa9nam', tags.title)
  add('\xa9ART', tags.artist)
  add('aART', tags.albumArtist || tags.artist)
  add('\xa9alb', tags.album)
  add('\xa9day', tags.year)
  add('\xa9gen', tags.genre)
  add('\xa9cmt', tags.comment)
  add('\xa9lyr', tags.lyrics)
  if (cover && cover.data && cover.data.length) {
    const flags = /png/i.test(cover.mime || '') ? 14 : 13
    items.push(box('covr', dataBox(flags, cover.data)))
  }
  if (!items.length) return null
  return box('ilst', ...items)
}

function buildUdta(ilst) {
  // Standard iTunes metadata handler.
  const hdlr = box(
    'hdlr',
    u32(0), // version + flags
    u32(0), // pre_defined
    latin1('mdir'),
    latin1('appl'),
    u32(0),
    u32(0),
    bytes([0]) // empty name
  )
  const meta = box('meta', u32(0), hdlr, ilst) // meta is a full box
  return box('udta', meta)
}

// Chunk offsets are absolute file offsets. Growing moov pushes mdat down, so
// every offset pointing past moov has to move by the same delta.
function patchChunkOffsets(moovBuf, start, end, delta, threshold) {
  for (const b of iterBoxes(moovBuf, start, end)) {
    const bodyStart = b.start + b.hdr
    const bodyEnd = b.start + b.size
    if (b.type === 'stco' || b.type === 'co64') {
      if (bodyStart + 8 > bodyEnd) continue
      const count = rdU32(moovBuf, bodyStart + 4)
      const wide = b.type === 'co64'
      const step = wide ? 8 : 4
      let p = bodyStart + 8
      for (let i = 0; i < count && p + step <= bodyEnd; i++, p += step) {
        if (wide) {
          const v = rdU64(moovBuf, p)
          if (v > BigInt(threshold)) wrU64(moovBuf, p, v + BigInt(delta))
        } else {
          const v = rdU32(moovBuf, p)
          if (v > threshold) wrU32(moovBuf, p, v + delta)
        }
      }
    } else if (CONTAINERS.has(b.type)) {
      patchChunkOffsets(moovBuf, bodyStart, bodyEnd, delta, threshold)
    }
  }
}

export function tagM4A(buf, tags, cover) {
  try {
    const top = iterBoxes(buf, 0, buf.length)
    const moov = top.find((b) => b.type === 'moov')
    if (!moov) return buf

    const ilst = buildIlst(tags, cover)
    if (!ilst) return buf

    // Rebuild moov's children, dropping any udta we're replacing.
    const kept = []
    for (const child of iterBoxes(buf, moov.start + moov.hdr, moov.start + moov.size)) {
      if (child.type === 'udta') continue
      kept.push(buf.subarray(child.start, child.start + child.size))
    }
    if (!kept.length) return buf

    const newMoov = box('moov', ...kept, buildUdta(ilst))
    const delta = newMoov.length - moov.size
    if (delta !== 0) patchChunkOffsets(newMoov, 8, newMoov.length, delta, moov.start)

    return concat([
      buf.subarray(0, moov.start),
      newMoov,
      buf.subarray(moov.start + moov.size),
    ])
  } catch {
    return buf
  }
}

// --------------------------------------------------------------------- MP3

const utf16 = (s) => concat([bytes([0xff, 0xfe]), utf16le(s), bytes([0, 0])])

const id3Frame = (id, body) => concat([latin1(id), u32(body.length), bytes([0, 0]), body])

// ID3v2.3 sizes are "syncsafe": 7 bits per byte.
function syncsafe(n) {
  return bytes([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
}

export function tagMP3(buf, tags, cover) {
  try {
    const frames = []
    const text = (id, value) => {
      if (value === undefined || value === null || String(value).trim() === '') return
      frames.push(id3Frame(id, concat([bytes([1]), utf16(String(value).trim())])))
    }
    text('TIT2', tags.title)
    text('TPE1', tags.artist)
    text('TPE2', tags.albumArtist || tags.artist)
    text('TALB', tags.album)
    text('TYER', tags.year)
    text('TCON', tags.genre)

    if (tags.comment && String(tags.comment).trim()) {
      frames.push(
        id3Frame(
          'COMM',
          concat([
            bytes([1]),
            latin1('eng'),
            utf16(''),
            utf16(String(tags.comment).trim()),
          ])
        )
      )
    }
    if (tags.lyrics && String(tags.lyrics).trim()) {
      frames.push(
        id3Frame(
          'USLT',
          concat([
            bytes([1]),
            latin1('eng'),
            utf16(''),
            utf16(String(tags.lyrics).trim()),
          ])
        )
      )
    }
    if (cover && cover.data && cover.data.length) {
      frames.push(
        id3Frame(
          'APIC',
          concat([
            bytes([0]), // latin1 for mime + description
            latin1(cover.mime || 'image/jpeg'),
            bytes([0]),
            bytes([3]), // cover (front)
            bytes([0]), // empty description
            cover.data,
          ])
        )
      )
    }
    if (!frames.length) return buf

    // Drop an existing ID3v2 tag so we don't stack two of them.
    let audio = buf
    if (buf.length > 10 && str(buf, 0, 3) === 'ID3') {
      const old =
        ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
      const end = 10 + old + (buf[5] & 0x10 ? 10 : 0) // account for a footer
      if (end > 0 && end < buf.length) audio = buf.subarray(end)
    }

    const body = concat(frames)
    const header = concat([
      latin1('ID3'),
      bytes([3, 0]), // v2.3.0
      bytes([0]), // no flags
      syncsafe(body.length),
    ])
    return concat([header, body, audio])
  } catch {
    return buf
  }
}

// ------------------------------------------------------------------ shared

export function tagAudio(buf, contentType, tags, cover) {
  if (!buf || !buf.length) return buf
  const isMp4 =
    /mp4|m4a|aac/i.test(contentType || '') || str(buf, 4, 8) === 'ftyp'
  return isMp4 ? tagM4A(buf, tags, cover) : tagMP3(buf, tags, cover)
}

// Mirrors the UI's LRCLIB lookup: closest duration wins, synced preferred.
export function cleanTrackName(name) {
  return String(name || '')
    .replace(/\s*\((?:from|From)[^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildLyricsQuery(name, artist) {
  return `${String(artist || '').split(',')[0].trim()} ${cleanTrackName(name)}`.trim()
}

/**
 * LRCLIB only matches on a free-text query, and JioSaavn lists composers and
 * singers together in `artists.primary` with no stable ordering. Searching for
 * just the first name misses whenever that name is the composer (e.g. "Tum Hi
 * Ho" is credited to "Mithoon, Arijit Singh"). Return the queries to try in
 * order, most specific first, falling back to the bare track title.
 */
export function lyricsQueries(name, artists, limit = 3) {
  const clean = cleanTrackName(name)
  if (!clean) return []
  const names = (Array.isArray(artists) ? artists : String(artists || '').split(','))
    .map((a) => String(a || '').trim())
    .filter(Boolean)
  const out = []
  for (const a of names) {
    const q = `${a} ${clean}`
    if (!out.includes(q)) out.push(q)
    if (out.length >= limit) break
  }
  if (!out.includes(clean)) out.push(clean)
  return out
}

// ------------------------------------------------- song -> tagged audio

// JioSaavn double-encodes a handful of entities in its JSON.
export const decodeEntities = (s) =>
  String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

export const artistsOf = (song) => {
  const primary = song?.artists?.primary
  const list = Array.isArray(primary) ? primary : Array.isArray(song?.artists) ? song.artists : []
  return list.map((a) => decodeEntities(a?.name)).filter(Boolean)
}

export function buildTags(song) {
  return {
    title: decodeEntities(song?.name),
    artist: artistsOf(song).join(', '),
    album: decodeEntities(song?.album?.name),
    year: song?.year ? String(song.year) : '',
    genre: song?.language ? decodeEntities(song.language) : '',
    comment: song?.copyright ? decodeEntities(song.copyright) : '',
  }
}

export async function fetchCover(song) {
  try {
    const imgs = Array.isArray(song?.image) ? song.image : []
    const pick = imgs.find((i) => i?.quality === '500x500') || imgs[imgs.length - 1]
    if (!pick?.url) return null
    const r = await fetch(pick.url, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    const data = new Uint8Array(await r.arrayBuffer())
    if (!data.length) return null
    return { data, mime: (r.headers.get('content-type') || 'image/jpeg').split(';')[0] }
  } catch {
    return null
  }
}

// Same LRCLIB lookup the UI does: closest duration wins, synced preferred.
export async function fetchLyricsText(song, { timeoutMs = 6000, maxDriftS = 15 } = {}) {
  const dur = Number(song?.duration) || 0
  const queries = lyricsQueries(decodeEntities(song?.name), artistsOf(song))
  for (const q of queries) {
    try {
      const r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
        headers: { accept: 'application/json', 'user-agent': 'VIBEX' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!r.ok) continue
      const arr = await r.json()
      if (!Array.isArray(arr) || !arr.length) continue
      // Same song, different release: pick whichever candidate runs closest to
      // the length JioSaavn reports, so synced timestamps stay in step.
      const scored = arr
        .filter((x) => x && !x.instrumental && (x.syncedLyrics || x.plainLyrics))
        .sort((a, b) => Math.abs((a.duration || 0) - dur) - Math.abs((b.duration || 0) - dur))
      const best = scored[0]
      if (!best) continue
      if (dur && best.duration && Math.abs(best.duration - dur) > maxDriftS) continue
      const text = (best.syncedLyrics || '').trim() || (best.plainLyrics || '').trim()
      if (text) return text
    } catch {
      // Try the next query; lyrics are optional and must never fail a download.
    }
  }
  return null
}

/** Fetch cover + lyrics for a song and write everything into the audio. */
export async function addTags(buf, contentType, song, opts) {
  if (!song) return buf
  const tags = buildTags(song)
  const [cover, lyrics] = await Promise.all([fetchCover(song), fetchLyricsText(song, opts)])
  if (lyrics) tags.lyrics = lyrics
  const out = tagAudio(buf, contentType, tags, cover)
  return out && out.length ? out : buf
}
