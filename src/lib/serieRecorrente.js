import { isAllDay, eventStart, eventEnd } from './events.js'
import { addDays, startOfDay, toDateInput } from './dates.js'
import { PROJETO_PROP } from './projetos.js'

// A agenda chega do Google já desdobrada em ocorrências (singleEvents), então
// o que a pessoa abre no editor é sempre uma ocorrência, nunca a série. Este
// módulo é a ponte entre "esta ocorrência que estou vendo" e "a série que a
// gerou", nas três escolhas do Google: este evento, este e os seguintes, todos.

const DIA_MS = 24 * 60 * 60 * 1000

// Quando a ocorrência aconteceria pela regra — não quando está agora: uma
// ocorrência já remarcada sozinha guarda o horário original à parte, e é ele
// que identifica o ponto da série.
export function inicioOriginal(instancia) {
  return eventStart({ start: instancia.originalStartTime }) || eventStart(instancia)
}

export function ehPrimeiraDaSerie(serie, instancia) {
  const a = eventStart(serie)
  const b = inicioOriginal(instancia)
  return Boolean(a && b && a.getTime() === b.getTime())
}

// "Todos os eventos": a mudança feita nesta ocorrência vale como diferença
// para a série inteira. Passar a reunião das 14h para as 15h passa todas para
// as 15h, cada uma no seu dia — e não todas para o dia desta. Sem mudança de
// horário, devolve null e a série nem recebe start/end.
export function horarioDaSerie(serie, instancia, novoInicio, novoFim) {
  const inicioSerie = eventStart(serie)
  const inicioAtual = eventStart(instancia)
  const fimAtual = eventEnd(instancia)
  if (!inicioSerie || !inicioAtual || !novoInicio || !novoFim) return null

  if (isAllDay(serie)) {
    // Em dia inteiro tudo é em dias: o fim que o editor manda é o último dia
    // (inclusivo), não o instante do fim.
    const deslocamento = Math.round((startOfDay(novoInicio) - startOfDay(inicioAtual)) / DIA_MS)
    const duracao = Math.round((startOfDay(novoFim) - startOfDay(novoInicio)) / DIA_MS)
    const duracaoAtual = Math.round((startOfDay(fimAtual) - startOfDay(inicioAtual)) / DIA_MS)
    if (deslocamento === 0 && duracao === duracaoAtual) return null
    const start = addDays(startOfDay(inicioSerie), deslocamento)
    return { start, end: addDays(start, duracao) }
  }

  const deslocamento = novoInicio - inicioAtual
  const duracao = novoFim - novoInicio
  if (deslocamento === 0 && duracao === fimAtual - inicioAtual) return null
  const start = new Date(inicioSerie.getTime() + deslocamento)
  return { start, end: new Date(start.getTime() + duracao) }
}

// Uma série de "10 vezes" cortada depois da 4ª segue com as 6 que faltam, e
// não com mais 10.
export function restanteDaContagem(recurrence, jaAconteceram) {
  return (recurrence || []).map((linha) =>
    linha.startsWith('RRULE:')
      ? linha.replace(/COUNT=(\d+)/i, (_, n) => `COUNT=${Math.max(1, Number(n) - jaAconteceram)}`)
      : linha
  )
}

// Os campos da série que a continuação herda. Convidados e lembretes vão
// junto, como no Google: "este e os seguintes" é a mesma reunião daqui para
// frente, não uma nova. O que é marca de uma ocorrência só (presença, bloco
// de foco) fica para trás, porque mora na ocorrência, não na série.
const HERDADOS = ['description', 'location', 'colorId', 'reminders', 'attendees', 'transparency', 'visibility', 'guestsCanModify', 'guestsCanInviteOthers', 'guestsCanSeeOtherGuests']

// O corpo do evento novo que continua a série a partir desta ocorrência,
// com as mudanças do editor por cima. `conferencia` diz se a chamada precisa
// do conferenceDataVersion=1 (sem ele o Google ignora o Meet em silêncio).
export function corpoDaContinuacao(serie, patch, recurrence) {
  const body = {}
  for (const campo of HERDADOS) if (serie[campo] !== undefined) body[campo] = serie[campo]
  body.summary = patch.title !== undefined ? patch.title : serie.summary
  if (patch.description !== undefined) body.description = patch.description
  if (patch.location !== undefined) body.location = patch.location

  if (isAllDay(serie)) {
    body.start = { date: toDateInput(patch.start) }
    body.end = { date: toDateInput(addDays(patch.end, 1)) }
  } else {
    body.start = { dateTime: patch.start.toISOString() }
    body.end = { dateTime: patch.end.toISOString() }
    // O fuso da série vale para a regra (é ele que diz o que é "toda
    // segunda às 9h" quando o horário de verão muda).
    if (serie.start?.timeZone) {
      body.start.timeZone = serie.start.timeZone
      body.end.timeZone = serie.end?.timeZone || serie.start.timeZone
    }
  }
  if (recurrence && recurrence.length) body.recurrence = recurrence

  const privadas = { ...(serie.extendedProperties?.private || {}) }
  if (patch.projeto !== undefined) {
    if (patch.projeto) privadas[PROJETO_PROP] = patch.projeto
    else delete privadas[PROJETO_PROP]
  }
  if (Object.keys(privadas).length) body.extendedProperties = { private: privadas }

  let conferencia = false
  if (patch.criarVideochamada) {
    body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
    conferencia = true
  } else if (serie.conferenceData && !patch.removerVideochamada) {
    // Mesmo link da série: quem já salvou o Meet continua entrando nele.
    body.conferenceData = { conferenceId: serie.conferenceData.conferenceId, conferenceSolution: serie.conferenceData.conferenceSolution, entryPoints: serie.conferenceData.entryPoints }
    conferencia = true
  }
  return { body, conferencia }
}
