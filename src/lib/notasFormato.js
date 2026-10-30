// O formato de uma anotação, do jeito que ela vai para o anotacoes.json no
// Drive. Fica num módulo sem React porque o conector do Claude (no Worker)
// grava notas no mesmo arquivo — e uma nota que o app não reconhecesse seria
// descartada na primeira leitura dele.

import { normalizarLink } from './projetos.js'

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/
export const MAX_FONTES = 20

// De onde veio o que a nota diz: um artigo, um PDF, uma reunião, um livro.
// Guardar a fonte junto é o que deixa a nota ser conferida depois — "onde foi
// que eu li isso?" —, e é a outra metade da base de conhecimento, junto dos
// links. Só o título é obrigatório; link só http(s), pelo mesmo motivo dos
// arquivos de projeto (um "javascript:" clicável seria uma porta aberta).
export function sanitizeFonte(fonte) {
  if (!fonte || typeof fonte !== 'object') return null
  const titulo = typeof fonte.titulo === 'string' ? fonte.titulo.trim().slice(0, 300) : ''
  if (!titulo) return null
  const limpa = { titulo }
  const url = fonte.url ? normalizarLink(String(fonte.url)) : null
  if (url) limpa.url = url
  if (typeof fonte.autor === 'string' && fonte.autor.trim()) limpa.autor = fonte.autor.trim().slice(0, 200)
  if (DATA_ISO.test(fonte.data || '')) limpa.data = fonte.data
  return limpa
}

// Junta fontes sem repetir a mesma (mesmo título, sem ligar para caixa).
export function juntarFontes(...listas) {
  const porTitulo = new Map()
  for (const f of listas.flat().map(sanitizeFonte).filter(Boolean)) {
    const chave = f.titulo.toLowerCase()
    if (!porTitulo.has(chave)) porTitulo.set(chave, f)
  }
  return [...porTitulo.values()].slice(0, MAX_FONTES)
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `nota-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function newNote() {
  const now = new Date().toISOString()
  return { id: makeId(), title: '', body: '', createdAt: now, updatedAt: now }
}

export function textoOuVazio(v) {
  return typeof v === 'string' ? v : ''
}

// Reconstrói a nota só com os campos que ela pode ter, do jeito certo — nunca
// espalha um objeto de fora por cima dela. Existe por causa de um bug real:
// o botão "+" chamava `onCreate={createNote}` direto no onClick, então um
// clique passava o próprio evento do React como `inicial`, e `{...inicial}`
// copiava dali o alvo do clique (um <button> do DOM, com a referência que o
// React deixa presa nele) para dentro da nota. Isso trava a sincronização
// pra sempre: um JSON.stringify que esbarra num nó do DOM nunca chega a
// tentar a rede, então nem aparece como erro do Google — só "não deu para
// sincronizar", sem pista nenhuma de por quê.
//
// Rodar isto também na leitura do cache (abaixo) é o que limpa uma nota que
// já ficou corrompida assim antes desta correção existir — sem isso, o
// aparelho continuaria travado mesmo depois do código corrigido.
export function sanitizeNote(note) {
  if (!note || typeof note !== 'object') return null
  if (typeof note.id !== 'string') return null
  const limpa = {
    id: note.id,
    title: textoOuVazio(note.title),
    body: textoOuVazio(note.body),
    createdAt: typeof note.createdAt === 'string' ? note.createdAt : new Date().toISOString(),
    updatedAt: typeof note.updatedAt === 'string' ? note.updatedAt : new Date().toISOString(),
  }
  if (Array.isArray(note.suggestions)) limpa.suggestions = note.suggestions
  if (typeof note.lastAnalyzedAt === 'string') limpa.lastAnalyzedAt = note.lastAnalyzedAt
  // Etiqueta do projeto a que a anotação pertence (o mesmo id de
  // projetos.js). Sem projeto, o campo simplesmente não existe.
  if (typeof note.projeto === 'string' && note.projeto) limpa.projeto = note.projeto
  // Fixada no topo da lista, como no Notas do iPhone. Só existe quando é true.
  if (note.fixada === true) limpa.fixada = true
  if (Array.isArray(note.fontes)) {
    const fontes = juntarFontes(note.fontes)
    if (fontes.length) limpa.fontes = fontes
  }
  if (note.relatedNote && typeof note.relatedNote.id === 'string') {
    limpa.relatedNote = { id: note.relatedNote.id, title: textoOuVazio(note.relatedNote.title) }
  }
  return limpa
}

export function sanitizeNotes(notes) {
  return (Array.isArray(notes) ? notes : []).map(sanitizeNote).filter(Boolean)
}
