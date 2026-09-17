// O núcleo puro das ações do agente: transformar uma ação que a IA propôs no
// patch que a API do Google espera, e reencontrar o item real a partir da
// referência curta que foi mandada no contexto.
//
// Fica separado do hook e do painel de propósito: é a parte que decide o que
// vai ser gravado na agenda de verdade, e é a parte que dá para testar sem
// navegador nenhum.
import { fromInputs, toDateInput, toTimeInput } from './dates.js'
import { isAllDay, eventStart, eventEnd } from './events.js'

// O agente nunca recebe nem devolve o id real do Google: ele trabalha com
// referências curtas ("e3", "t7") que este módulo emitiu junto com o contexto.
// O id de um evento do Google tem ~26 caracteres aleatórios — pedir ao modelo
// que copie isso de volta sem trocar um caractere é convidar o erro, e um
// erro desses apaga o compromisso errado. Uma referência curta ou está na
// lista ou não está, e a diferença é detectável.
export function refDeEvento(i) {
  return `e${i + 1}`
}

export function refDeTarefa(i) {
  return `t${i + 1}`
}

export function refDeNota(i) {
  return `n${i + 1}`
}

// Reencontra o item vivo por trás da referência. Devolve null quando a
// referência não resolve mais — o que acontece de verdade: entre a IA propor
// e a pessoa aprovar, um reload pode ter mudado as listas. Nesse caso a ação
// vira órfã e não é executável, em vez de acertar o vizinho de índice.
export function resolverRef(ref, { eventos = [], tarefas = [] }) {
  if (typeof ref !== 'string') return null
  const indice = Number(ref.slice(1)) - 1
  if (!Number.isInteger(indice) || indice < 0) return null
  if (ref.startsWith('e')) {
    const item = eventos[indice]
    return item ? { kind: 'event', item } : null
  }
  if (ref.startsWith('t')) {
    const item = tarefas[indice]
    return item ? { kind: 'task', item } : null
  }
  return null
}

// Monta o patch de updateEvent (googleApi.js) a partir da ação: só mexe em
// data/hora quando a IA realmente leu uma mudança, mantendo a duração
// original do compromisso quando ela não foi dita.
export function buildEventPatch(event, acao) {
  const patch = {}
  if (acao.title) patch.title = acao.title
  if (acao.date || acao.time) {
    const allDay = isAllDay(event)
    const curStart = eventStart(event)
    const curEnd = eventEnd(event)
    const durationMinutes = acao.durationMinutes || (curEnd - curStart) / 60000
    const dateStr = acao.date || toDateInput(curStart)
    const start = allDay ? fromInputs(dateStr) : fromInputs(dateStr, acao.time || toTimeInput(curStart))
    patch.start = start
    patch.end = new Date(start.getTime() + durationMinutes * 60000)
    patch.allDay = allDay
  }
  return patch
}

export function buildTaskPatch(acao) {
  return {
    title: acao.title || undefined,
    due: acao.date ? fromInputs(acao.date) : undefined,
    priority: acao.priority || undefined,
  }
}
