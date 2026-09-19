import { useEffect, useState } from 'react'
import { formatTime, formatDuration, isToday } from '../lib/dates.js'
import {
  eventsOfDay,
  isAllDay,
  eventStart,
  eventEnd,
  findFreeGaps,
  nextEvent,
  currentEvent,
  findConflicts,
  tasksDueOn,
} from '../lib/events.js'
import { workBlocksFor, isWorkday } from '../lib/schedule.js'
import { isOverdueTask } from '../lib/tasks.js'
import { PRIORITY_LABEL } from '../lib/priority.js'
import Banner from './Banner.jsx'

// Sessões de foco seguidas da mesma tarefa (pomodoro com pausa no meio) viram
// um cartão só, em vez de repetir o mesmo título várias vezes na lista.
const INTERVALO_MESMO_FOCO_MIN = 20

function isFocusEvent(event) {
  return Boolean(event.summary?.startsWith('Foco:'))
}

function groupFocusSessions(events) {
  const grupos = []
  let i = 0
  while (i < events.length) {
    const atual = events[i]
    if (!isFocusEvent(atual)) {
      grupos.push({ kind: 'event', event: atual })
      i += 1
      continue
    }
    const sessoes = [atual]
    let j = i + 1
    while (j < events.length) {
      const proxima = events[j]
      const ultima = sessoes[sessoes.length - 1]
      const intervalo = (eventStart(proxima) - eventEnd(ultima)) / 60000
      if (proxima.summary === atual.summary && intervalo <= INTERVALO_MESMO_FOCO_MIN) {
        sessoes.push(proxima)
        j += 1
      } else break
    }
    grupos.push(sessoes.length > 1 ? { kind: 'focus-group', sessions: sessoes } : { kind: 'event', event: atual })
    i = j
  }
  return grupos
}

function periodOf(date) {
  const hora = date.getHours()
  if (hora < 12) return 'Manhã'
  if (hora < 18) return 'Tarde'
  return 'Noite'
}

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

