import { isToday, formatDuration } from '../lib/dates.js'
import { eventsOfDay, isAllDay, durationMinutes } from '../lib/events.js'

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

export default function MonthView({ reference, events, onSelectDay }) {
  const cells = getMonthGrid(reference)
  const monthMinutes = cells
    .filter(Boolean)
    .reduce(
      (sum, day) => sum + eventsOfDay(events, day).filter((e) => !isAllDay(e)).reduce((s, e) => s + durationMinutes(e), 0),
      0
    )

  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>
        {reference.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} · {formatDuration(monthMinutes)} comprometidos
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((l, i) => (
          <div key={i} className="muted" style={{ textAlign: 'center', fontSize: 11 }}>{l}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} />
          const dayEvents = eventsOfDay(events, date)
          return (
            <button
              key={i}
              onClick={() => onSelectDay && onSelectDay(date)}
              className="month-cell"
              style={{
                borderColor: isToday(date) ? 'var(--border-strong)' : 'transparent',
                fontWeight: isToday(date) ? 600 : 400,
              }}
              title={dayEvents.map((e) => e.summary).join('\n') || 'Sem compromissos'}
            >
              <div>{date.getDate()}</div>
              {dayEvents.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 2, marginTop: 2 }}>
                  {dayEvents.slice(0, 3).map((event, dotIdx) => (
                    <span
                      key={dotIdx}
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        background: event.calendarColor || 'var(--accent)',
                        display: 'inline-block',
                      }}
                    />
                  ))}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
