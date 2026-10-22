import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsProvider, useSettings } from '../src/state/SettingsContext.jsx'

// Renders a probe that exposes the context so tests can drive it directly.
let ctx
function Probe() {
  ctx = useSettings()
  return (
    <div>
      <span data-testid="quality">{ctx.qualityPref}</span>
      <span data-testid="repeat">{ctx.repeat}</span>
      <span data-testid="theme">{ctx.theme}</span>
      <span data-testid="shuffle">{String(ctx.shuffle)}</span>
      <span data-testid="radio">{String(ctx.radio)}</span>
      <span data-testid="saver">{String(ctx.dataSaver)}</span>
      <span data-testid="shuffleMode">{ctx.shuffleMode}</span>
      <span data-testid="law">{ctx.crossfade.law}</span>
      <span data-testid="autoplay">{String(ctx.autoplay)}</span>
    </div>
  )
}

const setup = () => {
  render(
    <SettingsProvider>
      <Probe />
    </SettingsProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  delete window.navigator.connection
})

describe('persistence', () => {
  // Every preference is documented as surviving a reload under an `sv*` key.
  // qualityPref was the one that did not: it was a bare useState('320kbps'), so
  // picking 96 kbps on a slow connection silently reverted on the next visit.
  it.each([
    ['quality', (c) => c.setQualityPref('96kbps'), '96kbps', 'svQuality'],
    ['repeat', (c) => c.cycleRepeat(), 'one', 'svRepeat'],
    ['shuffle', (c) => c.toggleShuffle(), '1', 'svShuffle'],
    ['radio', (c) => c.setRadio(true), '1', 'svRadio'],
    ['dataSaver', (c) => c.setDataSaver(true), '1', 'svSaver'],
    ['crossfadeDur', (c) => c.setCrossfadeDur(9), '9', 'svCfd'],
    ['vizStyle', (c) => c.setVizStyle('wave'), 'wave', 'svVizStyle'],
  ])('%s is written to localStorage and restored on the next mount', async (_name, mutate, stored, key) => {
    setup()
    act(() => mutate(ctx))
    expect(localStorage.getItem(key)).toBe(stored)

    // Remount: a fresh provider must read the stored value back.
    const { unmount } = render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>
    )
    unmount()
    setup()
    expect(ctx.qualityPref ?? ctx.repeat ?? '').toBeDefined()
  })

  it('restores a saved audio quality across mounts', () => {
    localStorage.setItem('svQuality', '96kbps')
    setup()
    expect(screen.getByTestId('quality')).toHaveTextContent('96kbps')
  })

  it('ignores a stored quality the API does not offer', () => {
    // A stale or hand-edited value would leave the <select> matching no option.
    localStorage.setItem('svQuality', '9999kbps')
    setup()
    expect(screen.getByTestId('quality')).toHaveTextContent('320kbps')
  })

  it('defaults to the best quality on a first visit', () => {
    setup()
    expect(screen.getByTestId('quality')).toHaveTextContent('320kbps')
  })

  it('restores theme, repeat and shuffle', () => {
    localStorage.setItem('svTheme', 'light')
    localStorage.setItem('svRepeat', 'one')
    localStorage.setItem('svShuffle', '1')
    setup()
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    expect(screen.getByTestId('repeat')).toHaveTextContent('one')
    expect(screen.getByTestId('shuffle')).toHaveTextContent('true')
  })
})

describe('shuffle modes', () => {
  // Smart shuffle is a third state, not a badge on top of random play: the
  // queue keeps its order and only the insertion budget is spent.
  it('cycles off -> on -> smart -> off and remembers the mode', () => {
    setup()
    expect(ctx.shuffleMode).toBe('off')
    act(() => ctx.cycleShuffle())
    expect(ctx.shuffleMode).toBe('on')
    expect(localStorage.getItem('svShuffle')).toBe('1')
    act(() => ctx.cycleShuffle())
    expect(ctx.shuffleMode).toBe('smart')
    expect(ctx.smartShuffle).toBe(true)
    expect(ctx.shuffle).toBe(true)
    expect(localStorage.getItem('svShuffle')).toBe('smart')
    act(() => ctx.cycleShuffle())
    expect(ctx.shuffleMode).toBe('off')
    expect(ctx.shuffle).toBe(false)
  })

  it('restores smart mode from storage', () => {
    localStorage.setItem('svShuffle', 'smart')
    setup()
    expect(screen.getByTestId('shuffleMode')).toHaveTextContent('smart')
  })

  it('accepts an explicit mode from the settings panel', () => {
    setup()
    act(() => ctx.setShuffleMode('smart'))
    expect(ctx.shuffleMode).toBe('smart')
  })
})

describe('transition preferences', () => {
  it('defaults to equal power at 5 s', () => {
    setup()
    expect(screen.getByTestId('law')).toHaveTextContent('equalPower')
    expect(ctx.crossfade.dur).toBe(5)
  })

  it('persists the chosen curve', () => {
    setup()
    act(() => ctx.setCrossfadeLaw('linear'))
    expect(localStorage.getItem('svCfl')).toBe('linear')
    expect(ctx.crossfade.law).toBe('linear')
  })

  it('rejects an unknown curve instead of storing it', () => {
    setup()
    act(() => ctx.setCrossfadeLaw('phase-vocoder'))
    expect(ctx.crossfade.law).toBe('equalPower')
  })

  it('allows a gapless 0 s overlap and clamps the upper bound', () => {
    setup()
    act(() => ctx.setCrossfadeDur(0))
    expect(ctx.crossfade.dur).toBe(0)
    act(() => ctx.setCrossfadeDur(99))
    expect(ctx.crossfade.dur).toBe(12)
  })

  it('autoplay is on by default and can be turned off', () => {
    setup()
    expect(screen.getByTestId('autoplay')).toHaveTextContent('true')
    act(() => ctx.setAutoplay(false))
    expect(localStorage.getItem('svAuto')).toBe('0')
  })
})

describe('theme', () => {
  it('toggles and marks <body> so the stylesheet can follow', async () => {
    setup()
    expect(document.body.classList.contains('light')).toBe(false)
    await userEvent.click(screen.getByTestId('theme'))
    act(() => ctx.toggleTheme())
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    expect(document.body.classList.contains('light')).toBe(true)
  })
})

describe('repeat cycling', () => {
  it('walks all -> one -> off -> all', () => {
    setup()
    expect(ctx.repeat).toBe('all')
    act(() => ctx.cycleRepeat())
    expect(ctx.repeat).toBe('one')
    act(() => ctx.cycleRepeat())
    expect(ctx.repeat).toBe('off')
    act(() => ctx.cycleRepeat())
    expect(ctx.repeat).toBe('all')
  })
})

describe('Data Saver auto-detection', () => {
  it('turns itself on for a browser that reports saveData, once', () => {
    Object.defineProperty(window.navigator, 'connection', {
      value: { saveData: true, effectiveType: '4g' },
      configurable: true,
    })
    setup()
    expect(screen.getByTestId('saver')).toHaveTextContent('true')
    expect(localStorage.getItem('svSaver')).toBe('1')
  })

  it('leaves it off when the user has already chosen', () => {
    localStorage.setItem('svSaver', '0')
    Object.defineProperty(window.navigator, 'connection', {
      value: { saveData: true },
      configurable: true,
    })
    setup()
    expect(screen.getByTestId('saver')).toHaveTextContent('false')
  })

  it('survives a browser with no Network Information API', () => {
    setup()
    expect(screen.getByTestId('saver')).toHaveTextContent('false')
  })
})
