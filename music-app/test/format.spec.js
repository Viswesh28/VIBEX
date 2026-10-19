import { describe, expect, it } from 'vitest'
import { decodeHtml, fmt, fmtNum } from '../src/lib/format.js'

describe('decodeHtml', () => {
  it('decodes the entities JioSaavn leaves in names', () => {
    expect(decodeHtml('Guzarish &amp; Co')).toBe('Guzarish & Co')
    expect(decodeHtml('Rockstar&#039;s')).toBe("Rockstar's")
    expect(decodeHtml('&quot;Quoted&quot;')).toBe('"Quoted"')
  })

  it('passes plain text through', () => {
    expect(decodeHtml('Tum Hi Ho')).toBe('Tum Hi Ho')
  })

  it('treats null and undefined as empty rather than printing "null"', () => {
    expect(decodeHtml(null)).toBe('')
    expect(decodeHtml(undefined)).toBe('')
  })
})

describe('fmt', () => {
  it('formats seconds as m:ss with a zero-padded second', () => {
    expect(fmt(0)).toBe('0:00')
    expect(fmt(9)).toBe('0:09')
    expect(fmt(60)).toBe('1:00')
    expect(fmt(262)).toBe('4:22')
    expect(fmt(3600)).toBe('60:00')
  })

  it('clamps negatives and tolerates missing or fractional input', () => {
    expect(fmt(-5)).toBe('0:00')
    expect(fmt(null)).toBe('0:00')
    expect(fmt(undefined)).toBe('0:00')
    expect(fmt(1.9)).toBe('0:01') // floors, does not round
  })
})

describe('fmtNum', () => {
  it('abbreviates follower counts', () => {
    expect(fmtNum(999)).toBe('999')
    expect(fmtNum(1000)).toBe('1.0K')
    expect(fmtNum(1234567)).toBe('1.2M')
  })

  it('coerces junk to zero rather than NaN', () => {
    expect(fmtNum('nonsense')).toBe('0')
    expect(fmtNum(null)).toBe('0')
  })
})
