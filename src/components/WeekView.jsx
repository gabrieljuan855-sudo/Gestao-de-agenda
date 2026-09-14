function getWeekDays(reference) {
  const start = new Date(reference)
  const day = start.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + diffToMonday)
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

function loadLevel(hours) {
  if (hours >= 5) return { label: 'lotado', className: 'urgente' }
  if (hours >= 2) return { label: 'médio', className: 'importante' }
  return { label: 'livre', className: 'pode_esperar' }
}

export default function WeekView({ reference, events }) {
  const days = getWeekDays(reference)

  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>Semana - carga por dia</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {days.map((d) => {
          const dayEvents = events.filter(
            (e) => e.start?.dateTime && new Date(e.start.dateTime).toDateString() === d.toDateString()
          )
          const hours = dayEvents.reduce((sum, e) => {
            const start = new Date(e.start.dateTime)
            const end = new Date(e.end.dateTime)
            return sum + (end - start) / (1000 * 60 * 60)
          }, 0)
          const level = loadLevel(hours)
          return (
            <div key={d.toDateString()} className={`pill ${level.className}`} style={{ textAlign: 'center', padding: '10px 4px' }}>
              <div style={{ fontWeight: 500, fontSize: 12 }}>
                {d.toLocaleDateString('pt-BR', { weekday: 'short' })}
              </div>
              <div style={{ fontSize: 11 }}>{level.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
