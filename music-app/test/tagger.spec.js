// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  tagMP3,
  tagM4A,
  tagAudio,
  buildTags,
  lyricsQueries,
  decodeEntities,
  artistsOf,
  fetchCover,
  fetchLyricsText,
  addTags,
} from '../tagger.mjs'

// --------------------------------------------------------------- fixtures

const enc = (s) => new TextEncoder().encode(s)
const u32be = (n) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
const cat = (...parts) => {
  const total = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const box = (type, ...body) => cat(u32be(body.reduce((a, p) => a + p.length, 0) + 8), enc(type), ...body)
const str4 = (buf, off) => String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3])
const rdU32 = (buf, off) =>
  ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0

/** A fake but structurally valid MP3: a frame sync after some padding. */
const mp3Audio = () => cat(new Uint8Array(64), new Uint8Array([0xff, 0xfb, 0x90, 0x00]), new Uint8Array(512))

/**
 * A fake but structurally valid M4A. `stco` carries one chunk offset pointing
 * at `mdat`, so the test can prove tagM4A repairs the offsets it displaces.
 */
function m4aAudio() {
  const stco = box('stco', new Uint8Array([0, 0, 0, 0]), u32be(1), u32be(200))
  const stbl = box('stbl', stco)
  const minf = box('minf', stbl)
  const mdia = box('mdia', minf)
  const trak = box('trak', mdia)
  const mvhd = box('mvhd', new Uint8Array(100))
  const moov = box('moov', mvhd, trak)
  const mdat = box('mdat', new Uint8Array(300))
  return { buf: cat(box('ftyp', enc('M4A '), u32be(0), enc('isom')), moov, mdat), moovSize: moov.length }
}

const song = {
  id: 'abc',
  name: 'Guzarish &amp; Co',
  year: 2010,
  duration: 262,
  language: 'hindi',
  copyright: '(P) 2010 Label',
  album: { name: 'Aashiqui 2' },
  artists: { primary: [{ name: 'Arijit Singh' }, { name: 'Mithoon' }] },
  image: [{ quality: '50x50', url: 'https://img/50' }, { quality: '500x500', url: 'https://img/500' }],
}

const tags = buildTags(song)

// ------------------------------------------------------------- metadata

describe('buildTags', () => {
  it('maps the JioSaavn song shape onto tag fields', () => {
    expect(tags).toEqual({
      title: 'Guzarish & Co',
      artist: 'Arijit Singh, Mithoon',
      album: 'Aashiqui 2',
      year: '2010',
      genre: 'hindi',
      comment: '(P) 2010 Label',
    })
  })

  it('tolerates a song with almost nothing on it', () => {
    expect(buildTags({})).toEqual({
      title: '',
      artist: '',
      album: '',
      year: '',
      genre: '',
      comment: '',
    })
  })
})

describe('decodeEntities', () => {
  it('decodes the entities JioSaavn double-encodes', () => {
    expect(decodeEntities('A &amp; B &quot;C&quot; &#039;D&#039; &lt;e&gt;')).toBe('A & B "C" \'D\' <e>')
  })
})

describe('artistsOf', () => {
  it('accepts both the artists.primary object shape and a bare array', () => {
    expect(artistsOf(song)).toEqual(['Arijit Singh', 'Mithoon'])
    expect(artistsOf({ artists: [{ name: 'Solo' }] })).toEqual(['Solo'])
    expect(artistsOf({})).toEqual([])
  })
})

describe('lyricsQueries', () => {
  it('tries every credited artist, most specific first, then the bare title', () => {
    expect(lyricsQueries('Tum Hi Ho', ['Mithoon', 'Arijit Singh'])).toEqual([
      'Mithoon Tum Hi Ho',
      'Arijit Singh Tum Hi Ho',
      'Tum Hi Ho',
    ])
  })

  it('caps the list and never repeats the bare title', () => {
    const q = lyricsQueries('X', ['A', 'B', 'C', 'D'])
    expect(q).toHaveLength(4) // limit 3 artists + the bare title
    expect(q.filter((x) => x === 'X')).toHaveLength(1)
  })

  it('is empty for a title that cleans away to nothing', () => {
    expect(lyricsQueries('', ['A'])).toEqual([])
  })
})

// ------------------------------------------------------------------ MP3

