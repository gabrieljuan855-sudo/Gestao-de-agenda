import { startOfWeek, addDays, isToday, formatTime, formatDuration } from '../lib/dates.js'
import { eventsOfDay, isAllDay, durationMinutes, eventStart } from '../lib/events.js'

function loadLevel(hours) {
  if (hours >= 5) return { label: 'lotado', className: 'urgente' }
  if (hours >= 2) return { label: 'médio', className: 'importante' }
  return { label: 'livre', className: 'pode_esperar' }
}

function tasksDueOn(tasks, day) {
  return tasks.filter((t) => {
    if (!t.due || t.status === 'completed') return false
    const due = new Date(t.due)
    return due.toDateString() === day.toDateString()
  })
}

export default function WeekView({ reference, events, tasks = [], onSelectDay }) {
  const start = startOfWeek(reference)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))

  const weekMinutes = days.reduce(
    (sum, day) => sum + eventsOfDay(events, day).filter((e) => !isAllDay(e)).reduce((s, e) => s + durationMinutes(e), 0),
    0
  )
  const weekTasks = days.reduce((sum, day) => sum + tasksDueOn(tasks, day).length, 0)

  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>
        Semana · {formatDuration(weekMinutes)} comprometidos
        {weekTasks > 0 && ` · ${weekTasks} ${weekTasks === 1 ? 'tarefa vence' : 'tarefas vencem'}`}
      </div>

      <div className="week-grid">
        {days.map((day) => {
          const dayEvents = eventsOfDay(events, day)
          const timed = dayEvents.filter((e) => !isAllDay(e))
          const hours = timed.reduce((sum, e) => sum + durationMinutes(e) / 60, 0)
          const level = loadLevel(hours)
          const dueToday = tasksDueOn(tasks, day)

          return (
            <div
              key={day.toDateString()}
              className="week-day"
              onClick={() => onSelectDay && onSelectDay(day)}
              style={{ borderColor: isToday(day) ? 'var(--border-strong)' : 'var(--border)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: isToday(day) ? 600 : 500 }}>
                  {day.toLocaleDateString('pt-BR', { weekday: 'short' })} {day.getDate()}
                </span>
                <span className={`pill ${level.className}`} style={{ fontSize: 10, padding: '1px 6px' }}>
                  {level.label}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                {dayEvents.length === 0 && <span className="muted" style={{ fontSize: 11 }}>—</span>}
                {dayEvents.slice(0, 4).map((event) => (
                  <div key={event.id} className="week-event">
                    <span
                      className="week-dot"
                      style={{ background: event.calendarColor || 'var(--accent)' }}
                    />
                    <span className="week-event-text">
                      {!isAllDay(event) && `${formatTime(eventStart(event))} `}
                      {event.summary}
                    </span>
                  </div>
                ))}
                {dayEvents.length > 4 && (
                  <span className="muted" style={{ fontSize: 10 }}>+{dayEvents.length - 4} mais</span>
                )}
                {dueToday.map((task) => (
                  <div key={task.id} className="week-event" style={{ opacity: 0.85 }}>
                    <span className="week-dot" style={{ background: 'var(--important)' }} />
                    <span className="week-event-text">prazo: {task.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
