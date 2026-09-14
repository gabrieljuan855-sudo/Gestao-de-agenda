export default function DayView({ date, events }) {
  const dayEvents = events
    .filter((e) => e.start?.dateTime)
    .filter((e) => new Date(e.start.dateTime).toDateString() === date.toDateString())
    .sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime))

  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>
        Agenda de {date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {dayEvents.length === 0 && <div className="muted">Nenhum compromisso hoje.</div>}
        {dayEvents.map((event) => {
          const isFocus = event.summary?.startsWith('Foco:')
          return (
            <div
              key={event.id}
              style={{
                borderLeft: `3px solid ${isFocus ? 'var(--accent)' : 'var(--border-strong)'}`,
                background: isFocus ? 'var(--accent-bg)' : 'var(--surface-2)',
                padding: '6px 10px',
                borderRadius: 4,
              }}
            >
              <div className="muted" style={{ fontSize: 11 }}>
                {new Date(event.start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div style={{ fontSize: 14, fontWeight: isFocus ? 500 : 400 }}>{event.summary}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
