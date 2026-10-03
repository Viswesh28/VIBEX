export function Spinner() {
  return <div className="spinner" />
}

export function EmptyState({ icon, title, hint }) {
  return (
    <div className="empty-lib">
      <b>{icon}</b>
      <p>{title}</p>
      {hint && <span>{hint}</span>}
    </div>
  )
}

export function SectionTitle({ children }) {
  return <div className="sec-title">{children}</div>
}
