function getMonthGrid(reference) {
  const year = reference.getFullYear()
  const month = reference.getMonth()
  const firstDay = new Date(year, month, 1)
  const startOffset = (firstDay.getDay() + 6) % 7 // semana começando na segunda
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  return cells
}

export default function MonthView({ reference, events }) {
  const cells = getMonthGrid(reference)
  const colorsByDay = {}
  events.forEach((e) => {
    if (!e.start?.dateTime) return
    const key = new Date(e.start.dateTime).toDateString()
    if (!colorsByDay[key]) colorsByDay[key] = []
    colorsByDay[key].push(e.calendarColor || 'var(--accent)')
  })

  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>
        {reference.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((l, i) => (
          <div key={i} className="muted" style={{ textAlign: 'center', fontSize: 11 }}>{l}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} />
          const dayColors = colorsByDay[date.toDateString()] || []
          const isToday = date.toDateString() === new Date().toDateString()
          return (
            <div
              key={i}
              style={{
                textAlign: 'center',
                fontSize: 12,
                padding: '6px 0',
                borderRadius: 6,
                border: isToday ? '1px solid var(--border-strong)' : '1px solid transparent',
              }}
            >
              <div>{date.getDate()}</div>
              {dayColors.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 2, marginTop: 2 }}>
                  {dayColors.slice(0, 3).map((color, dotIdx) => (
                    <span key={dotIdx} style={{ width: 4, height: 4, borderRadius: '50%', background: color, display: 'inline-block' }} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
