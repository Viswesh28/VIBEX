import { NAV } from './Sidebar.jsx'
import { Icon } from './Icon.jsx'
import { useUI } from '../state/UIContext.jsx'

/**
 * Bottom tab bar — phones only (CSS hides it above 640px).
 *
 * Icons are VIBEX's own, and every tab keeps a text label for screen readers
 * (the label is only visually dropped under 360px). 48px of height keeps the
 * target comfortably inside thumb reach.
 */
export function MobileNav() {
  const { view, navigate, search } = useUI()

  // Artist and detail pages are reached from a search, so Search stays lit.
  const activeKind = view.kind === 'artist' || view.kind === 'detail' ? 'search' : view.kind

  return (
    <nav id="mobileNav" className="mob-nav mobile-nav" aria-label="Primary">
      {NAV.map((n) => (
        <button
          key={n.kind}
          type="button"
          className={'mnav-item' + (activeKind === n.kind ? ' active' : '')}
          aria-current={activeKind === n.kind ? 'page' : undefined}
          onClick={() => (n.kind === 'search' ? search(null, null) : navigate({ kind: n.kind }))}
        >
          <span className="mnav-ico" aria-hidden="true">
            <Icon name={n.icon} size={21} />
          </span>
          <span className="mnav-label">{n.label}</span>
        </button>
      ))}
    </nav>
  )
}
