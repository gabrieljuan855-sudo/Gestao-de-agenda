import { startOfWeek, addDays, isToday, formatTime, formatDuration } from '../lib/dates.js'
import { eventsOfDay, isAllDay, eventStart, eventEnd, busyMinutesOn, tasksDueOn, findConflicts } from '../lib/events.js'
import { isWorkday, workloadRatio, workMinutes } from '../lib/schedule.js'

// Com sábado e domingo fora, sobra espaço pra mostrar mais coisa por dia sem
// a coluna virar uma lista cortada.
const MAX_EVENTS = 6

// A carga é relativa ao expediente daquele dia: 2h numa sexta (6h de
// expediente) pesam mais do que 2h numa segunda (8h30).
function loadLevel(busyMinutes, day, schedule) {
  if (!isWorkday(day, schedule)) {
    return busyMinutes > 0
      ? { label: 'folga', className: 'media' }
      : { label: 'folga', className: 'baixa' }
  }
  const ratio = workloadRatio(busyMinutes, day, schedule)
  if (ratio >= 0.75) return { label: 'lotado', className: 'alta' }
  if (ratio >= 0.4) return { label: 'médio', className: 'media' }
  return { label: 'livre', className: 'baixa' }
}

export default function WeekView({
  reference,
  events,
  tasks = [],
  onSelectDay,
  onSelectEvent,
  onSelectTask,
  occupies = () => true,
  declined = () => false,
  isInfo = () => false,
  schedule,
}) {
  const start = startOfWeek(reference)
  const allDays = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  // O expediente é de segunda a sexta, e sábado/domingo quase sempre vêm
  // vazios ("folga —"): tirá-los da grade dá mais espaço pros cinco dias que
  // importam. Um compromisso que caia no fim de semana não desaparece, só
  // sai da grade e vira uma linha de aviso embaixo.
  //
  // `schedule` precisa ser o mesmo horário que o resto do app já carregou
  // (App.jsx) — sem passar adiante, cada chamada de isWorkday/workMinutes
  // cairia no próprio valor padrão e leria o localStorage por conta
  // própria, uma segunda fonte de verdade que podia divergir da tela
  // Horário sem nenhum aviso.
  const diasUteis = allDays.filter((d) => isWorkday(d, schedule))
  // Se por algum motivo não sobrar nenhum dia útil (ex.: horário ainda não
  // carregou), mostrar os 7 dias em vez de uma grade vazia — sem essa
  // salvaguarda, a semana inteira desaparecia sem nenhuma pista visível.
  const days = diasUteis.length > 0 ? diasUteis : allDays
  const weekendDays = allDays.filter((d) => !days.includes(d))

  const weekMinutes = days.reduce((sum, day) => sum + busyMinutesOn(events, day, occupies), 0)
  const weekCapacity = days.reduce((sum, day) => sum + workMinutes(day, schedule), 0)
  const weekTasks = allDays.reduce((sum, day) => sum + tasksDueOn(tasks, day).length, 0)

  const weekendItems = weekendDays.flatMap((day) =>
    eventsOfDay(events, day).map((event) => ({ day, event }))
  )

  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>
        Semana · {formatDuration(weekMinutes)} de {formatDuration(weekCapacity)} de expediente
        {weekTasks > 0 && ` · ${weekTasks} ${weekTasks === 1 ? 'tarefa vence' : 'tarefas vencem'}`}
      </div>

      <div className="week-grid">
        {days.map((day) => {
          const dayEvents = eventsOfDay(events, day)
          const level = loadLevel(busyMinutesOn(events, day, occupies), day, schedule)
          const dueToday = tasksDueOn(tasks, day)
          const shown = dayEvents.slice(0, MAX_EVENTS)
          const hasConflict = findConflicts(dayEvents, occupies).length > 0

          return (
            <div
              key={day.toDateString()}
              className="week-day"
              onClick={() => onSelectDay && onSelectDay(day)}
              style={{ borderColor: isToday(day) ? 'var(--border-strong)' : 'var(--border)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 'var(--label-md)', fontWeight: isToday(day) ? 600 : 500 }}>
                  {day.toLocaleDateString('pt-BR', { weekday: 'short' })} {day.getDate()}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  {/* Só um sinal discreto aqui — o aviso de verdade, com os
                      nomes dos compromissos, é o Banner do Dia. */}
                  {hasConflict && (
                    <span className="pill alta" style={{ fontSize: 'var(--label-xs)', padding: '1px 6px' }} title="Compromissos que se cruzam neste dia">
                      conflito
                    </span>
                  )}
                  <span className={`pill ${level.className}`} style={{ fontSize: 'var(--label-xs)', padding: '1px 6px' }}>
                    {level.label}
                  </span>
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                {dayEvents.length === 0 && dueToday.length === 0 && (
                  <span className="muted" style={{ fontSize: 'var(--label-sm)' }}>—</span>
                )}
                {shown.map((event) => {
                  const aside = declined(event) || isInfo(event)
                  return (
                    <div
                      key={event.id}
                      className={`week-event${aside ? ' week-event--aside' : ''}${declined(event) ? ' is-declined' : ''}`}
                      onClick={(e) => {
                        // Sem isso o clique subiria para o dia e trocaria de visão.
                        e.stopPropagation()
                        onSelectEvent && onSelectEvent(event)
                      }}
                    >
                      <span
                        className="week-dot"
                        style={{ background: event.calendarColor || 'var(--accent)' }}
                      />
                      <span className="week-event-text">
                        {!isAllDay(event) &&
                          `${formatTime(eventStart(event))}–${formatTime(eventEnd(event))} `}
                        {event.summary}
                      </span>
                    </div>
                  )
                })}
                {dayEvents.length > MAX_EVENTS && (
                  <span className="muted" style={{ fontSize: 'var(--label-xs)' }}>+{dayEvents.length - MAX_EVENTS} mais</span>
                )}
                {dueToday.map((task) => (
                  <div
                    key={task.id}
                    className="week-event"
                    style={{ opacity: 0.85, cursor: onSelectTask ? 'pointer' : 'default' }}
                    onClick={(e) => {
                      // Mesma razão do stopPropagation no evento acima: sem
                      // isso o clique subiria e trocaria de visão.
                      e.stopPropagation()
                      onSelectTask && onSelectTask(task)
                    }}
                  >
                    <span className="week-dot" style={{ background: 'var(--important)' }} />
                    <span className="week-event-text">prazo: {task.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {weekendItems.length > 0 && (
        <div className="week-weekend">
          <span className="muted" style={{ fontSize: 'var(--label-md)' }}>Fim de semana:</span>
          {weekendItems.map(({ day, event }) => (
            <button
              key={event.id}
              className="week-weekend-chip"
              onClick={() => (onSelectEvent ? onSelectEvent(event) : onSelectDay && onSelectDay(day))}
            >
              <span className="week-dot" style={{ background: event.calendarColor || 'var(--accent)' }} />
              {day.toLocaleDateString('pt-BR', { weekday: 'short' })}
              {!isAllDay(event) && ` ${formatTime(eventStart(event))}`} · {event.summary}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
