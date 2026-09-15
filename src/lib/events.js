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

export function nextEvent(events, now = new Date()) {
  return sortByStart(events.filter((e) => !isAllDay(e) && eventStart(e) > now))[0] || null
}

export function currentEvent(events, now = new Date()) {
  return events.find((e) => !isAllDay(e) && eventStart(e) <= now && eventEnd(e) > now) || null
}

// Vãos livres do dia dentro do horário útil, para enxergar onde cabe um bloco
// de foco sem precisar cruzar os compromissos na cabeça.
export function findFreeGaps(events, day, { startHour = 8, endHour = 20, minMinutes = 30 } = {}) {
  const windowStart = new Date(day)
  windowStart.setHours(startHour, 0, 0, 0)
  const windowEnd = new Date(day)
  windowEnd.setHours(endHour, 0, 0, 0)

  const busy = events
    .filter((e) => !isAllDay(e) && occursOnDay(e, day))
    .map((e) => ({ start: eventStart(e), end: eventEnd(e) }))
    .sort((a, b) => a.start - b.start)

  const gaps = []
  let cursor = windowStart
  for (const slot of busy) {
    if (slot.start > cursor) {
      gaps.push({ start: new Date(cursor), end: new Date(Math.min(slot.start, windowEnd)) })
    }
    if (slot.end > cursor) cursor = slot.end
  }
  if (cursor < windowEnd) gaps.push({ start: new Date(cursor), end: new Date(windowEnd) })

  return gaps.filter((gap) => gap.end > gap.start && (gap.end - gap.start) / 60000 >= minMinutes)
}
