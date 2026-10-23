/**
 * Lightweight, zero-dependency Indic -> Roman sing-along transliterator for synced lyrics.
 * Supports Tamil, Devanagari (Hindi/Marathi), Telugu, Malayalam, and Kannada scripts.
 */

const INDIC_RE = /[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/

export function hasIndicScript(text = '') {
  return INDIC_RE.test(String(text || ''))
}

const TAMIL_INDEP = {
  அ: 'a', ஆ: 'aa', இ: 'i', ஈ: 'ee', உ: 'u', ஊ: 'oo',
  எ: 'e', ஏ: 'ae', ஐ: 'ai', ஒ: 'o', ஓ: 'oh', ஔ: 'au', ஃ: 'k',
}
const TAMIL_CONS = {
  க: 'k', ங: 'ng', ச: 'ch', ஞ: 'gn', ட: 't', ண: 'n', த: 'th', ந: 'n',
  ப: 'p', ம: 'm', ய: 'y', ர: 'r', ல: 'l', வ: 'v', ழ: 'zh', ள: 'l',
  ற: 'tr', ன: 'n', ஜ: 'j', ஷ: 'sh', ஸ: 's', ஹ: 'h', க்ஷ: 'ksh', ஸ்ரீ: 'sri',
}
const TAMIL_MATRA = {
  'ா': 'aa', 'ி': 'i', 'ீ': 'ee', 'ு': 'u', 'ூ': 'oo',
  'ெ': 'e', 'ே': 'ae', 'ை': 'ai', 'ொ': 'o', 'ோ': 'oh', 'ௌ': 'au',
}
const TAMIL_PULLI = '்'

// Shared offset table for Brahmic blocks (Devanagari 0x0900, Telugu 0x0C00, Kannada 0x0C80, Malayalam 0x0D00)
const BRAHMIC_INDEP = {
  0x05: 'a', 0x06: 'aa', 0x07: 'i', 0x08: 'ee', 0x09: 'u', 0x0a: 'oo',
  0x0b: 'ri', 0x0e: 'e', 0x0f: 'e', 0x10: 'ai', 0x12: 'o', 0x13: 'o', 0x14: 'au',
}
const BRAHMIC_CONS = {
  0x15: 'k', 0x16: 'kh', 0x17: 'g', 0x18: 'gh', 0x19: 'ng',
  0x1a: 'ch', 0x1b: 'chh', 0x1c: 'j', 0x1d: 'jh', 0x1e: 'ny',
  0x1f: 't', 0x20: 'th', 0x21: 'd', 0x22: 'dh', 0x23: 'n',
  0x24: 'th', 0x25: 'thh', 0x26: 'd', 0x27: 'dh', 0x28: 'n', 0x29: 'n',
  0x2a: 'p', 0x2b: 'ph', 0x2c: 'b', 0x2d: 'bh', 0x2e: 'm',
  0x2f: 'y', 0x30: 'r', 0x31: 'rr', 0x32: 'l', 0x33: 'l', 0x34: 'zh',
  0x35: 'v', 0x36: 'sh', 0x37: 'sh', 0x38: 's', 0x39: 'h',
}
const BRAHMIC_MATRA = {
  0x3e: 'aa', 0x3f: 'i', 0x40: 'ee', 0x41: 'u', 0x42: 'oo',
  0x43: 'ri', 0x46: 'e', 0x47: 'ae', 0x48: 'ai', 0x4a: 'o', 0x4b: 'oh', 0x4c: 'au',
}

function blockBase(code) {
  if (code >= 0x0900 && code <= 0x097f) return 0x0900 // Devanagari
  if (code >= 0x0c00 && code <= 0x0c7f) return 0x0c00 // Telugu
  if (code >= 0x0c80 && code <= 0x0cff) return 0x0c80 // Kannada
  if (code >= 0x0d00 && code <= 0x0d7f) return 0x0d00 // Malayalam
  return null
}

export const transliterateToRoman = romanizeIndicLine
export function romanizeIndicLine(line = '') {
  const chars = Array.from(String(line || ''))
  let out = ''

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]
    const next = chars[i + 1] || ''
    const code = ch.codePointAt(0) || 0

    // Tamil block
    if (code >= 0x0b80 && code <= 0x0bff) {
      if (TAMIL_INDEP[ch]) {
        out += TAMIL_INDEP[ch]
        continue
      }
      if (TAMIL_CONS[ch]) {
        const base = TAMIL_CONS[ch]
        if (next === TAMIL_PULLI) {
          out += base
          i += 1
        } else if (TAMIL_MATRA[next]) {
          out += base + TAMIL_MATRA[next]
          i += 1
        } else {
          out += base + 'a'
        }
        continue
      }
      if (ch === 'ं' || ch === 'ஂ') {
        out += 'm'
        continue
      }
      continue
    }

    // Devanagari / Telugu / Kannada / Malayalam blocks
    const baseAddr = blockBase(code)
    if (baseAddr !== null) {
      const off = code - baseAddr
      const nextCode = next.codePointAt(0) || 0
      const nextOff = blockBase(nextCode) === baseAddr ? nextCode - baseAddr : -1

      if (off === 0x01 || off === 0x02) {
        out += 'n'
        continue
      }
      if (off === 0x03) {
        out += 'h'
        continue
      }
      if (BRAHMIC_INDEP[off]) {
        out += BRAHMIC_INDEP[off]
        continue
      }
      if (BRAHMIC_CONS[off]) {
        const cons = BRAHMIC_CONS[off]
        if (nextOff === 0x4d) {
          out += cons
          i += 1
        } else if (BRAHMIC_MATRA[nextOff]) {
          out += cons + BRAHMIC_MATRA[nextOff]
          i += 1
        } else {
          out += cons + 'a'
        }
        continue
      }
      continue
    }

    out += ch
  }

  return out.replace(/\s{2,}/g, ' ').trim()
}
