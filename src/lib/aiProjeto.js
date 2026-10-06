import { ensureToken } from './googleAuth.js'
import { pausarIA } from './aiCooldown.js'
import { toDateInput, dateOnlyFromISO } from './dates.js'

// Trecho máximo de cada anotação mandado para a IA: o bastante para ela
// entender o caso, sem mandar o texto inteiro de anotações longas.
const MAX_TRECHO = 1200

const LISTA_DO_GRUPO = {
  proximas: 'proximas',
  aguardando: 'aguardando',
  algumDia: 'algum_dia',
  entrada: 'entrada',
  outras: 'outras',
  concluidas: 'concluida',
}

// Exatamente o que sai do aparelho para a IA, montado num lugar só e à vista
// (descreverEnvio diz isso na tela antes do clique). Nada de id, e-mail ou
// agenda: a ficha, os títulos das tarefas e trechos das anotações do projeto.
export function montarContextoDoProjeto({ projeto, grupos, anotacoes = [], contextos = [], alvo = null }) {
  const tarefas = []
  for (const [grupo, lista] of Object.entries(grupos || {})) {
    for (const t of lista || []) {
      tarefas.push({
        titulo: t.title,
        lista: LISTA_DO_GRUPO[grupo] || 'outras',
        prazo: t.due ? toDateInput(dateOnlyFromISO(t.due)) : null,
      })
    }
  }
  return {
    projeto: {
      nome: projeto.nome,
      tipo: projeto.tipo || 'projeto',
      resultado: projeto.resultado || '',
      prazo: projeto.prazo || null,
    },
    tarefas,
    anotacoes: anotacoes.map((n) => ({ titulo: n.title || '', trecho: (n.body || '').slice(0, MAX_TRECHO) })),
    contextos,
    alvo: alvo ? { titulo: alvo.title, notas: alvo.notesClean || '' } : null,
  }
}

export function descreverEnvio(ctx) {
  const partes = ['a ficha']
  if (ctx.tarefas.length) partes.push(`${ctx.tarefas.length} ${ctx.tarefas.length === 1 ? 'tarefa' : 'tarefas'}`)
  if (ctx.anotacoes.length) partes.push(`trechos de ${ctx.anotacoes.length} ${ctx.anotacoes.length === 1 ? 'anotação' : 'anotações'}`)
  const ultimo = partes.pop()
  return `Vai para a IA: ${partes.length ? `${partes.join(', ')} e ${ultimo}` : ultimo} deste projeto.`
}

// `extra` leva o que só um modo usa: { documento: {tipo, instrucao} } ou
// { pergunta }.
export async function pedirAoProjeto(modo, contexto, extra = {}) {
  const token = await ensureToken()
  if (!token) throw new Error('Faça login primeiro.')
  const agora = new Date()
  const res = await fetch('/api/projeto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      modo,
      ...contexto,
      ...extra,
      today: agora.toLocaleDateString('pt-BR'),
      weekday: agora.toLocaleDateString('pt-BR', { weekday: 'long' }),
      hojeIso: toDateInput(agora),
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `A IA não respondeu (${res.status}).`)
    err.transiente = data.transiente === true
    pausarIA(data.motivo)
    throw err
  }
  return data
}
