import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecBadge, StopNote, TransitionBadge } from '../src/components/Provenance.jsx'

describe('RecBadge', () => {
  it('renders nothing for a song the user queued themselves', () => {
    const { container } = render(<RecBadge prov={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names the reason a smart insert was chosen', () => {
    render(<RecBadge prov={{ kind: 'smart_insert', reason: 'same_artist' }} />)
    expect(screen.getByText('Same artist')).toBeInTheDocument()
  })

  it('falls back to a readable label for an unknown reason', () => {
    render(<RecBadge prov={{ kind: 'smart_insert', reason: 'something_new' }} />)
    expect(screen.getByText('For you')).toBeInTheDocument()
  })

  it('marks an autoplay tail differently from an in-context suggestion', () => {
    const { container } = render(<RecBadge prov={{ kind: 'autoplay', reason: 'context' }} />)
    expect(screen.getByText('Continues this mix')).toBeInTheDocument()
    expect(container.querySelector('.rec-badge.smart')).toBeNull()
  })

  it('exposes one dismiss control with an accessible name', async () => {
    const onDismiss = vi.fn()
    render(<RecBadge prov={{ kind: 'smart_insert', reason: 'same_artist' }} onDismiss={onDismiss} />)
    await userEvent.click(screen.getByRole('button', { name: /dismiss suggestion/i }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})

describe('TransitionBadge', () => {
  it('is absent unless a hand-over is actually in progress', () => {
    const { container } = render(<TransitionBadge transition={{ state: 'idle' }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('announces the mix politely while it runs', () => {
    render(<TransitionBadge transition={{ state: 'mixing', kind: 'crossfade', dur: 5 }} />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveTextContent('Mixing 5s')
    expect(badge).toHaveAttribute('aria-live', 'polite')
  })
})

describe('StopNote', () => {
  it('distinguishes an empty queue from a failed recommender', async () => {
    const onRetry = vi.fn()
    render(<StopNote stopReason="autoplay_failed" onRetry={onRetry} onRadio={() => {}} />)
    expect(screen.getByText(/couldn't find anything similar/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('does not offer a retry when retrying cannot help', () => {
    render(<StopNote stopReason="context_exhausted" />)
    expect(screen.getByText(/queue finished/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
