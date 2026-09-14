const VIEWS = [
  { id: 'day', label: 'Dia' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mês' },
]

export default function ViewToggle({ view, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
      {VIEWS.map((v) => (
        <button
          key={v.id}
          onClick={() => onChange(v.id)}
          style={{
            flex: 1,
            fontWeight: view === v.id ? 500 : 400,
            background: view === v.id ? 'var(--surface-2)' : 'var(--surface-1)',
            borderColor: view === v.id ? 'var(--border-strong)' : 'var(--border)',
          }}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}
