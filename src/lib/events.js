import { startOfDay, endOfDay, addDays } from './dates.js'

// "2026-09-15" com new Date() vira meia-noite UTC, que no Brasil cai no dia
// anterior. Por isso a data de dia inteiro é montada campo a campo.
function parseDateOnly(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function isAllDay(event) {
  return Boolean(event.start?.date && !event.start?.dateTime)
}

export function eventStart(event) {
  if (event.start?.dateTime) return new Date(event.start.dateTime)
  if (event.start?.date) return parseDateOnly(event.start.date)
  return null
}

export function eventEnd(event) {
  if (event.end?.dateTime) return new Date(event.end.dateTime)
  // Em evento de dia inteiro o end.date do Google é exclusivo: um evento de um
  // dia só termina no dia seguinte.
  if (event.end?.date) return endOfDay(addDays(parseDateOnly(event.end.date), -1))
  return eventStart(event)
}

export function occursOnDay(event, day) {
  const start = eventStart(event)
  if (!start) return false
  const end = eventEnd(event) || start
  return start <= endOfDay(day) && end >= startOfDay(day)
}

export function durationMinutes(event) {
  const start = eventStart(event)
  const end = eventEnd(event)
  if (!start || !end) return 0
  return Math.max(0, (end - start) / 60000)
}

export function sortByStart(events) {
  return [...events].sort((a, b) => eventStart(a) - eventStart(b))
}

export function eventsOfDay(events, day) {
  return sortByStart(events.filter((e) => occursOnDay(e, day)))
}

// Tarefas com prazo justamente neste dia — usado pela Semana e pelo Mês, que
// antes tinham cada uma a sua cópia desta mesma conta.
export function tasksDueOn(tasks, day) {
  return tasks.filter((t) => {
    if (!t.due || t.status === 'completed') return false
    const due = new Date(t.due)
    return due.toDateString() === day.toDateString()
  })
}

export function nextEvent(events, now = new Date()) {
  return sortByStart(events.filter((e) => !isAllDay(e) && eventStart(e) > now))[0] || null
}

export function currentEvent(events, now = new Date()) {
  return events.find((e) => !isAllDay(e) && eventStart(e) <= now && eventEnd(e) > now) || null
}

// `occupies` permite excluir do cálculo os eventos que não consomem o seu
// tempo: agenda informativa, ou compromisso de presença não confirmada.
export function busyMinutesOn(events, day, occupies = () => true) {
  return events
    .filter((e) => !isAllDay(e) && occursOnDay(e, day) && occupies(e))
    .reduce((sum, e) => sum + durationMinutes(e), 0)
}

// Vãos livres dentro dos blocos de expediente do dia, para enxergar onde cabe
// um bloco de foco sem cruzar os compromissos na cabeça. Recebe os blocos de
// fora para não misturar o horário de trabalho com a leitura do Calendar.
export function findFreeGaps(events, day, blocks, { minMinutes = 30, occupies = () => true } = {}) {
  if (!blocks || blocks.length === 0) return []

  const busy = events
    .filter((e) => !isAllDay(e) && occursOnDay(e, day) && occupies(e))
    .map((e) => ({ start: eventStart(e), end: eventEnd(e) }))
    .sort((a, b) => a.start - b.start)

  const gaps = []
  for (const block of blocks) {
    let cursor = block.start
    for (const slot of busy) {
      if (slot.end <= cursor) continue
      if (slot.start >= block.end) break
      if (slot.start > cursor) gaps.push({ start: new Date(cursor), end: new Date(slot.start) })
      if (slot.end > cursor) cursor = slot.end > block.end ? block.end : slot.end
    }
    if (cursor < block.end) gaps.push({ start: new Date(cursor), end: new Date(block.end) })
  }

  return gaps.filter((gap) => gap.end > gap.start && (gap.end - gap.start) / 60000 >= minMinutes)
}
