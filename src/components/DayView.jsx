import { useEffect, useState } from 'react'
import { formatTime, formatDuration, isToday } from '../lib/dates.js'
import { eventsOfDay, isAllDay, eventStart, eventEnd, findFreeGaps, nextEvent, currentEvent } from '../lib/events.js'
import { workBlocksFor, isWorkday } from '../lib/schedule.js'

function NextUp({ events }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  const current = currentEvent(events, now)
  const next = nextEvent(events, now)

  if (current) {
    const restam = Math.round((eventEnd(current) - now) / 60000)
    return (
      <div className="now-banner">
        <strong>Agora:</strong> {current.summary} · termina em {formatDuration(restam)}
      </div>
    )
  }
  if (next) {
    const faltam = Math.round((eventStart(next) - now) / 60000)
    return (
      <div className="now-banner">
        <strong>Próximo:</strong> {next.summary} · em {formatDuration(faltam)}
      </div>
    )
  }
  return <div className="now-banner muted">Nada mais marcado para hoje.</div>
}

export default function DayView({ date, events }) {
  const dayEvents = eventsOfDay(events, date)
  const allDay = dayEvents.filter(isAllDay)
  const timed = dayEvents.filter((e) => !isAllDay(e))
  const gaps = findFreeGaps(events, date, workBlocksFor(date))
  const showNow = isToday(date)
  const folga = !isWorkday(date)

  const timeline = [
    ...timed.map((event) => ({ kind: 'event', at: eventStart(event), event })),
    ...gaps.map((gap) => ({ kind: 'gap', at: gap.start, gap })),
  ].sort((a, b) => a.at - b.at)

  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>
        {date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
        {folga && ' · fora do expediente'}
      </div>

      {showNow && <NextUp events={timed} />}

      {allDay.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {allDay.map((event) => (
            <span
              key={event.id}
              className="pill"
              style={{
                background: 'var(--surface-2)',
                border: `1px solid ${event.calendarColor || 'var(--border-strong)'}`,
                color: 'var(--text-secondary)',
              }}
            >
              {event.summary}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {timeline.length === 0 && <div className="muted">Nenhum compromisso neste dia.</div>}

        {timeline.map((item, index) => {
          if (item.kind === 'gap') {
            const minutes = (item.gap.end - item.gap.start) / 60000
            return (
              <div key={`gap-${index}`} className="free-slot">
                livre {formatTime(item.gap.start)}–{formatTime(item.gap.end)} · {formatDuration(minutes)}
              </div>
            )
          }

          const event = item.event
          const isFocus = event.summary?.startsWith('Foco:')
          const borderColor = event.calendarColor || (isFocus ? 'var(--accent)' : 'var(--border-strong)')
          return (
            <div
              key={event.id}
              style={{
                borderLeft: `3px solid ${borderColor}`,
                background: isFocus ? 'var(--accent-bg)' : 'var(--surface-2)',
                padding: '6px 10px',
                borderRadius: 4,
              }}
            >
              <div className="muted" style={{ fontSize: 11, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span>{formatTime(eventStart(event))}–{formatTime(eventEnd(event))}</span>
                {event.calendarSummary && <span>· {event.calendarSummary}</span>}
              </div>
              <div style={{ fontSize: 14, fontWeight: isFocus ? 500 : 400 }}>{event.summary}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
