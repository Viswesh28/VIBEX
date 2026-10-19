import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Icon, ICON_NAMES, Logo } from '../src/components/Icon.jsx'

describe('Icon', () => {
  it('renders every named glyph as a decorative SVG', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(20)
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} testid={name} />)
      const svg = container.querySelector('svg')
      expect(svg, name).toBeTruthy()
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg.querySelectorAll('path, circle, rect').length).toBeGreaterThan(0)
      unmount()
    }
  })

  it('inherits colour and size from its props', () => {
    const { container } = render(<Icon name="play" size={31} />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '31')
    expect(svg).toHaveAttribute('height', '31')
    // Filled glyphs paint with currentColor so the button decides the colour.
    expect(svg).toHaveAttribute('fill', 'currentColor')
    expect(svg).toHaveAttribute('stroke', 'none')
  })

  it('renders nothing for an unknown name rather than an empty box', () => {
    const { container } = render(<Icon name="not-a-real-icon" />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('keeps the brand mark decorative', () => {
    const { container } = render(<Logo size={40} />)
    expect(container.querySelector('.logo-badge')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('rect')).toHaveLength(3)
  })
})
