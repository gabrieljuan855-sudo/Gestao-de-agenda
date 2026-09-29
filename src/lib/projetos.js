import { etiqueta } from './gtd.js'
import { compararPorPrioridadeEPrazo, isOverdueTask } from './tasks.js'

// Um projeto deixou de ser só a etiqueta #nome repetida em várias tarefas: ele
// tem ficha própria (o que é, como se sabe que terminou, em que pé está), e é
// o lugar onde tarefas, anotações e compromissos de um mesmo caso se juntam.
//
// A etiqueta continua sendo a ligação com as tarefas — o `id` do projeto É a
// etiqueta (etiqueta() de gtd.js), então tudo que já estava marcado com
// #caso-maria cai sozinho no projeto "caso-maria", sem migrar nada no Google
// Tasks. A ficha é só o que o Tasks não tem onde guardar.

export const SITUACOES = [
  { id: 'ativo', label: 'Ativo' },
  { id: 'pausado', label: 'Pausado' },
  { id: 'concluido', label: 'Concluído' },
]
const ORDEM_SITUACAO = { ativo: 0, pausado: 1, concluido: 2 }

// Marca privada no evento do Calendar que diz a qual projeto ele pertence —
// o mesmo mecanismo que os blocos de foco e os registros de conclusão já usam
// para se reconhecer (extendedProperties.private).
export const PROJETO_PROP = 'segundoCerebroProjeto'

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

// A ficha vem do Drive e do cache local: nenhum dos dois é garantia de
// formato. Só os campos conhecidos passam, cada um com o tipo certo — a
// mesma lição da anotação que travou a sincronização (sanitizeNote).
export function normalizarProjeto(p, agora = new Date()) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) return null
  const iso = agora.toISOString()
  return {
    id: p.id,
    nome: typeof p.nome === 'string' && p.nome.trim() ? p.nome.trim() : p.id,
    resultado: typeof p.resultado === 'string' ? p.resultado : '',
    situacao: ORDEM_SITUACAO[p.situacao] !== undefined ? p.situacao : 'ativo',
    prazo: DATA_ISO.test(p.prazo || '') ? p.prazo : null,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : iso,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : iso,
  }
}

export function normalizarProjetos(lista, agora = new Date()) {
  return (Array.isArray(lista) ? lista : []).map((p) => normalizarProjeto(p, agora)).filter(Boolean)
}

// Um nome que não sobra nada depois de virar etiqueta ("!!!") não vira
// projeto: sem id não haveria como ligar tarefa nenhuma a ele.
export function novoProjeto(nome, agora = new Date()) {
  const id = etiqueta(nome)
  if (!id) return null
  const iso = agora.toISOString()
  return { id, nome: nome.trim(), resultado: '', situacao: 'ativo', prazo: null, createdAt: iso, updatedAt: iso }
}

function maisRecente(...datas) {
  let melhor = null
  for (const d of datas) {
    const t = d ? new Date(d).getTime() : NaN
    if (Number.isFinite(t) && (melhor === null || t > melhor)) melhor = t
  }
  return melhor === null ? null : new Date(melhor).toISOString()
}

// A lista de projetos junta duas fontes: as fichas que existem e as etiquetas
// usadas em tarefas/anotações que ainda não ganharam ficha. Sem a segunda,
// quem já usava #caso-maria antes desta tela existir não veria o projeto
// nenhum até criar a ficha na mão.
export function listarProjetos({ registros = [], tasks = [], notes = [], idProximas }, now = new Date()) {
  const porId = new Map(registros.map((r) => [r.id, { ...r, implicito: false }]))
  const etiquetasSoltas = [...tasks.map((t) => t.projeto), ...notes.map((n) => n.projeto)].filter(Boolean)
  for (const id of etiquetasSoltas) {
    if (!porId.has(id)) {
      porId.set(id, { id, nome: id, resultado: '', situacao: 'ativo', prazo: null, createdAt: null, updatedAt: null, implicito: true })
    }
  }

  return [...porId.values()]
    .map((p) => {
      const pendentes = tasks.filter((t) => t.projeto === p.id && t.status !== 'completed')
      const proximaAcao =
        pendentes.filter((t) => idProximas && t.tasklistId === idProximas).sort(compararPorPrioridadeEPrazo)[0] || null
      const anotacoes = notes.filter((n) => n.projeto === p.id)
      return {
        ...p,
        pendentes: pendentes.length,
        atrasadas: pendentes.filter((t) => isOverdueTask(t, now)).length,
        anotacoes: anotacoes.length,
        proximaAcao,
        // Projeto ativo sem próxima ação é o sinal que o GTD mais cobra: ele
        // parou de andar e nada na tela avisa. Pausado e concluído não
        // precisam de próxima ação — é justamente o que os distingue.
        semProximaAcao: p.situacao === 'ativo' && !proximaAcao,
        ultimaAtividade: maisRecente(
          p.updatedAt,
          ...tasks.filter((t) => t.projeto === p.id).map((t) => t.updated),
          ...anotacoes.map((n) => n.updatedAt)
        ),
      }
    })
    .sort((a, b) => ORDEM_SITUACAO[a.situacao] - ORDEM_SITUACAO[b.situacao] || a.nome.localeCompare(b.nome))
}

// As tarefas de um projeto separadas pelo momento do método em que estão —
// a mesma divisão das listas do Google Tasks, mais as concluídas recentes
// (o histórico do caso, que ajuda a lembrar o que já foi feito).
export function tarefasDoProjeto(tasks, projetoId, { idProximas, idAguardando, idAlgumDia, idEntrada } = {}, maxConcluidas = 10) {
  const doProjeto = (tasks || []).filter((t) => t.projeto === projetoId)
  const pendentes = doProjeto.filter((t) => t.status !== 'completed').sort(compararPorPrioridadeEPrazo)
  const naLista = (id) => (t) => Boolean(id) && t.tasklistId === id
  const listasConhecidas = [idProximas, idAguardando, idAlgumDia, idEntrada].filter(Boolean)
  return {
    proximas: pendentes.filter(naLista(idProximas)),
    aguardando: pendentes.filter(naLista(idAguardando)),
    algumDia: pendentes.filter(naLista(idAlgumDia)),
    entrada: pendentes.filter(naLista(idEntrada)),
    // Tarefas marcadas com o projeto mas em listas de fora do método (as
    // antigas "Prioridade ...") — não somem só por não estarem numa das quatro.
    outras: pendentes.filter((t) => !listasConhecidas.includes(t.tasklistId)),
    concluidas: doProjeto
      .filter((t) => t.status === 'completed')
      .sort((a, b) => new Date(b.completed || 0) - new Date(a.completed || 0))
      .slice(0, maxConcluidas),
  }
}

// Um evento é do projeto pela marca privada (gravada pelo app) ou pela
// etiqueta escrita no título/descrição — para quem cria o compromisso direto
// na Agenda do Google e escreve "#caso-maria" ali mesmo.
export function eventoDoProjeto(event, projetoId) {
  if (!event || !projetoId) return false
  if (event.extendedProperties?.private?.[PROJETO_PROP] === projetoId) return true
  const escapado = projetoId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|\\s)#${escapado}(?![\\w-])`, 'i')
  return re.test(event.summary || '') || re.test(event.description || '')
}
