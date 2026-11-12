import { startOfWeek, addDays, isToday, formatTime, formatDuration } from '../lib/dates.js'
import { eventsOfDay, isAllDay, eventStart, eventEnd, busyMinutesOn, tasksDueOn, findConflicts } from '../lib/events.js'
import { isWorkday, workloadRatio, workMinutes } from '../lib/schedule.js'
import { corDaAgenda } from '../lib/corDaAgenda.js'
import { useRef } from 'react'
import useAltura from '../lib/useAltura.js'
import { quantosCabem } from '../lib/capacidade.js'

// Com sábado e domingo fora, sobra espaço pra mostrar mais coisa por dia sem
// a coluna virar uma lista cortada.
const MAX_EVENTS = 6
// Hora (1 linha) + título (até 2) + respiro do cartão + o espaço entre cartões.
const ALTURA_DO_CARTAO = 66

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
  // A grade estica até o fim da tela no computador (ver CSS): a altura dela
  // decide quantos compromissos cabem por dia, em vez do limite fixo.
  const gradeRef = useRef(null)
  const alturaDaGrade = useAltura(gradeRef)
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
      <div className="week-resumo">
        Semana · {formatDuration(weekMinutes)} de {formatDuration(weekCapacity)} de expediente
        {weekTasks > 0 && ` · ${weekTasks} ${weekTasks === 1 ? 'tarefa vence' : 'tarefas vencem'}`}
      </div>

      <div className="week-grid" ref={gradeRef}>
        {days.map((day) => {
          const dayEvents = eventsOfDay(events, day)
          // Dia inteiro vira uma tira no topo (como no Dia): não tem horário
          // para encabeçar um cartão e, empilhado com os outros, empurrava a
          // hora de quem vem depois.
          const diaInteiro = dayEvents.filter((e) => isAllDay(e))
          const comHora = dayEvents.filter((e) => !isAllDay(e))
          const level = loadLevel(busyMinutesOn(events, day, occupies), day, schedule)
          const dueToday = tasksDueOn(tasks, day)
          // O que sobra da coluna depois do cabeçalho do dia, da tira de dia
          // inteiro, das tarefas que vencem nele e da linha do "+N" é para
          // compromissos. Cada cartão tem hora + até duas linhas de título.
          const limite = quantosCabem(alturaDaGrade, {
            alturaItem: ALTURA_DO_CARTAO,
            reservado: 76 + diaInteiro.length * 32 + dueToday.length * ALTURA_DO_CARTAO,
            minimo: MAX_EVENTS,
          })
          const shown = comHora.slice(0, limite)
          const hasConflict = findConflicts(dayEvents, occupies).length > 0
          const hoje = isToday(day)

          return (
            <div
              key={day.toDateString()}
              className={`week-day${hoje ? ' week-day--hoje' : ''}`}
              onClick={() => onSelectDay && onSelectDay(day)}
            >
              <div className="week-dia-topo">
                <span className="week-dia-data">
                  <span className="week-dia-nome">{day.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</span>
                  <span className={`week-dia-num${hoje ? ' is-hoje' : ''}`}>{day.getDate()}</span>
                </span>
                <span className="week-dia-sinais">
                  {/* Só um sinal discreto aqui — o aviso de verdade, com os
                      nomes dos compromissos, é o Banner do Dia. */}
                  {hasConflict && (
                    <span className="pill alta week-pill" title="Compromissos que se cruzam neste dia">
                      conflito
                    </span>
                  )}
                  <span className={`pill ${level.className} week-pill`}>{level.label}</span>
                </span>
              </div>

              <div className="week-lista">
                {dayEvents.length === 0 && dueToday.length === 0 && (
                  <span className="muted week-vazio">Nada marcado</span>
                )}
                {diaInteiro.map((event) => {
                  const aside = declined(event) || isInfo(event)
                  return (
                    <div
                      key={event.id}
                      className={`week-allday${aside ? ' week-event--aside' : ''}${declined(event) ? ' is-declined' : ''}`}
                      style={{ borderLeftColor: corDaAgenda(event.calendarColor, 'var(--border-strong)') }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectEvent && onSelectEvent(event)
                      }}
                    >
                      <span className="week-event-text">{event.summary}</span>
                    </div>
                  )
                })}
                {shown.map((event) => {
                  const aside = declined(event) || isInfo(event)
                  return (
                    <div
                      key={event.id}
                      className={`week-event clicavel${aside ? ' week-event--aside' : ''}${declined(event) ? ' is-declined' : ''}`}
                      style={{ borderLeftColor: corDaAgenda(event.calendarColor, 'var(--border-strong)') }}
                      onClick={(e) => {
                        // Sem isso o clique subiria para o dia e trocaria de visão.
                        e.stopPropagation()
                        onSelectEvent && onSelectEvent(event)
                      }}
                    >
                      <span className="week-event-hora">
                        {formatTime(eventStart(event))}–{formatTime(eventEnd(event))}
                      </span>
                      <span className="week-event-text">
                        <button
                          type="button"
                          className="titulo-botao"
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectEvent && onSelectEvent(event)
                          }}
                        >
                          {event.summary}
                        </button>
                      </span>
                    </div>
                  )
                })}
                {comHora.length > limite && (
                  <span className="muted week-mais">+{comHora.length - limite} mais</span>
                )}
                {dueToday.map((task) => (
                  <div
                    key={task.id}
                    className={`week-event week-event--prazo${onSelectTask ? ' clicavel' : ''}`}
                    onClick={(e) => {
                      // Mesma razão do stopPropagation no evento acima: sem
                      // isso o clique subiria e trocaria de visão.
                      e.stopPropagation()
                      onSelectTask && onSelectTask(task)
                    }}
                  >
                    <span className="week-event-hora">prazo</span>
                    <span className="week-event-text">
                        <button
                          type="button"
                          className="titulo-botao"
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectTask && onSelectTask(task)
                          }}
                        >
                          {task.title}
                        </button>
                      </span>
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
              <span className="week-dot" style={{ background: corDaAgenda(event.calendarColor) }} />
              {day.toLocaleDateString('pt-BR', { weekday: 'short' })}
              {!isAllDay(event) && ` ${formatTime(eventStart(event))}`} · {event.summary}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