describe('tagMP3', () => {
  it('prepends a valid ID3v2.3 header with a correct syncsafe size', () => {
    const audio = mp3Audio()
    const out = tagMP3(audio, tags)

    expect(str4(out, 0).slice(0, 3)).toBe('ID3')
    expect(out[3]).toBe(3) // v2.3
    expect(out[4]).toBe(0)
    expect(out[5]).toBe(0) // no flags, so no footer

    const size =
      ((out[6] & 0x7f) << 21) | ((out[7] & 0x7f) << 14) | ((out[8] & 0x7f) << 7) | (out[9] & 0x7f)
    // header + body == the tag, and the original audio follows it verbatim.
    expect(10 + size + audio.length).toBe(out.length)
    expect(out.length).toBeGreaterThan(audio.length)
  })

  it('keeps every original audio byte after the tag, in order', () => {
    const audio = mp3Audio()
    const out = tagMP3(audio, tags)
    const size =
      ((out[6] & 0x7f) << 21) | ((out[7] & 0x7f) << 14) | ((out[8] & 0x7f) << 7) | (out[9] & 0x7f)
    expect(out.subarray(10 + size)).toEqual(audio)
  })

  it('writes the text frames it was given', () => {
    const out = tagMP3(mp3Audio(), tags)
    const asLatin1 = Array.from(out, (b) => String.fromCharCode(b)).join('')
    for (const frame of ['TIT2', 'TPE1', 'TALB', 'TYER', 'TCON', 'COMM']) {
      expect(asLatin1).toContain(frame)
    }
  })

  it('embeds lyrics as USLT and cover art as APIC when supplied', () => {
    const out = tagMP3(mp3Audio(), { ...tags, lyrics: '[00:01.00] line' }, {
      data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      mime: 'image/jpeg',
    })
    const asLatin1 = Array.from(out, (b) => String.fromCharCode(b)).join('')
    expect(asLatin1).toContain('USLT')
    expect(asLatin1).toContain('APIC')
    expect(asLatin1).toContain('image/jpeg')
  })

  it('replaces an existing ID3 tag instead of stacking a second one', () => {
    const once = tagMP3(mp3Audio(), tags)
    const twice = tagMP3(once, tags)
    const countTag = (b) => {
      let n = 0
      for (let i = 0; i + 3 <= b.length; i++) {
        if (b[i] === 0x49 && b[i + 1] === 0x44 && b[i + 2] === 0x33) n++ // "ID3"
      }
      return n
    }
    expect(countTag(once)).toBe(1)
    expect(countTag(twice)).toBe(1)
    // Re-tagging the same content must not keep growing the file.
    expect(twice.length).toBe(once.length)
  })

  it('returns the buffer untouched when there is nothing to write', () => {
    const audio = mp3Audio()
    expect(tagMP3(audio, {})).toBe(audio)
  })
})

// ------------------------------------------------------------------ M4A

describe('tagM4A', () => {
  it('inserts a udta metadata box into moov, leaving ftyp and mdat alone', () => {
    const { buf } = m4aAudio()
    const out = tagM4A(buf, tags)

    expect(out.length).toBeGreaterThan(buf.length)
    expect(str4(out, 4)).toBe('ftyp')

    // Walk the top-level boxes; moov must now contain udta.
    let off = 0
    let sawMoovWithUdta = false
    while (off + 8 <= out.length) {
      const size = rdU32(out, off)
      if (size < 8) break
      const type = str4(out, off + 4)
      if (type === 'moov') {
        let inner = off + 8
        while (inner + 8 <= off + size) {
          const isz = rdU32(out, inner)
          if (isz < 8) break
          if (str4(out, inner + 4) === 'udta') sawMoovWithUdta = true
          inner += isz
        }
      }
      off += size
    }
    expect(sawMoovWithUdta).toBe(true)
  })

  it('repairs the stco chunk offsets it displaced by growing moov', () => {
    const { buf, moovSize } = m4aAudio()
    const out = tagM4A(buf, tags)

    // Find the stco entry in the tagged file.
    const asLatin1 = Array.from(out, (b) => String.fromCharCode(b)).join('')
    const at = asLatin1.indexOf('stco')
    expect(at).toBeGreaterThan(0)
    const patched = rdU32(out, at + 4 + 4 + 4) // type + version/flags + entry_count

    const delta = out.length - buf.length
    expect(delta).toBeGreaterThan(0)
    // The original entry pointed at 200, which is past moov's start, so it
    // must have moved by exactly the amount moov grew.
    expect(patched).toBe(200 + delta)
    expect(moovSize).toBeLessThan(out.length)
  })

  it('returns the buffer untouched when there is no moov to write into', () => {
    const notAnMp4 = enc('this is not an mp4 file at all')
    expect(tagM4A(notAnMp4, tags)).toBe(notAnMp4)
  })
})

