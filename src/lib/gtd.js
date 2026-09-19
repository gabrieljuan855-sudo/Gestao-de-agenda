import { semAcento } from './texto.js'

// As listas do Google Tasks são os baldes do método: um item está em
// exatamente uma delas, e mover de lista É o ato de decidir o que aquilo é.
//
// Ficar dentro do Google (em vez de um banco próprio ou de um arquivo no
// Drive) tem uma vantagem que decide a escolha: a captura não fica refém
// deste app. O que cai na Entrada continua aparecendo no app oficial do
// Google Tasks, no Gmail e na Siri — e continua existindo se este site sair
// do ar.
export const LISTA_ENTRADA = 'Entrada'

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
