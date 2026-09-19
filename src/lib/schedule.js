// Horário de trabalho, por dia da semana (0 = domingo).
// Segunda a quinta: 8h–12h e 13h–17h30. Sexta: 7h30–13h30.
// Este é só o padrão de fábrica: quem trabalha em outro horário sobrescreve
// por `saveWorkSchedule`, guardado neste aparelho.
const PADRAO = {
  1: [['08:00', '12:00'], ['13:00', '17:30']],
  2: [['08:00', '12:00'], ['13:00', '17:30']],
  3: [['08:00', '12:00'], ['13:00', '17:30']],
  4: [['08:00', '12:00'], ['13:00', '17:30']],
  5: [['07:30', '13:30']],
}

const CHAVE = 'gestao-agenda:horario-trabalho'

export function horarioPadrao() {
  // Cópia profunda: quem recebe isto para editar não pode mexer no PADRAO.
  return JSON.parse(JSON.stringify(PADRAO))
}

export function loadWorkSchedule() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE))
    return salvo && typeof salvo === 'object' ? salvo : horarioPadrao()
  } catch {
    return horarioPadrao()
  }
}

export function saveWorkSchedule(schedule) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(schedule))
  } catch {
    // Sem permissão de guardar: vale só nesta sessão da aba.
  }
}

function atTime(date, hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number)
  const d = new Date(date)
  d.setHours(hours, minutes, 0, 0)
  return d
}

// `schedule` é opcional: quem já carregou a preferência (a tela Agora) passa
// a própria, e quem só quer o padrão de fábrica (testes) não precisa mexer no
// localStorage para receber algo coerente.
export function workBlocksFor(date, schedule = loadWorkSchedule()) {
  const spec = schedule[date.getDay()] || []
  return spec.map(([from, to]) => ({ start: atTime(date, from), end: atTime(date, to) }))
}

export function isWorkday(date, schedule = loadWorkSchedule()) {
  return workBlocksFor(date, schedule).length > 0
}

export function workMinutes(date, schedule = loadWorkSchedule()) {
  return workBlocksFor(date, schedule).reduce((sum, block) => sum + (block.end - block.start) / 60000, 0)
}

// Quanto do expediente do dia já está comprometido, de 0 a 1 (pode passar de 1
// se houver compromisso fora do horário de trabalho).
export function workloadRatio(busyMinutes, date, schedule = loadWorkSchedule()) {
  const available = workMinutes(date, schedule)
  if (available === 0) return busyMinutes > 0 ? 1 : 0
  return busyMinutes / available
}