describe('tagAudio', () => {
  it('routes on content type', () => {
    expect(str4(tagAudio(mp3Audio(), 'audio/mpeg', tags), 0).slice(0, 3)).toBe('ID3')
    const out = tagAudio(m4aAudio().buf, 'audio/mp4', tags)
    expect(out.length).toBeGreaterThan(m4aAudio().buf.length)
  })

  it('sniffs ftyp when the content type is missing or wrong', () => {
    const { buf } = m4aAudio()
    const out = tagAudio(buf, 'application/octet-stream', tags)
    // Took the MP4 path: it inserted udta rather than prepending ID3.
    expect(str4(out, 0).slice(0, 3)).not.toBe('ID3')
    expect(out.length).toBeGreaterThan(buf.length)
  })

  it('passes an empty buffer straight through', () => {
    const empty = new Uint8Array(0)
    expect(tagAudio(empty, 'audio/mpeg', tags)).toBe(empty)
  })
})

// ------------------------------------------------- network-backed helpers

describe('fetchCover', () => {
  it('prefers the 500x500 art and reports its mime type', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg; charset=binary' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })
    const cover = await fetchCover(song)
    expect(cover).toEqual({ data: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' })
    expect(String(spy.mock.calls[0][0])).toBe('https://img/500')
  })

  it('is null, not a throw, when art cannot be fetched', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchCover(song)).toBeNull()
    expect(await fetchCover({})).toBeNull()
  })
})

describe('fetchLyricsText', () => {
  const ok = (body) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => body })

  it('returns synced text from the closest-duration match', async () => {
    ok([
      { duration: 400, syncedLyrics: '[00:01.00] wrong cut' },
      { duration: 262, syncedLyrics: '[00:01.00] right cut' },
    ])
    expect(await fetchLyricsText(song)).toBe('[00:01.00] right cut')
  })

  it('rejects a match whose runtime drifts too far from the track', async () => {
    ok([{ duration: 400, syncedLyrics: '[00:01.00] a different cut entirely' }])
    // 400s vs the song's 262s is a 138s drift, far past the 15s default.
    expect(await fetchLyricsText(song)).toBeNull()
  })

  it('falls back to plain lyrics, skips instrumentals, and never throws', async () => {
    ok([{ duration: 262, plainLyrics: 'plain body' }])
    expect(await fetchLyricsText(song)).toBe('plain body')

    ok([{ duration: 262, instrumental: true }])
    expect(await fetchLyricsText(song)).toBeNull()

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchLyricsText(song)).toBeNull()
  })
})

describe('addTags', () => {
  it('writes metadata, art and lyrics into the audio in one pass', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.startsWith('https://img/'))
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'image/jpeg' }),
          arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer,
        }
      if (u.includes('lrclib.net'))
        return { ok: true, json: async () => [{ duration: 262, syncedLyrics: '[00:01.00] hi' }] }
      throw new Error('unexpected fetch ' + u)
    })

    const out = await addTags(mp3Audio(), 'audio/mpeg', song)
    const asLatin1 = Array.from(out, (b) => String.fromCharCode(b)).join('')
    expect(asLatin1).toContain('TIT2')
    expect(asLatin1).toContain('APIC')
    expect(asLatin1).toContain('USLT')
  })

  it('still returns tagged audio when art and lyrics both fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const out = await addTags(mp3Audio(), 'audio/mpeg', song)
    const asLatin1 = Array.from(out, (b) => String.fromCharCode(b)).join('')
    expect(asLatin1).toContain('TIT2')
    expect(asLatin1).not.toContain('APIC')
  })

  it('returns the original buffer when handed no song', async () => {
    const audio = mp3Audio()
    expect(await addTags(audio, 'audio/mpeg', null)).toBe(audio)
  })
})
