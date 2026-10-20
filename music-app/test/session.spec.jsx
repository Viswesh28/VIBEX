import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LibraryProvider } from '../src/state/LibraryContext.jsx'
import { PlayerProvider, usePlayer } from '../src/state/PlayerContext.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { StatusProvider } from '../src/state/StatusContext.jsx'

/**
 * iOS reclaims backgrounded web apps, so the queue is persisted and restored
 * on relaunch. The restored track must appear immediately, must *not*
 * autoplay (iOS would block it and the UI would lie), and pressing play must
 * load the stream rather than calling play() on a deck with no source.
 */
const song = (i) => ({
  id: `song${i}`,
  name: `Restored Track ${i}`,
  duration: 200,
  image: [{ quality: '500x500', url: `https://placehold.co/500x500?text=${i}` }],
  downloadUrl: [
    { quality: '160kbps', url: `https://aac.saavncdn.com/fixture/${i}_160.mp4` },
    { quality: '320kbps', url: `https://aac.saavncdn.com/fixture/${i}_320.mp4` },
  ],
  artists: { primary: [{ id: 'a1', name: 'Verification Artist' }] },
})

function Probe() {
  const { current, isPlaying, queue, togglePlay, playFromList } = usePlayer()
  return (
    <div>
      <span data-testid="title">{current?.name || 'none'}</span>
      <span data-testid="playing">{String(isPlaying)}</span>
      <span data-testid="length">{queue.length}</span>
      <button type="button" onClick={togglePlay}>
        Toggle
      </button>
      <button type="button" onClick={() => playFromList([song(3), song(4)], 0)}>
        Play a list
      </button>
    </div>
  )
}

const mount = () =>
  render(
    <StatusProvider>
      <SettingsProvider>
        <LibraryProvider>
          <PlayerProvider>
            <Probe />
          </PlayerProvider>
        </LibraryProvider>
      </SettingsProvider>
    </StatusProvider>
  )

const save = (payload) =>
  localStorage.setItem('svSession', JSON.stringify(payload))

beforeEach(() => {
  localStorage.clear()
  vi.mocked(window.HTMLMediaElement.prototype.play).mockClear()
})

describe('session restore', () => {
  it('starts empty when nothing was saved', () => {
    mount()
    expect(screen.getByTestId('title')).toHaveTextContent('none')
    expect(screen.getByTestId('length')).toHaveTextContent('0')
  })

  it('rehydrates the queue and current track without autoplaying', () => {
    save({ queue: [song(1), song(2)], index: 1, at: Date.now() })
    mount()
    expect(screen.getByTestId('title')).toHaveTextContent('Restored Track 2')
    expect(screen.getByTestId('length')).toHaveTextContent('2')
    expect(screen.getByTestId('playing')).toHaveTextContent('false')
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })

  it('loads the restored stream on the first play tap', async () => {
    save({ queue: [song(1), song(2)], index: 1, at: Date.now() })
    mount()
    const audio = document.querySelector('audio')
    expect(audio.getAttribute('src')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    // Default quality preference is 320kbps, so that is the URL that loads.
    expect(audio.getAttribute('src')).toBe('https://aac.saavncdn.com/fixture/2_320.mp4')
  })

  it('ignores a session older than a week', () => {
    save({ queue: [song(1)], index: 0, at: Date.now() - 8 * 24 * 60 * 60 * 1000 })
    mount()
    expect(screen.getByTestId('title')).toHaveTextContent('none')
  })

  it('clamps an out-of-range index and drops malformed entries', () => {
    save({ queue: [null, song(1), { name: 'no id' }], index: 99, at: Date.now() })
    mount()
    expect(screen.getByTestId('length')).toHaveTextContent('1')
    expect(screen.getByTestId('title')).toHaveTextContent('Restored Track 1')
  })

  it('writes the session back after a queue change', async () => {
    mount()
    expect(localStorage.getItem('svSession')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Play a list' }))
    const saved = JSON.parse(localStorage.getItem('svSession'))
    expect(saved.queue.map((s) => s.id)).toEqual(['song3', 'song4'])
    expect(saved.index).toBe(0)
    expect(typeof saved.at).toBe('number')
  })
})
