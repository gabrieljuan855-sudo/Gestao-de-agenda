import { startOfDay, addDays, isSameDay } from './dates.js'
import { eventStart, eventEnd, isAllDay, sortByStart } from './events.js'

// Quantos dias para a frente a vista Lista mostra de uma vez. Três meses é o
// horizonte em que um compromisso ainda pede preparo; mais que isso vira uma
// rolagem sem fim que ninguém lê. As setas andam de 30 em 30 dias.
export const DIAS_DA_LISTA = 90

// Só os eventos da agenda escolhida; sem agenda (null), todos.
export function filtrarPorAgenda(events, agendaId) {
  if (!agendaId) return events
  return events.filter((e) => e.calendarId === agendaId)
}

// A lista de compromissos a partir de `desde`, agrupada por dia, só com os
// dias que têm alguma coisa. Um compromisso de vários dias (férias, congresso)
// aparece uma vez só — no dia em que começa, ou no primeiro dia da lista se
// já estava em andamento —, em vez de se repetir em cada dia do período e
// soterrar o resto.
export function montarLista(events, desde, dias = DIAS_DA_LISTA) {
  const inicio = startOfDay(desde)
  const fim = addDays(inicio, dias)
  const grupos = []
  for (const event of sortByStart(events)) {
    const comeco = eventStart(event)
    const termino = eventEnd(event) || comeco
    if (!comeco || termino < inicio || comeco >= fim) continue
    const emAndamento = comeco < inicio
    const dia = startOfDay(emAndamento ? inicio : comeco)
    let grupo = grupos.find((g) => isSameDay(g.dia, dia))
    if (!grupo) {
      grupo = { dia, itens: [] }
      grupos.push(grupo)
    }
    grupo.itens.push({ event, emAndamento, variosDias: !isSameDay(startOfDay(comeco), startOfDay(termino)) })
  }
  return grupos.sort((a, b) => a.dia - b.dia)
}

// O rótulo de quando, na coluna da esquerda de cada linha.
export function quandoNaLista({ event, emAndamento, variosDias }) {
  const dataCurta = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  const hora = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const comeco = eventStart(event)
  const termino = eventEnd(event)
  if (variosDias) return emAndamento ? `até ${dataCurta(termino)}` : `${dataCurta(comeco)} a ${dataCurta(termino)}`
  if (isAllDay(event)) return 'Dia inteiro'
  return `${hora(comeco)}–${hora(termino)}`
}
