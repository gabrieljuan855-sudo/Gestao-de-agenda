// Compromisso que vira tarefa e tarefa que vira compromisso. Aqui só se monta
// o que vai ser gravado; quem grava é o App, com as mesmas funções de criar e
// excluir de sempre. A ordem lá é criar o novo antes de tirar o antigo: se o
// Google falhar no meio, sobra um a mais, nunca um a menos.
import { isAllDay, eventStart, eventEnd } from './events.js'
import { startOfDay, dateOnlyFromISO, toDateInput, toTimeInput, fromInputs } from './dates.js'
import { PROJETO_PROP } from './projetos.js'

// O Google guarda a descrição do evento com HTML quando ela foi escrita na
// agenda pelo navegador (<br>, <a>, <b>...). Na tarefa isso apareceria cru, com
// as tags no meio do texto.
export function textoDaDescricao(html = '') {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, href, texto) => (texto && texto !== href ? `${texto} (${href})` : href))
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function linkDaVideochamada(event) {
  return event.hangoutLink || event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || null
}

// Gente de verdade convidada além de você (sala de reunião e você mesmo não
// contam). É o que decide se tirar da agenda é seguro: num evento com
// convidados, excluir mexe na agenda dos outros.
export function outrosConvidados(event) {
  return (event.attendees || []).filter((a) => !a.self && !a.resource)
}

// O que a tarefa leva do compromisso: o título, o dia como prazo, a duração
// (para o "cabe nesse tempo" continuar funcionando), o projeto e, no texto,
// o que não pode se perder ao tirar o compromisso da agenda — descrição,
// local e o link da videochamada.
export function tarefaDoEvento(event) {
  const inicio = eventStart(event)
  const fim = eventEnd(event)
  const minutos = isAllDay(event) ? null : Math.round((fim - inicio) / 60000)
  const partes = []
  const descricao = textoDaDescricao(event.description)
  if (descricao) partes.push(descricao)
  if (event.location?.trim()) partes.push(`Local: ${event.location.trim()}`)
  const video = linkDaVideochamada(event)
  if (video) partes.push(`Videochamada: ${video}`)
  return {
    title: event.summary?.trim() || 'Sem título',
    due: inicio ? startOfDay(inicio) : null,
    // Um evento de vários dias com hora não é uma duração de tarefa.
    duracao: minutos > 0 && minutos <= 24 * 60 ? minutos : null,
    projeto: event.extendedProperties?.private?.[PROJETO_PROP] || null,
    notes: partes.join('\n\n'),
  }
}

const MEIA_HORA = 30 * 60000

// Onde o compromisso nasce, se a pessoa não mexer: no dia do prazo (ou hoje,
// se não tem prazo ou ele já passou), às 9h num dia que ainda vem, ou na
// próxima meia hora cheia se for hoje. A duração é a da tarefa, ou uma hora.
export function horarioSugerido(task, agora = new Date()) {
  const hoje = startOfDay(agora)
  const prazo = task.due ? dateOnlyFromISO(task.due) : null
  const dia = prazo && prazo > hoje ? prazo : hoje
  const minutos = Number(task.duracao) > 0 ? Number(task.duracao) : 60
  let inicio
  if (dia > hoje) {
    inicio = fromInputs(toDateInput(dia), '09:00')
  } else {
    inicio = new Date(Math.ceil(agora.getTime() / MEIA_HORA) * MEIA_HORA)
    // Tarde da noite, a próxima meia hora cairia amanhã: aí fica para amanhã
    // às 9h, que é o que alguém faria à mão.
    if (startOfDay(inicio).getTime() !== hoje.getTime() || inicio.getHours() >= 22) {
      const amanha = new Date(hoje)
      amanha.setDate(amanha.getDate() + 1)
      inicio = fromInputs(toDateInput(amanha), '09:00')
    }
  }
  let fim = new Date(inicio.getTime() + minutos * 60000)
  // O formulário tem um dia só: o fim não pode virar o dia.
  if (startOfDay(fim).getTime() !== startOfDay(inicio).getTime()) fim = fromInputs(toDateInput(inicio), '23:59')
  return { data: toDateInput(inicio), inicio: toTimeInput(inicio), fim: toTimeInput(fim) }
}

// O compromisso que sai da tarefa: o texto dela vira a descrição (inclusive as
// linhas de anexo, com o link) e o projeto vai na marca do evento, a mesma
// que a página do projeto usa para achar os compromissos dele.
export function eventoDaTarefa(task, { titulo, start, end, calendarId }) {
  const projeto = task.projeto || null
  return {
    title: (titulo ?? task.title ?? '').trim() || 'Sem título',
    start,
    end,
    calendarId: calendarId || 'primary',
    description: task.notesClean?.trim() || undefined,
    ...(projeto ? { extendedProperties: { private: { [PROJETO_PROP]: projeto } } } : {}),
  }
}
