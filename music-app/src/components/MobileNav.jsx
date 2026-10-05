import { NAV } from './Sidebar.jsx'
import { useUI } from '../state/UIContext.jsx'

/**
 * Bottom tab bar — phones only (CSS hides it above 640px).
 *
 * Android users expect primary navigation within thumb reach, and a 78px icon
 * rail down the left edge of a 360px screen is both unreachable and a fifth of
 * the width. The drawer still holds playlists and settings; these four are the
 * destinations worth a permanent tab.
 */
export function MobileNav() {
  const { view, navigate, search } = useUI()

  // Artist and detail pages are reached from a search, so Search stays lit.
  const activeKind = view.kind === 'artist' || view.kind === 'detail' ? 'search' : view.kind

  return (
    <nav id="mobileNav" aria-label="Primary">
      {NAV.map((n) => (
        <button
          key={n.kind}
          type="button"
          className={'mnav-item' + (activeKind === n.kind ? ' active' : '')}
          aria-current={activeKind === n.kind ? 'page' : undefined}
          onClick={() => (n.kind === 'search' ? search(null, null) : navigate({ kind: n.kind }))}
        >
          <span className="mnav-ico" aria-hidden="true">{n.ico}</span>
          <span className="mnav-label">{n.label}</span>
        </button>
      ))}
    </nav>
  )
}
