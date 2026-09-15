import { startOfMonth, startOfWeek, addDays, isToday, formatTime, formatDuration } from '../lib/dates.js'
import { eventsOfDay, isAllDay, eventStart, busyMinutesOn } from '../lib/events.js'
import { isWorkday } from '../lib/schedule.js'

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const MAX_CHIPS = 3

function buildGrid(reference) {
  const first = startOfMonth(reference)
  const start = startOfWeek(first)
  const daysInMonth = new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate()
  const offset = Math.round((first - start) / 86400000)
  const weeks = Math.ceil((offset + daysInMonth) / 7)
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
}

export default function MonthView({ reference, events, onSelectDay, onSelectEvent, occupies = () => true }) {
  const cells = buildGrid(reference)
  const month = reference.getMonth()
  const monthMinutes = cells
    .filter((day) => day.getMonth() === month)
    .reduce((sum, day) => sum + busyMinutesOn(events, day, occupies), 0)

  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>
        {reference.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} · {formatDuration(monthMinutes)} comprometidos
      </div>

      <div className="month-head">
        {WEEKDAYS.map((label) => (
          <div key={label} className="month-head-cell">{label}</div>
        ))}
      </div>

      <div className="month-grid" style={{ gridTemplateRows: `repeat(${cells.length / 7}, minmax(84px, auto))` }}>
        {cells.map((day) => {
          const dayEvents = eventsOfDay(events, day)
          const outside = day.getMonth() !== month
          const today = isToday(day)

          return (
            <div
              key={day.toISOString()}
              className={`month-day${outside ? ' month-day--outside' : ''}${isWorkday(day) ? '' : ' month-day--off'}`}
              onClick={() => onSelectDay && onSelectDay(day)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelectDay && onSelectDay(day)}
            >
              <div className={`month-daynum${today ? ' month-daynum--today' : ''}`}>{day.getDate()}</div>

              <div className="month-chips">
                {dayEvents.slice(0, MAX_CHIPS).map((event) => {
                  const allDay = isAllDay(event)
                  const color = event.calendarColor || 'var(--accent)'
                  return (
                    <div
                      key={event.id}
                      className={`month-chip${allDay ? ' month-chip--allday' : ''}`}
                      style={allDay ? { background: color } : undefined}
                      title={`${allDay ? '' : formatTime(eventStart(event)) + ' '}${event.summary}`}
                      onClick={(e) => {
                        // Sem isso o clique subiria para o dia e trocaria de visão.
                        e.stopPropagation()
                        onSelectEvent && onSelectEvent(event)
                      }}
                    >
                      {!allDay && <span className="month-chip-dot" style={{ background: color }} />}
                      <span className="month-chip-text">
                        {!allDay && `${formatTime(eventStart(event))} `}
                        {event.summary}
                      </span>
                    </div>
                  )
                })}
                {dayEvents.length > MAX_CHIPS && (
                  <div className="month-more">+{dayEvents.length - MAX_CHIPS}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
