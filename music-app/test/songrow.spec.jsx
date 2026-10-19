import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SongRow } from '../src/components/SongRow.jsx'

const song = {
  id: 'abc',
  name: 'Guzarish &amp; Co',
  duration: 262,
  image: [{ url: 'https://img/50' }, { url: 'https://img/500' }],
  artists: { primary: [{ name: 'Arijit Singh' }] },
  album: { name: 'Aashiqui 2' },
}

const renderRow = (props = {}) =>
  render(
    <SongRow
      song={song}
      onPlay={vi.fn()}
      onLike={vi.fn()}
      onAddToPlaylist={vi.fn()}
      onRadio={vi.fn()}
      {...props}
    />
  )

describe('SongRow', () => {
  // The last commit on main ("restore song titles in list rows on phones") was a
  // CSS-only fix with nothing asserting the row still renders its text.
  it('shows the title, artist, album and duration, with entities decoded', () => {
    renderRow()
    expect(screen.getByText('Guzarish & Co')).toBeInTheDocument()
    expect(screen.getByText('Arijit Singh')).toBeInTheDocument()
    expect(screen.getByText('Aashiqui 2')).toBeInTheDocument()
    expect(screen.getByText('4:22')).toBeInTheDocument()
  })

  it('prefixes the track number only when given one', () => {
    const { rerender } = render(<SongRow song={song} num={3} onPlay={vi.fn()} onLike={vi.fn()} onAddToPlaylist={vi.fn()} onRadio={vi.fn()} />)
    expect(screen.getByText('3. Guzarish & Co')).toBeInTheDocument()
    rerender(<SongRow song={song} onPlay={vi.fn()} onLike={vi.fn()} onAddToPlaylist={vi.fn()} onRadio={vi.fn()} />)
    expect(screen.getByText('Guzarish & Co')).toBeInTheDocument()
  })

  it('marks the currently playing row', () => {
    const { container } = renderRow({ playing: true })
    expect(container.querySelector('.song-row')).toHaveClass('playing')
  })

  it('reflects liked state in both the class and the glyph', () => {
    const { container, rerender } = renderRow({ liked: false })
    expect(container.querySelector('.like-btn')).not.toHaveClass('liked')
    expect(screen.getByTitle('Like')).toHaveTextContent('♡')

    rerender(
      <SongRow song={song} liked onPlay={vi.fn()} onLike={vi.fn()} onAddToPlaylist={vi.fn()} onRadio={vi.fn()} />
    )
    expect(container.querySelector('.like-btn')).toHaveClass('liked')
    expect(screen.getByTitle('Like')).toHaveTextContent('♥')
  })

  it('uses the smallest artwork in Data Saver mode', () => {
    const { container } = renderRow({ dataSaver: true })
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://img/50')
  })

  it('fires onPlay from the row', async () => {
    const onPlay = vi.fn()
    const { container } = renderRow({ onPlay })
    await userEvent.click(container.querySelector('.song-row'))
    expect(onPlay).toHaveBeenCalledTimes(1)
  })

  // These three used to be `opacity: 0` until `.song-row:hover`, which made them
  // unreachable on a touchscreen. The click must work regardless of styling.
  it.each([
    ['Like', 'onLike'],
    ['Add to playlist', 'onAddToPlaylist'],
    ['Start radio from here', 'onRadio'],
  ])('fires %s without also triggering the row', async (title, prop) => {
    const onPlay = vi.fn()
    const handler = vi.fn()
    renderRow({ onPlay, [prop]: handler })
    await userEvent.click(screen.getByTitle(title))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(onPlay).not.toHaveBeenCalled() // stopPropagation held
  })

  it('swaps add-to-playlist for a remove button inside a user playlist', async () => {
    const onRemove = vi.fn()
    renderRow({ onRemove })
    expect(screen.queryByTitle('Add to playlist')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTitle('Remove from playlist'))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})
