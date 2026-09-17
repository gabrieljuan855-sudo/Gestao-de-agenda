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
