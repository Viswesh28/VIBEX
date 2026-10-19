import { describe, expect, it, afterEach } from 'vitest'
import { store } from '../src/lib/storage.js'

// The whole point of this module is that a throwing localStorage — private
// browsing, or a full quota — must not take the player down with it.

const realGet = Object.getOwnPropertyDescriptor(window, 'localStorage').get

afterEach(() => {
  Object.defineProperty(window, 'localStorage', { get: realGet, configurable: true })
  localStorage.clear()
})

function breakLocalStorage() {
  const throwing = new Proxy(
    {},
    {
      get() {
        throw new DOMException('denied', 'SecurityError')
      },
    }
  )
  Object.defineProperty(window, 'localStorage', { get: () => throwing, configurable: true })
}

describe('store', () => {
  it('round-trips strings', () => {
    store.set('k', 'v')
    expect(store.get('k', 'fallback')).toBe('v')
  })

  it('returns the default for a missing key, not null', () => {
    expect(store.get('nope', 'fallback')).toBe('fallback')
    expect(store.get('nope', null)).toBeNull()
  })

  it('round-trips JSON', () => {
    store.setJSON('obj', { a: [1, 2] })
    expect(store.getJSON('obj', null)).toEqual({ a: [1, 2] })
  })

  it('returns the default for corrupt JSON instead of throwing', () => {
    localStorage.setItem('bad', '{not json')
    expect(store.getJSON('bad', 'fallback')).toBe('fallback')
  })

  it('treats a stored null literal as absent', () => {
    localStorage.setItem('nil', 'null')
    expect(store.getJSON('nil', 'fallback')).toBe('fallback')
  })

  it('reports success honestly so callers can tell a write failed', () => {
    expect(store.set('ok', '1')).toBe(true)
  })

  describe('when localStorage throws on every access', () => {
    it('reads fall back to the default', () => {
      breakLocalStorage()
      expect(store.get('k', 'fallback')).toBe('fallback')
      expect(store.getJSON('k', { a: 1 })).toEqual({ a: 1 })
    })

    it('writes return false rather than throwing', () => {
      breakLocalStorage()
      expect(store.set('k', 'v')).toBe(false)
      expect(store.setJSON('k', { a: 1 })).toBe(false)
    })
  })
})
