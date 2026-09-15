export function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function endOfDay(date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

export function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function addMonths(date, months) {
  const d = startOfDay(date)
  // Fixa o dia 1 antes de somar para o mês não transbordar (31/jan + 1 mês).
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  return d
}

export function startOfWeek(date) {
  const d = startOfDay(date)
  const weekday = d.getDay()
  return addDays(d, weekday === 0 ? -6 : 1 - weekday)
}

export function endOfWeek(date) {
  return endOfDay(addDays(startOfWeek(date), 6))
}

export function startOfMonth(date) {
  const d = startOfDay(date)
  d.setDate(1)
  return d
}

export function endOfMonth(date) {
  return endOfDay(addDays(addMonths(date, 1), -1))
}

export function isSameDay(a, b) {
  return a.toDateString() === b.toDateString()
}

export function isToday(date) {
  return isSameDay(date, new Date())
}

// Janela de busca no Calendar para a visão atual, com folga nas bordas para
// pegar eventos que atravessam o início ou o fim do período.
export function rangeForView(view, reference) {
  if (view === 'week') {
    return { timeMin: addDays(startOfWeek(reference), -1), timeMax: addDays(endOfWeek(reference), 1) }
  }
  if (view === 'month') {
    return { timeMin: addDays(startOfMonth(reference), -7), timeMax: addDays(endOfMonth(reference), 7) }
  }
  return { timeMin: addDays(startOfDay(reference), -1), timeMax: addDays(endOfDay(reference), 1) }
}

export function shiftReference(view, reference, direction) {
  if (view === 'week') return addDays(reference, 7 * direction)
  if (view === 'month') return addMonths(reference, direction)
  return addDays(reference, direction)
}

const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' no fuso local — toISOString() aqui jogaria para UTC e poderia
// trocar o dia.
export function toDateInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function toTimeInput(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromInputs(dateValue, timeValue = '00:00') {
  const [year, month, day] = dateValue.split('-').map(Number)
  const [hours, minutes] = timeValue.split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes, 0, 0)
}

export function formatTime(date) {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}`
}
