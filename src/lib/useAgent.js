import { useRef, useState } from 'react'
import { askAgent } from './aiAgent.js'
import { listAllEvents } from './googleApi.js'
import { resolverRef, refDeEvento, refDeTarefa, refDeNota, buildEventPatch, buildTaskPatch } from './agentActions.js'
import { eventStart, isAllDay } from './events.js'
import { fromInputs, toDateInput, toTimeInput, startOfDay } from './dates.js'
import { DEFAULT_PRIORITY } from './priority.js'
import { findListForPriority } from './defaults.js'

// Até onde o agente enxerga para a frente. Mandar a agenda inteira seria caro
// e pioraria a resposta; 30 dias cobrem o que se pede na prática ("semana que
// vem", "dia 20"). Fora disso ele é instruído a dizer que não enxerga, em vez
// de chutar.
const DIAS_A_FRENTE = 30
const MAX_EVENTOS = 60
const MAX_TAREFAS = 60
const MAX_NOTAS = 30
const TRECHO_NOTA = 200

const VERBO = {
  criar_evento: 'Criar compromisso',
  criar_tarefa: 'Criar tarefa',
  editar_evento: 'Mudar compromisso',
  excluir_evento: 'Excluir compromisso',
  editar_tarefa: 'Mudar tarefa',
  excluir_tarefa: 'Excluir tarefa',
  concluir_tarefa: 'Concluir tarefa',
  confirmar_presenca: 'Confirmar presença',
}

export function ehDestrutiva(acao) {
  return acao?.action === 'excluir_evento' || acao?.action === 'excluir_tarefa'
}

export function rotuloDaAcao(acao) {
  return VERBO[acao?.action] || 'Ação'
}

// Ordenada por prazo antes de qualquer corte — do mesmo jeito que os eventos
// já eram, só que aqui faltava. Sem isso, com mais de MAX_TAREFAS pendentes a
// que o usuário está perguntando (a mais próxima do vencimento, em geral)
// podia ficar de fora só por causa da ordem em que a API do Google devolveu,
// e o agente respondia "não encontrei" para algo que existe. Sem prazo vai
// para o fim: não tem uma data para competir por espaço no corte.
export function ordenarTarefasPorPrazo(tasks) {
  return tasks.slice().sort((a, b) => {
    if (!a.due && !b.due) return 0
    if (!a.due) return 1
    if (!b.due) return -1
    return new Date(a.due) - new Date(b.due)
  })
}

// Só o que o modelo precisa para decidir — nunca o objeto cru do Google, que
// traz participantes, descrição e links que não ajudam em nada e custam caro.
// Mesmo espírito de coletarContexto em useBriefing.js.
//
// Os compromissos são buscados aqui, e não tirados do que a tela já carregou:
// aquilo cobre só o período da visão atual, então na visão de Dia o agente
// responderia "não tem nada" sobre a semana que vem — o que seria mentira.
async function montarContexto({ calendars, taskLists, tasks, notes }) {
  const agora = new Date()
  const inicioDeHoje = startOfDay(agora)
  const limite = new Date(inicioDeHoje.getTime() + DIAS_A_FRENTE * 24 * 60 * 60 * 1000)

  const eventos = await listAllEvents({ timeMin: inicioDeHoje, timeMax: limite })
  const eventosVisiveis = eventos
    .slice()
    .sort((a, b) => eventStart(a) - eventStart(b))
    .slice(0, MAX_EVENTOS)

  const tarefasVisiveis = ordenarTarefasPorPrazo(tasks.filter((t) => t.status !== 'completed')).slice(0, MAX_TAREFAS)
  const notasVisiveis = notes.slice(0, MAX_NOTAS)

  const nomeDaAgenda = (id) => {
    const cal = calendars.find((c) => c.id === id)
    return cal ? cal.summaryOverride || cal.summary : ''
  }

  return {
    contexto: {
      calendars: calendars.map((c) => ({ id: c.id, name: c.summaryOverride || c.summary })),
      taskLists: taskLists.map((l) => ({ id: l.id, title: l.title })),
      eventos: eventosVisiveis.map((e, i) => {
        const inicio = eventStart(e)
        return {
          ref: refDeEvento(i),
          titulo: e.summary || '(sem título)',
          dia: toDateInput(inicio),
          hora: isAllDay(e) ? null : toTimeInput(inicio),
          agenda: nomeDaAgenda(e.calendarId),
        }
      }),
      tarefas: tarefasVisiveis.map((t, i) => ({
        ref: refDeTarefa(i),
        titulo: t.title || '(sem título)',
        prazo: t.due ? toDateInput(new Date(t.due)) : null,
        prioridade: t.priority || null,
        lista: t.tasklistTitle || '',
      })),
      notas: notasVisiveis.map((n, i) => ({
        ref: refDeNota(i),
        titulo: n.title?.trim() || '(sem título)',
        trecho: (n.body || '').trim().slice(0, TRECHO_NOTA),
      })),
    },
    // As mesmas listas, na mesma ordem, para o cliente reencontrar o item real
    // por trás de cada referência. Se elas mudarem antes da aprovação, a ação
    // vira órfã em vez de acertar o vizinho.
    vivos: { eventos: eventosVisiveis, tarefas: tarefasVisiveis },
  }
}

