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
  conflitosEmAberto,
  restoDoVao,
  tasksDueOn,
} from '../lib/events.js'
import { workBlocksFor, isWorkday } from '../lib/schedule.js'
import { isOverdueTask } from '../lib/tasks.js'
import { PRIORITY_LABEL } from '../lib/priority.js'
import Banner from './Banner.jsx'
import { corDaAgenda } from '../lib/corDaAgenda.js'

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
    // Neutro, e não no âmbar do "Agora": o aviso de choque logo acima também
    // é âmbar, e duas barras iguais empilhadas faziam o problema parecer só
    // mais um aviso. O destaque fica para o que está acontecendo e para o
    // que precisa de atenção.
    return (
      <div className="now-banner now-banner--proximo">
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
  // Hoje só vale o choque que ainda não terminou; em outros dias vale tudo,
  // para quem está planejando ou revendo.
  const todosOsChoques = findConflicts(dayEvents, occupies)
  const conflicts = showNow ? conflitosEmAberto(todosOsChoques, now) : todosOsChoques
  // O aviso do topo diz que há choque; achar QUAL cartão choca, num dia cheio,
  // ficava por conta de quem olha. Cada cartão sabe com quem se cruza.
  const chocaCom = new Map()
  for (const [a, b] of conflicts) {
    chocaCom.set(a, [...(chocaCom.get(a) || []), b])
    chocaCom.set(b, [...(chocaCom.get(b) || []), a])
  }
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
      {/* A data já está na barra de período, logo acima: repeti-la aqui
          gastava uma linha inteira (e no celular, a tela toda é uma coluna). */}
      {folga && (
        <div className="muted" style={{ marginBottom: 10 }}>
          Fora do expediente
        </div>
      )}

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

      {/* Compromisso de dia inteiro é compromisso, não filtro: leva a mesma
          barra de cor da agenda dos cartões da linha do tempo. Era um chip com
          anel inteiro na cor da agenda, e o de cor viva parecia um filtro
          selecionado ao lado dos cinzas. */}
      {allDay.length > 0 && (
        <div className="day-allday-lista">
          {allDay.map((event) => {
            const Marca = onSelectEvent ? 'button' : 'div'
            return (
              <Marca
                key={event.id}
                {...(onSelectEvent ? { type: 'button', onClick: () => onSelectEvent(event) } : {})}
                className="day-allday"
                style={{ borderLeftColor: corDaAgenda(event.calendarColor, 'var(--border-strong)') }}
              >
                {event.summary}
              </Marca>
            )
          })}
        </div>
      )}

      {/* Uma linha por tarefa, sem botão: o painel de trabalho ao lado mostra
          estas mesmas tarefas com as ações completas, e repetir o cartão
          inteiro aqui só fazia o mesmo item aparecer duas vezes na mesma
          tela, com dois conjuntos de botões diferentes. Aqui o papel é outro
          — dizer o que vence neste dia, junto da linha do tempo dele. */}
      {tarefasDoDia.length > 0 && (
        <div className="day-tarefas">
          <div className="muted" style={{ fontSize: 'var(--label-sm)', marginBottom: 2 }}>vence neste dia</div>
          {tarefasDoDia.map((task) => {
            const atrasada = isOverdueTask(task)
            return (
              <button
                key={task.id}
                type="button"
                className="day-tarefa"
                onClick={() => onSelectTask && onSelectTask(task)}
              >
                <span className={`day-tarefa-marca${atrasada ? ' is-atrasada' : ''}`} aria-hidden="true" />
                <span className="day-tarefa-titulo">{task.title}</span>
                <span className="muted" style={{ fontSize: 'var(--label-sm)', flexShrink: 0 }}>
                  {atrasada ? 'atrasada' : PRIORITY_LABEL[task.priority]}
                  {task.contexto && ` · @${task.contexto}`}
                </span>
              </button>
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
            // O vão em que o "agora" cai já começou: dizer "livre 08:00–12:00
            // · 4h" logo abaixo de "agora · 08:19" fazia parecer que as 4h
            // ainda estavam inteiras, e contradizia o painel ao lado
            // ("Livre agora até 12:00 · 3h41"). Aqui vale o que resta.
            const { emCurso, minutos: minutes } = restoDoVao(item.gap, showNow ? now : null)
            return (
              <div key={`gap-${item.gap.start.getTime()}`} className={passou ? 'free-slot free-slot--passou' : 'free-slot'}>
                {emCurso
                  ? `livre agora até ${formatTime(item.gap.end)} · ${formatDuration(minutes)}`
                  : `livre ${formatTime(item.gap.start)}–${formatTime(item.gap.end)} · ${formatDuration(minutes)}`}
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
          const borderColor = corDaAgenda(event.calendarColor, isFocus ? 'var(--accent)' : 'var(--border-strong)')
          const info = isInfo(event)
          const recusado = declined(event)
          const pedePresenca = asksPresence(event)
          const presenca = presenceOf(event)
          const mostrarAgenda = event.calendarSummary && !event.calendarIsPrimary
          const choques = chocaCom.get(event) || []

          return (
            <div
              key={event.id}
              onClick={() => onSelectEvent && onSelectEvent(event)}
              className={`day-event${info || recusado ? ' day-event--aside' : ''}${onSelectEvent ? ' clicavel' : ''}`}
              style={{
                borderLeft: `3px solid ${borderColor}`,
                background: isFocus ? 'var(--accent-bg)' : 'var(--surface-2)',
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
                {/* O título é o botão de verdade (teclado e leitor de tela
                    entram por ele); o cartão todo continua clicável para o
                    mouse. O cartão não vira role="button" porque guarda
                    outros botões ("Vou / Não vou"), e filhos de um botão não
                    são expostos aos leitores de tela. */}
                {onSelectEvent ? (
                  <button
                    type="button"
                    className="titulo-botao"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectEvent(event)
                    }}
                  >
                    {event.summary}
                  </button>
                ) : (
                  event.summary
                )}
              </div>

              {choques.length > 0 && (
                <div className="day-event-conflito">
                  <span aria-hidden="true">⚠</span>
                  <span>
                    Choca com “{choques[0].summary || '(sem título)'}” ({formatTime(eventStart(choques[0]))}–{formatTime(eventEnd(choques[0]))})
                    {choques.length > 1 && ` e mais ${choques.length - 1}`}
                  </span>
                </div>
              )}

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
