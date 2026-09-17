import { priorityFromListTitle } from './priority.js'

// A agenda de trabalho é onde quase tudo cai. Deixar "Escolha a agenda..." em
// branco obrigava um clique a mais em todo compromisso, e bloqueava o botão de
// salvar até que ele fosse dado. Usado pela criação rápida e pelas sugestões
// da IA nas anotações — os dois precisam do mesmo palpite de agenda padrão.
const DEFAULT_CALENDAR = 'creas'

export function findDefaultCalendar(calendars) {
  const named = (cal) => (cal.summaryOverride || cal.summary || '').toLowerCase()
  return calendars.find((cal) => named(cal).includes(DEFAULT_CALENDAR)) || null
}

export function findListForPriority(taskLists, priority) {
  return taskLists.find((list) => priorityFromListTitle(list.title) === priority) || null
}