// O agente mora aqui, e não dentro do painel, pela mesma razão das anotações
// (ver useNotes.js): o trilho desmonta o painel ao fechar, e a conversa
// inteira sumiria toda vez que a pessoa fechasse para olhar a agenda que o
// agente acabou de citar.
export default function useAgent({ calendars = [], taskLists = [], tasks = [], notes = [], handlers = {} }) {
  const [messages, setMessages] = useState([])
  const [pending, setPending] = useState([])
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  // Os itens que estavam à vista quando o agente respondeu. É contra eles que
  // cada referência é reconferida na hora de executar.
  const vivosRef = useRef({ eventos: [], tarefas: [] })

  async function send(text) {
    const limpo = text.trim()
    if (!limpo || thinking) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const historico = messages.map((m) => ({ role: m.role, text: m.text }))
    setMessages((atual) => [...atual, { role: 'user', text: limpo }])
    setPending([])
    setThinking(true)
    setError(null)

    try {
      const { contexto, vivos } = await montarContexto({ calendars, taskLists, tasks, notes })
      if (controller.signal.aborted) return
      const resposta = await askAgent({ text: limpo, history: historico, context: contexto }, { signal: controller.signal })
      if (controller.signal.aborted) return

      vivosRef.current = vivos
      setMessages((atual) => [...atual, { role: 'assistant', text: resposta.reply }])
      setPending(resposta.actions.map((a) => ({ ...a, status: 'idle', erro: null })))
      if (resposta.descartadas > 0) {
        setError(
          `Descartei ${resposta.descartadas} ${resposta.descartadas === 1 ? 'ação que apontava' : 'ações que apontavam'} para algo que não está à vista.`
        )
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(
        err.transiente
          ? `${err.message} Tenta de novo daqui a pouco — costuma passar rápido.`
          : `Não deu para falar com o agente: ${err.message}`
      )
    } finally {
      if (!controller.signal.aborted) setThinking(false)
    }
  }

  async function executar(acao) {
    const alvo = acao.ref ? resolverRef(acao.ref, vivosRef.current) : null
    if (acao.ref && !alvo) throw new Error('orfa')

    const {
      onCreateEvent,
      onCreateTask,
      onUpdateEvent,
      onDeleteEvent,
      onUpdateTask,
      onDeleteTask,
      onCompleteTask,
      onSetPresence,
    } = handlers

    if (acao.action === 'criar_evento') {
      // Compromisso sem dia é um pedido pela metade — melhor dizer isso do que
      // inventar uma data e gravar na agenda de verdade.
      if (!acao.date) throw new Error('Faltou o dia desse compromisso.')
      const inicio = fromInputs(acao.date, acao.time)
      const minutos = acao.durationMinutes || 60
      await onCreateEvent({
        title: acao.title,
        start: inicio,
        end: new Date(inicio.getTime() + minutos * 60000),
        calendarId: acao.calendarId || '',
      })
      return
    }
    if (acao.action === 'criar_tarefa') {
      // Prioridade e lista são a mesma coisa nas listas do usuário
      // ("Prioridade Alta", "Prioridade Média"...) — o mesmo mapeamento que o
      // QuickAdd faz, em vez de pedir a lista ao modelo.
      const prioridade = acao.priority || DEFAULT_PRIORITY
      const lista = findListForPriority(taskLists, prioridade)
      await onCreateTask({
        title: acao.title,
        priority: prioridade,
        due: acao.date ? fromInputs(acao.date) : null,
        tasklistId: lista ? lista.id : '',
      })
      return
    }
    if (acao.action === 'excluir_evento') return onDeleteEvent(alvo.item)
    if (acao.action === 'editar_evento') return onUpdateEvent(alvo.item, buildEventPatch(alvo.item, acao))
    if (acao.action === 'confirmar_presenca') return onSetPresence(alvo.item, acao.presence)
    if (acao.action === 'excluir_tarefa') return onDeleteTask(alvo.item)
    if (acao.action === 'editar_tarefa') return onUpdateTask(alvo.item, buildTaskPatch(acao))
    if (acao.action === 'concluir_tarefa') return onCompleteTask(alvo.item)
  }

  function marcar(id, campos) {
    setPending((atual) => atual.map((a) => (a.id === id ? { ...a, ...campos } : a)))
  }

  async function approve(id) {
    const acao = pending.find((a) => a.id === id)
    if (!acao || acao.status === 'executando' || acao.status === 'feito') return
    marcar(id, { status: 'executando', erro: null })
    try {
      await executar(acao)
      marcar(id, { status: 'feito' })
      registrarResultado(1, 0)
    } catch (err) {
      const orfa = err.message === 'orfa'
      marcar(id, {
        status: orfa ? 'orfa' : 'erro',
        erro: orfa ? 'Esse item não está mais na lista que eu tinha visto.' : err.message,
      })
      registrarResultado(0, 1)
    }
  }

  // Em sequência de propósito: o Tasks limita chamadas em paralelo, e assim
  // cada linha mostra o próprio progresso de verdade.
  async function approveAll() {
    const fila = pending.filter((a) => a.status === 'idle')
    if (fila.length === 0) return
    let ok = 0
    let falhas = 0
    for (const acao of fila) {
      marcar(acao.id, { status: 'executando', erro: null })
      try {
        await executar(acao)
        marcar(acao.id, { status: 'feito' })
        ok++
      } catch (err) {
        const orfa = err.message === 'orfa'
        marcar(acao.id, {
          status: orfa ? 'orfa' : 'erro',
          erro: orfa ? 'Esse item não está mais na lista que eu tinha visto.' : err.message,
        })
        falhas++
      }
    }
    registrarResultado(ok, falhas)
  }

  // O que de fato aconteceu entra na conversa: sem isso, a rodada seguinte
  // acharia que as ações ainda estão pendentes e proporia tudo de novo.
  function registrarResultado(ok, falhas) {
    const partes = []
    if (ok > 0) partes.push(`${ok} ${ok === 1 ? 'ação aplicada' : 'ações aplicadas'}`)
    if (falhas > 0) partes.push(`${falhas} ${falhas === 1 ? 'falhou' : 'falharam'}`)
    if (partes.length > 0) setMessages((atual) => [...atual, { role: 'assistant', text: partes.join(', ') + '.' }])
  }

  function reject(id) {
    setPending((atual) => atual.filter((a) => a.id !== id))
  }

  function clear() {
    abortRef.current?.abort()
    setMessages([])
    setPending([])
    setError(null)
    setThinking(false)
  }

  return {
    messages,
    pending,
    thinking,
    error,
    dismissError: () => setError(null),
    send,
    approve,
    approveAll,
    reject,
    clear,
  }
}
