// Horário de trabalho, por dia da semana (0 = domingo).
// Segunda a quinta: 8h–12h e 13h–17h30. Sexta: 7h30–13h30.
const WORK_BLOCKS = {
  1: [['08:00', '12:00'], ['13:00', '17:30']],
  2: [['08:00', '12:00'], ['13:00', '17:30']],
  3: [['08:00', '12:00'], ['13:00', '17:30']],
  4: [['08:00', '12:00'], ['13:00', '17:30']],
  5: [['07:30', '13:30']],
}

function atTime(date, hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number)
  const d = new Date(date)
  d.setHours(hours, minutes, 0, 0)
  return d
}

export function workBlocksFor(date) {
  const spec = WORK_BLOCKS[date.getDay()] || []
  return spec.map(([from, to]) => ({ start: atTime(date, from), end: atTime(date, to) }))
}

export function isWorkday(date) {
  return workBlocksFor(date).length > 0
}

export function workMinutes(date) {
  return workBlocksFor(date).reduce((sum, block) => sum + (block.end - block.start) / 60000, 0)
}

// Quanto do expediente do dia já está comprometido, de 0 a 1 (pode passar de 1
// se houver compromisso fora do horário de trabalho).
export function workloadRatio(busyMinutes, date) {
  const available = workMinutes(date)
  if (available === 0) return busyMinutes > 0 ? 1 : 0
  return busyMinutes / available
}
