// Quantos blocos de foco (e quantos minutos) já foram feitos em cada tarefa.
// Fica só neste aparelho, de propósito: é um contador de progresso, não um
// registro que precise valer em todo lugar — o Calendar já é o registro
// oficial, e cada evento de foco carrega o id da tarefa (ver FOCUS_TASK_PROP)
// para o dia em que esse contador precisar ser reconstruído de lá.
const STATS_KEY = 'gestao-agenda:foco-por-tarefa'

// Nome da propriedade privada gravada no evento "Foco: ..." no Calendar, que
// liga esse bloco de volta à tarefa de origem — assim uma tarefa renomeada
// não perde a ligação com os blocos já feitos.
export const FOCUS_TASK_PROP = 'gestaoAgendaTarefaId'

function read() {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY)) || {}
  } catch {
    return {}
  }
}

function write(value) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(value))
  } catch {
    // Sem permissão para guardar: o contador só não persiste neste aparelho.
  }
}

// Chamado quando um bloco de foco termina de verdade (25 min correram até o
// fim). Reiniciar ou encerrar antes da hora não conta sessão nenhuma.
export function registerFocusSession(taskId, minutes) {
  if (!taskId) return null
  const all = read()
  const atual = all[taskId] || { sessions: 0, minutes: 0 }
  const proximo = { sessions: atual.sessions + 1, minutes: atual.minutes + minutes }
  all[taskId] = proximo
  write(all)
  return proximo
}

export function focusStatsFor(taskId) {
  if (!taskId) return null
  return read()[taskId] || null
}

// Se o cache deste aparelho não tiver nada (aparelho novo, cache limpo),
// tenta reconstruir a partir dos eventos "Foco: ..." já carregados na
// tela — que guardam o id da tarefa em extendedProperties.private (ver
// FOCUS_TASK_PROP). É uma reconstrução parcial, não uma auditoria completa:
// só enxerga o que está no período que a tela carregou até agora, não a
// vida inteira da tarefa. Ainda assim é melhor do que mostrar zero numa
// tarefa que já tem semanas de foco registradas no Calendar.
export function focusStatsFromEvents(events, taskId) {
  if (!taskId) return null
  const meus = events.filter((e) => e.extendedProperties?.private?.[FOCUS_TASK_PROP] === taskId)
  if (meus.length === 0) return null
  const minutes = meus.reduce((soma, e) => {
    const start = new Date(e.start?.dateTime || e.start?.date)
    const end = new Date(e.end?.dateTime || e.end?.date)
    return soma + Math.max(0, (end - start) / 60000)
  }, 0)
  return { sessions: meus.length, minutes: Math.round(minutes) }
}

// Junta as duas fontes ficando com o maior valor de cada uma — o cache local
// pode ter sessões de fora do período carregado agora, e o Calendar pode ter
// sessões de antes deste aparelho existir; nenhuma das duas sozinha garante
// o quadro completo, mas a maior das duas nunca subestima o que já foi feito.
export function combinedFocusStats(taskId, events = []) {
  const local = focusStatsFor(taskId)
  const doCalendario = focusStatsFromEvents(events, taskId)
  if (!local) return doCalendario
  if (!doCalendario) return local
  return {
    sessions: Math.max(local.sessions, doCalendario.sessions),
    minutes: Math.max(local.minutes, doCalendario.minutes),
  }
}
