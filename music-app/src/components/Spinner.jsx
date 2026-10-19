import { Icon } from './Icon.jsx'

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />
}

export function EmptyState({ icon = 'music', title, hint }) {
  return (
    <div className="empty-lib">
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} size={28} />
      </span>
      <p>{title}</p>
      {hint && <span>{hint}</span>}
    </div>
  )
}

export function SectionTitle({ children }) {
  return <div className="sec-title">{children}</div>
}
