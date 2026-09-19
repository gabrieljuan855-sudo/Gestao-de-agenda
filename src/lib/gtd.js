import { semAcento } from './texto.js'
import { normalizePriority, DEFAULT_PRIORITY } from './priority.js'

// As listas do Google Tasks são os baldes do método: um item está em
// exatamente uma delas, e mover de lista É o ato de decidir o que aquilo é.
//
// Ficar dentro do Google (em vez de um banco próprio ou de um arquivo no
// Drive) tem uma vantagem que decide a escolha: a captura não fica refém
// deste app. O que cai na Entrada continua aparecendo no app oficial do
// Google Tasks, no Gmail e na Siri — e continua existindo se este site sair
// do ar.
export const LISTA_ENTRADA = 'Entrada'
export const LISTA_PROXIMAS = 'Próximas ações'
export const LISTA_AGUARDANDO = 'Aguardando'
export const LISTA_ALGUM_DIA = 'Algum dia'

// As listas que o app cria sozinho. A ordem é a do fluxo: o que entra sai da
// Entrada para uma das outras três.
export const LISTAS_GTD = [LISTA_ENTRADA, LISTA_PROXIMAS, LISTA_AGUARDANDO, LISTA_ALGUM_DIA]

// Acha uma lista pelo nome, ignorando acento e caixa: quem criou a lista à
// mão no app do Google pode ter escrito "entrada" ou "Entrada", e criar uma
// segunda lista por causa de um acento seria o pior resultado possível.
export function acharLista(taskLists, titulo) {
  const alvo = semAcento(titulo).trim()
  return (taskLists || []).find((lista) => semAcento(lista?.title || '').trim() === alvo) || null
}

// A Entrada existe? Usado para decidir se vale gastar uma chamada criando.
export function temEntrada(taskLists) {
  return Boolean(acharLista(taskLists, LISTA_ENTRADA))
}

// ---------- Etiquetas dentro da nota da tarefa ----------
//
// O Google Tasks não tem campo livre de metadado (os eventos do Calendar têm
// `extendedProperties`; as tarefas, não). A saída que este app já usava era
// escrever a prioridade no começo da nota — `[alta] texto livre`. Aqui esse
// mesmo bloco passa a carregar o resto: contexto e de quem se está esperando.
//
//     [alta @ligar ~ana desde:2026-09-10] texto livre da pessoa
//
// Continua uma linha legível no app oficial do Google Tasks, que é o ponto:
// quem abrir a tarefa por lá entende o que está escrito, em vez de encontrar
// um blob de JSON.
const BLOCO_META = /^\[([^\]]*)\]\s*/

// Contexto e nome não podem ter espaço (o espaço separa as etiquetas) nem
// acento (para "@ligação" e "@ligacao" não virarem dois contextos).
export function etiqueta(texto) {
  return semAcento(texto || '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function parseMeta(notes) {
  const vazio = { priority: null, contexto: null, projeto: null, aguardando: null, notes: '' }
  if (!notes) return vazio

  const match = notes.match(BLOCO_META)
  if (!match) return { ...vazio, notes }

  let priority = null
  let contexto = null
  let projeto = null
  let quem = null
  let desde = null

  for (const token of match[1].split(/\s+/).filter(Boolean)) {
    if (token.startsWith('@')) contexto = token.slice(1) || null
    else if (token.startsWith('#')) projeto = token.slice(1) || null
    else if (token.startsWith('~')) quem = token.slice(1) || null
    else if (token.startsWith('desde:')) desde = token.slice('desde:'.length) || null
    // A prioridade é a única etiqueta sem marcador, por compatibilidade com
    // as notas que já existem gravadas como "[alta] ...".
    else if (!priority) priority = normalizePriority(token)
  }

  return {
    priority,
    contexto,
    projeto,
    aguardando: quem ? { quem, desde } : null,
    notes: notes.replace(BLOCO_META, ''),
  }
}

export function encodeMeta({ priority, contexto, projeto, aguardando } = {}, notes) {
  const partes = [normalizePriority(priority) || DEFAULT_PRIORITY]
  if (contexto) partes.push(`@${etiqueta(contexto)}`)
  if (projeto) partes.push(`#${etiqueta(projeto)}`)
  if (aguardando?.quem) {
    partes.push(`~${etiqueta(aguardando.quem)}`)
    // A data de quando a espera começou é o que permite dizer "parado há 12
    // dias" depois — sem ela, "Aguardando" vira um limbo sem prazo.
    if (aguardando.desde) partes.push(`desde:${aguardando.desde}`)
  }
  return `[${partes.join(' ')}] ${notes || ''}`.trim()
}

// ---------- Projetos ----------
//
// Um projeto não é um objeto à parte: é só o mesmo `#etiqueta` repetido em
// várias tarefas. Isso evita inventar uma segunda entidade (com sua própria
// tela de CRUD) para algo que o método já resolve com uma etiqueta — o
// GTD trata "projeto" como qualquer resultado que precisa de mais de uma
// ação, nada além disso.
//
// O problema que este método existe para pegar é o clássico do GTD: um
// projeto sem nenhuma próxima ação nas mãos é um projeto que parou de andar
// sem ninguém perceber, porque ele não aparece atrasado nem cobra nada — só
// fica quieto.
export function projetosSemProximaAcao(tasks, idListaProximas) {
  const ativos = (tasks || []).filter((t) => t.status !== 'completed' && t.projeto)
  const comProximaAcao = new Set(
    ativos.filter((t) => t.tasklistId === idListaProximas).map((t) => t.projeto)
  )
  const todos = new Set(ativos.map((t) => t.projeto))
  return [...todos].filter((p) => !comProximaAcao.has(p)).sort()
}