export default function DayView({
  date,
  events,
  tasks = [],
  onSelectEvent,
  onSelectTask,
  onCompleteTask,
  occupies = () => true,
  isInfo = () => false,
  asksPresence = () => false,
  presenceOf = () => null,
  declined = () => false,
  onSetPresence,
  schedule,
}) {
  const [now, setNow] = useState(() => new Date())
  const showNow = isToday(date)

  useEffect(() => {
    if (!showNow) return
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [showNow])

  const dayEvents = eventsOfDay(events, date)
  const allDay = dayEvents.filter(isAllDay)
  const timed = dayEvents.filter((e) => !isAllDay(e))
  const gaps = findFreeGaps(events, date, workBlocksFor(date, schedule), { occupies })
  const folga = !isWorkday(date, schedule)
  const conflicts = findConflicts(dayEvents, occupies)
  // Tarefas com prazo neste dia: antes o único lugar onde uma tarefa a fazer
  // "hoje" aparecia era numa lista à parte (o Backlog) — a tela onde a pessoa
  // de fato executa o dia inteiro ignorava tarefa por completo.
  const tarefasDoDia = tasksDueOn(tasks, date)

  const timeline = [
    ...groupFocusSessions(timed).map((item) => ({
      ...item,
      at: eventStart(item.kind === 'focus-group' ? item.sessions[0] : item.event),
      end: eventEnd(item.kind === 'focus-group' ? item.sessions[item.sessions.length - 1] : item.event),
    })),
    ...gaps.map((gap) => ({ kind: 'gap', at: gap.start, end: gap.end, gap })),
  ].sort((a, b) => a.at - b.at)

  // Cabeçalhos de período só valem a pena quando o dia realmente se espalha
  // por mais de um; num dia leve, com tudo de manhã, eles só atrapalhariam.
  const temMaisDeUmPeriodo = new Set(timeline.map((item) => periodOf(item.at))).size > 1

  const rendered = []
  let ultimoPeriodo = null
  let dividerFeito = false
  for (const item of timeline) {
    const periodo = periodOf(item.at)
    if (temMaisDeUmPeriodo && periodo !== ultimoPeriodo) {
      rendered.push({ kind: 'period', label: periodo, key: `periodo-${periodo}-${item.at.getTime()}` })
      ultimoPeriodo = periodo
    }
    if (showNow && !dividerFeito && item.end > now) {
      rendered.push({ kind: 'now-divider', key: 'agora' })
      dividerFeito = true
    }
    rendered.push(item)
  }

  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>
        {date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
        {folga && ' · fora do expediente'}
      </div>

      {conflicts.length > 0 && (
        <Banner tone="warning">
          {conflicts.length === 1 ? 'Dois compromissos se cruzam: ' : `${conflicts.length} pares de compromissos se cruzam: `}
          {conflicts
            .slice(0, 2)
            .map(([a, b]) => `"${a.summary || '(sem título)'}" e "${b.summary || '(sem título)'}"`)
            .join('; ')}
          {conflicts.length > 2 && ` e mais ${conflicts.length - 2}`}
        </Banner>
      )}

      {/* O "Agora/Próximo" é sobre o que está acontecendo com você. O que é
          recusado ou meramente informativo continua listado abaixo, mas não é
          anunciado aqui como se fosse compromisso seu. */}
      {showNow && <NextUp events={timed.filter((e) => !declined(e) && !isInfo(e))} />}

      {allDay.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {allDay.map((event) => (
            <span
              key={event.id}
              className="pill"
              onClick={() => onSelectEvent && onSelectEvent(event)}
              style={{
                background: 'var(--surface-2)',
                border: `1px solid ${event.calendarColor || 'var(--border-strong)'}`,
                color: 'var(--text-secondary)',
                cursor: onSelectEvent ? 'pointer' : 'default',
              }}
            >
              {event.summary}
            </span>
          ))}
        </div>
      )}

      {tarefasDoDia.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {tarefasDoDia.map((task) => {
            const atrasada = isOverdueTask(task)
            return (
              <div
                key={task.id}
                onClick={() => onSelectTask && onSelectTask(task)}
                className="day-event"
                style={{
                  borderLeft: `3px solid ${atrasada ? 'var(--urgent)' : 'var(--border-strong)'}`,
                  background: 'var(--surface-2)',
                  cursor: onSelectTask ? 'pointer' : 'default',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 'var(--body-md)' }}>{task.title}</div>
                  <span className={`pill ${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
                  {task.contexto && (
                    <span className="muted" style={{ marginLeft: 8, fontSize: 'var(--label-sm)' }}>@{task.contexto}</span>
                  )}
                  {atrasada && (
                    <span style={{ marginLeft: 8, fontSize: 'var(--label-sm)', color: 'var(--urgent)' }}>atrasada</span>
                  )}
                </div>
                {onCompleteTask && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onCompleteTask(task) }}>
                    Concluir
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {timeline.length === 0 && tarefasDoDia.length === 0 && <div className="muted">Nenhum compromisso neste dia.</div>}

        {rendered.map((item) => {
          if (item.kind === 'period') {
            return (
              <div key={item.key} className="day-period-header">
                {item.label}
              </div>
            )
          }

          if (item.kind === 'now-divider') {
            return (
              <div key={item.key} className="now-divider">
                <span>agora · {formatTime(now)}</span>
              </div>
            )
          }

          const passou = showNow && item.end <= now

          if (item.kind === 'gap') {
            const minutes = (item.gap.end - item.gap.start) / 60000
            return (
              <div key={`gap-${item.gap.start.getTime()}`} className={passou ? 'free-slot free-slot--passou' : 'free-slot'}>
                livre {formatTime(item.gap.start)}–{formatTime(item.gap.end)} · {formatDuration(minutes)}
              </div>
            )
          }

          if (item.kind === 'focus-group') {
            const primeira = item.sessions[0]
            const ultima = item.sessions[item.sessions.length - 1]
            const totalMin = Math.round(
              item.sessions.reduce((soma, sessao) => soma + (eventEnd(sessao) - eventStart(sessao)) / 60000, 0)
            )
            return (
              <div
                key={`foco-${primeira.id}`}
                className="day-event"
                style={{
                  borderLeft: '3px solid var(--accent)',
                  background: 'var(--accent-bg)',
                  opacity: passou ? 0.55 : 1,
                }}
              >
                <div className="muted" style={{ fontSize: 'var(--label-sm)' }}>
                  {formatTime(eventStart(primeira))}–{formatTime(eventEnd(ultima))} · {item.sessions.length} sessões ·{' '}
                  {formatDuration(totalMin)} de foco
                </div>
                <div style={{ fontSize: 'var(--body-md)', fontWeight: 500 }}>{primeira.summary}</div>
              </div>
            )
          }

          const event = item.event
          const isFocus = isFocusEvent(event)
          const borderColor = event.calendarColor || (isFocus ? 'var(--accent)' : 'var(--border-strong)')
          const info = isInfo(event)
          const recusado = declined(event)
          const pedePresenca = asksPresence(event)
          const presenca = presenceOf(event)
          const mostrarAgenda = event.calendarSummary && !event.calendarIsPrimary

          return (
            <div
              key={event.id}
              onClick={() => onSelectEvent && onSelectEvent(event)}
              className={info || recusado ? 'day-event day-event--aside' : 'day-event'}
              style={{
                borderLeft: `3px solid ${borderColor}`,
                background: isFocus ? 'var(--accent-bg)' : 'var(--surface-2)',
                cursor: onSelectEvent ? 'pointer' : 'default',
                opacity: passou && !info && !recusado ? 0.55 : undefined,
              }}
            >
              <div className="muted" style={{ fontSize: 'var(--label-sm)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span>{formatTime(eventStart(event))}–{formatTime(eventEnd(event))}</span>
                {mostrarAgenda && <span>· {event.calendarSummary}</span>}
                {info && <span>· informativo</span>}
              </div>

              <div style={{
                fontSize: 'var(--body-md)',
                fontWeight: isFocus ? 500 : 400,
                textDecoration: recusado ? 'line-through' : 'none',
              }}>
                {event.summary}
              </div>

              {pedePresenca && !passou && (
                <div className="presence-row" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={presenca === 'vou' ? 'presence-on' : ''}
                    onClick={() => onSetPresence(event, presenca === 'vou' ? null : 'vou')}
                  >
                    Vou
                  </button>
                  <button
                    className={presenca === 'nao' ? 'presence-off' : ''}
                    onClick={() => onSetPresence(event, presenca === 'nao' ? null : 'nao')}
                  >
                    Não vou
                  </button>
                  {!presenca && <span className="muted" style={{ fontSize: 'var(--label-sm)' }}>não conta no seu tempo até confirmar</span>}
                </div>
              )}

              {pedePresenca && passou && presenca && (
                <div className="muted" style={{ fontSize: 'var(--label-sm)', marginTop: 4 }}>
                  {presenca === 'vou' ? 'Você foi' : 'Você não foi'}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
