import { priorityFromListTitle } from './priority.js'
import { semAcento } from './texto.js'

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

function nomeDaAgenda(cal) {
  return cal.summaryOverride || cal.summary || ''
}

// A agenda citada no próprio texto: "Imersão AEPETI" cai na agenda AEPETI,
// "reunião CREAS sexta 9h" na do CREAS. É o nome inteiro da agenda como
// palavra(s) do texto, sem acento e sem caixa — "aepeti" acha "AEPETI". O
// nome mais longo ganha quando dois casam ("CREAS" e "CREAS Norte"), porque
// é o mais específico. Sem nenhum nome no texto, fica a agenda padrão.
export function acharAgendaNoTexto(texto, calendars = []) {
  const alvo = ` ${semAcento(texto).replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  let melhor = null
  for (const cal of calendars) {
    const nome = semAcento(nomeDaAgenda(cal)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (nome.length < 3) continue
    if (alvo.includes(` ${nome} `) && (!melhor || nome.length > melhor.nome.length)) melhor = { cal, nome }
  }
  return melhor?.cal || null
}
