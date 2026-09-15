// Vocabulário de prioridade do app.
//
// Antes as três opções eram "Urgente / Importante / Pode esperar". Esse último
// rótulo aparecia em quase tudo, porque era o valor padrão de qualquer tarefa
// sem marcação — inclusive nas tarefas criadas direto no Google Tasks, que
// nunca têm a tag deste app. Resultado: uma tarefa da lista "Prioridade Máxima"
// aparecia aqui como "Pode esperar". Agora o vocabulário é Alta/Média/Baixa,
// igual ao que as listas do Google Tasks já usam.
export const PRIORITIES = [
  { id: 'alta', label: 'Alta' },
  { id: 'media', label: 'Média' },
  { id: 'baixa', label: 'Baixa' },
]

export const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.id, p.label]))
export const PRIORITY_ORDER = PRIORITIES.map((p) => p.id)

// Média, e não baixa: uma anotação rápida costuma ser algo que se pretende
// fazer. Quem quiser rebaixar clica; ninguém precisa promover o tempo todo.
export const DEFAULT_PRIORITY = 'media'

// Tarefas gravadas antes desta mudança têm "[urgente]" / "[importante]" /
// "[pode_esperar]" na nota. Continuam sendo lidas.
const LEGACY = {
  urgente: 'alta',
  importante: 'media',
  pode_esperar: 'baixa',
}

export function normalizePriority(value) {
  if (!value) return null
  const id = String(value).toLowerCase()
  if (PRIORITY_LABEL[id]) return id
  return LEGACY[id] || null
}

function withoutAccents(text) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

// As listas do Google Tasks do usuário já se chamam "Prioridade Máxima (menos
// de uma semana)" e afins: a prioridade real está no nome da lista, não numa
// tag escondida. Quando dá para ler dali, é essa que vale.
export function priorityFromListTitle(title) {
  if (!title) return null
  const name = withoutAccents(title)
  if (!name.includes('prioridade')) return null
  if (/maxima|alta|urgente/.test(name)) return 'alta'
  if (/media|intermediaria/.test(name)) return 'media'
  if (/baixa|minima/.test(name)) return 'baixa'
  return null
}
