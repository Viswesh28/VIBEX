// Dependency-free audio tag writers.
//
//   tagM4A() writes iTunes-style metadata (moov/udta/meta/ilst) into an MP4/M4A.
//   tagMP3() prepends an ID3v2.3 tag to an MP3.
//
// Both take the same plain `tags` object and an optional cover image, and both
// return the original buffer untouched if anything looks wrong — a download that
// loses its tags is a nuisance, a download that loses its audio is a bug.

const u32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0)
  return b
}

const box = (type, ...parts) => {
  const body = Buffer.concat(parts)
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body])
}

// ---------------------------------------------------------------- MP4 / M4A

// Boxes that hold other boxes, so we know where to recurse looking for stco.
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'mvex', 'udta'])

function iterBoxes(buf, start, end) {
  const out = []
  let off = start
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off)
    let hdr = 8
    if (size === 1) {
      if (off + 16 > end) break
      size = Number(buf.readBigUInt64BE(off + 8))
      hdr = 16
    } else if (size === 0) {
      size = end - off
    }
    if (size < hdr || off + size > end) break
    out.push({ type: buf.toString('latin1', off + 4, off + 8), start: off, size, hdr })
    off += size
  }
  return out
}

// `data` box: version(1) + flags(3) + locale(4) + payload.
// flags 1 = UTF-8 text, 13 = JPEG, 14 = PNG.
const dataBox = (flags, payload) =>
  box('data', Buffer.from([0, 0, 0, flags & 0xff]), Buffer.alloc(4), payload)

const textItem = (type, value) => box(type, dataBox(1, Buffer.from(String(value), 'utf8')))

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
    Buffer.from('mdir', 'latin1'),
    Buffer.from('appl', 'latin1'),
    u32(0),
    u32(0),
    Buffer.from([0]) // empty name
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
      const count = moovBuf.readUInt32BE(bodyStart + 4)
      const wide = b.type === 'co64'
      const step = wide ? 8 : 4
      let p = bodyStart + 8
      for (let i = 0; i < count && p + step <= bodyEnd; i++, p += step) {
        if (wide) {
          const v = moovBuf.readBigUInt64BE(p)
          if (v > BigInt(threshold)) moovBuf.writeBigUInt64BE(v + BigInt(delta), p)
        } else {
          const v = moovBuf.readUInt32BE(p)
          if (v > threshold) moovBuf.writeUInt32BE(v + delta, p)
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

    return Buffer.concat([
      buf.subarray(0, moov.start),
      newMoov,
      buf.subarray(moov.start + moov.size),
    ])
  } catch {
    return buf
  }
}

// --------------------------------------------------------------------- MP3

const utf16 = (s) =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(String(s), 'utf16le'), Buffer.from([0, 0])])

const id3Frame = (id, body) =>
  Buffer.concat([Buffer.from(id, 'latin1'), u32(body.length), Buffer.from([0, 0]), body])

// ID3v2.3 sizes are "syncsafe": 7 bits per byte.
function syncsafe(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
}

export function tagMP3(buf, tags, cover) {
  try {
    const frames = []
    const text = (id, value) => {
      if (value === undefined || value === null || String(value).trim() === '') return
      frames.push(id3Frame(id, Buffer.concat([Buffer.from([1]), utf16(String(value).trim())])))
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
          Buffer.concat([
            Buffer.from([1]),
            Buffer.from('eng', 'latin1'),
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
          Buffer.concat([
            Buffer.from([1]),
            Buffer.from('eng', 'latin1'),
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
          Buffer.concat([
            Buffer.from([0]), // latin1 for mime + description
            Buffer.from(cover.mime || 'image/jpeg', 'latin1'),
            Buffer.from([0]),
            Buffer.from([3]), // cover (front)
            Buffer.from([0]), // empty description
            cover.data,
          ])
        )
      )
    }
    if (!frames.length) return buf

    // Drop an existing ID3v2 tag so we don't stack two of them.
    let audio = buf
    if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
      const old =
        ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
      const end = 10 + old + (buf[5] & 0x10 ? 10 : 0) // account for a footer
      if (end > 0 && end < buf.length) audio = buf.subarray(end)
    }

    const body = Buffer.concat(frames)
    const header = Buffer.concat([
      Buffer.from('ID3', 'latin1'),
      Buffer.from([3, 0]), // v2.3.0
      Buffer.from([0]), // no flags
      syncsafe(body.length),
    ])
    return Buffer.concat([header, body, audio])
  } catch {
    return buf
  }
}

// ------------------------------------------------------------------ shared

export function tagAudio(buf, contentType, tags, cover) {
  if (!buf || !buf.length) return buf
  const isMp4 =
    /mp4|m4a|aac/i.test(contentType || '') || buf.toString('latin1', 4, 8) === 'ftyp'
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
