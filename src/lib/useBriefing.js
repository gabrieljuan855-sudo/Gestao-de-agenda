import { useEffect, useRef, useState } from 'react'
import { listAllEvents, listAllTasks, prefetchFocusEvents } from './googleApi.js'
import { fetchBriefingFromAI } from './aiBriefing.js'
import { isWorkday } from './schedule.js'
import { occupiesTime, isDeclined } from './calendarPrefs.js'
import { eventStart, eventEnd, tasksDueOn } from './events.js'
import { overdueTasks } from './tasks.js'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, toTimeInput, toDateInput } from './dates.js'

// Não há infraestrutura de push/cron neste app (mesma limitação da varredura
// de notas, ver useNotes.js): os horários fixos só disparam enquanto o app
// está aberto (ou volta a ficar visível/em foco) perto da hora certa.
const SLOTS = [
  { id: 'manha', hour: 8, minute: 0 },
  { id: 'tarde', hour: 13, minute: 0 },
  { id: 'recap', hour: 17, minute: 25 },
]
// Depois desse atraso, não faz mais sentido mostrar "veja o briefing aqui"
// — ninguém quer o resumo da manhã aparecendo à noite. O slot só é marcado
// como feito (sem gerar nada) quando esse prazo já passou.
const JANELA_MS = 90 * 60 * 1000
// De quanto em quanto tempo a varredura reconfere os horários.
const CHECAGEM_MS = 5 * 60 * 1000
// Quanto tempo o cartão fica ao lado do "Bom dia" antes de sumir sozinho.
const CARTAO_VISIVEL_MS = 30 * 60 * 1000
const STORAGE_KEY = 'gestao-agenda:briefing-feito'

function hojeISO(d) {
  return toDateInput(d)
}

function lerFeitos() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (raw?.dia === hojeISO(new Date())) return raw.feitos || []
  } catch {
    // Sem acesso ao localStorage: pior caso é gerar de novo a cada checagem.
  }
  return []
}

function gravarFeito(id) {
  const feitos = lerFeitos()
  if (!feitos.includes(id)) feitos.push(id)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dia: hojeISO(new Date()), feitos }))
  } catch {
    // Ver comentário acima.
  }
}

// Cada um dos 3 horários fixos serve dois papéis, dependendo do dia da
// semana: segunda de manhã puxa a semana inteira, sexta às 17h25 fecha a
// semana — os outros dias usam a versão diária normal. Fim de semana não
// gera briefing nenhum.
export function kindForSlot(slotId, date) {
  if (!isWorkday(date)) return null
  const dow = date.getDay()
  if (slotId === 'manha') return dow === 1 ? 'semana_inicio' : 'dia_manha'
  if (slotId === 'tarde') return 'dia_tarde'
  if (slotId === 'recap') return dow === 5 ? 'semana_fim' : 'dia_recap'
  return null
}

// Vale mesmo incomodar a pessoa com este erro?
//
// Uma sobrecarga do Gemini (503) se resolve sozinha em segundos, e a varredura
// já tenta de novo a cada checagem enquanto a janela do horário não fecha.
// Mostrar um aviso vermelho para isso é alarmar por algo que está sendo
// tratado — a pessoa não tem o que fazer com essa informação. Então o aviso só
// aparece quando o erro não vai se resolver sozinho, ou quando já não sobra
// tempo para outra tentativa.
export function deveAvisarDaFalha({ transiente, msDesdeOAlvo }) {
  if (!transiente) return true
  return msDesdeOAlvo + CHECAGEM_MS >= JANELA_MS
}

function minutosDoEvento(evento) {
  return Math.max(0, (eventEnd(evento) - eventStart(evento)) / 60000)
}

// Monta o resumo dos dados (nunca a lista crua e completa de eventos/tarefas)
// que vai virar o prompt da IA — e, para o fim de semana, os números que
// viram os cartões do painel, calculados aqui mesmo, sem depender da IA para
// contar certo.
async function coletarContexto(kind, { ocupa, recusado }) {
  const now = new Date()

  if (kind === 'dia_manha' || kind === 'dia_tarde') {
    const [eventos, tasks] = await Promise.all([
      listAllEvents({ timeMin: startOfDay(now), timeMax: endOfDay(now) }),
      listAllTasks({ showCompleted: false }),
    ])
    const restantes = eventos.filter((e) => ocupa(e) && !recusado(e) && eventEnd(e) >= now)
    const pendentes = tasks.filter((t) => t.status !== 'completed')
    return {
      context: {
        compromissosRestantesHoje: restantes.slice(0, 12).map((e) => ({ titulo: e.summary, hora: toTimeInput(eventStart(e)) })),
        tarefasComPrazoHoje: tasksDueOn(pendentes, now).length,
        tarefasAtrasadas: overdueTasks(pendentes, now).length,
      },
    }
  }

  if (kind === 'dia_recap') {
    const [eventos, tasks, focoEventos] = await Promise.all([
      listAllEvents({ timeMin: startOfDay(now), timeMax: endOfDay(now) }),
      listAllTasks({ showCompleted: true }),
      prefetchFocusEvents(),
    ])
    const concluidasHoje = tasks.filter((t) => t.status === 'completed' && t.completed && hojeISO(new Date(t.completed)) === hojeISO(now))
    const focoHoje = focoEventos.filter((e) => hojeISO(eventStart(e)) === hojeISO(now))
    return {
      context: {
        tarefasConcluidasHoje: concluidasHoje.slice(0, 12).map((t) => t.title),
        blocosDeFocoHoje: focoHoje.length,
        minutosDeFocoHoje: Math.round(focoHoje.reduce((soma, e) => soma + minutosDoEvento(e), 0)),
        compromissosHoje: eventos.filter((e) => ocupa(e) && !recusado(e)).length,
      },
    }
  }

  if (kind === 'semana_inicio') {
    const [eventos, tasks] = await Promise.all([
      listAllEvents({ timeMin: startOfWeek(now), timeMax: endOfWeek(now) }),
      listAllTasks({ showCompleted: false }),
    ])
    const pendentes = tasks.filter((t) => t.status !== 'completed')
    return {
      context: {
        compromissosDaSemana: eventos.filter(ocupa).slice(0, 20).map((e) => ({ titulo: e.summary, dia: toDateInput(eventStart(e)) })),
        tarefasPendentes: pendentes.slice(0, 20).map((t) => t.title),
      },
    }
  }

  if (kind === 'semana_fim') {
    const inicio = startOfWeek(now)
    const fim = endOfWeek(now)
    const [eventos, tasks, focoEventos] = await Promise.all([
      listAllEvents({ timeMin: inicio, timeMax: fim }),
      listAllTasks({ showCompleted: true }),
      prefetchFocusEvents(),
    ])
    const concluidasSemana = tasks.filter(
      (t) => t.status === 'completed' && t.completed && new Date(t.completed) >= inicio && new Date(t.completed) <= fim
    )
    const focoSemana = focoEventos.filter((e) => eventStart(e) >= inicio && eventStart(e) <= fim)
    const compromissosSemana = eventos.filter(ocupa)
    const comparecidos = compromissosSemana.filter((e) => !recusado(e) && eventStart(e) < now)
    const stats = {
      tarefasConcluidas: concluidasSemana.length,
      blocosDeFoco: focoSemana.length,
      minutosDeFoco: Math.round(focoSemana.reduce((soma, e) => soma + minutosDoEvento(e), 0)),
      compromissosComparecidos: comparecidos.length,
      compromissosTotais: compromissosSemana.length,
    }
    return { context: stats, stats }
  }

  return { context: {} }
}

// Junta a geração dos 5 tipos de briefing (dia de manhã/tarde, recap do dia,
// início e fim de semana) numa varredura só, no mesmo molde da varredura de
// notas (useNotes.js): confere nos mesmos gatilhos (abrir o app, voltar o
// foco/visibilidade, a cada 5 minutos) se algum dos 3 horários fixos já
// passou hoje e ainda não foi feito.
export default function useBriefing({ signedIn, calendarPrefs, presence }) {
  const [briefing, setBriefing] = useState(null) // { kind, text, stats? }
  const [showCard, setShowCard] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  // Antes disto, uma falha em gerar o briefing (rede, Worker fora do ar) não
  // aparecia em lugar nenhum — a pessoa só não via o cartão, sem saber se
  // era isso ou se o horário ainda não tinha chegado. A checagem seguinte
  // (5 min depois, dentro da janela) tenta de novo sozinha; isto só existe
  // para quando ela também falhar, ou para a última tentativa da janela.
  const [error, setError] = useState(null)
  const hideTimerRef = useRef(null)
  const emAndamentoRef = useRef(new Set())
  const prefsRef = useRef({ calendarPrefs, presence })

  useEffect(() => {
    prefsRef.current = { calendarPrefs, presence }
  }, [calendarPrefs, presence])

  useEffect(() => {
    if (!signedIn) return

    async function gerar(kind) {
      const { calendarPrefs: prefs, presence: pres } = prefsRef.current
      const ocupa = (e) => occupiesTime(e, prefs, pres)
      const recusado = (e) => isDeclined(e, pres)
      const { context, stats } = await coletarContexto(kind, { ocupa, recusado })
      const text = await fetchBriefingFromAI(kind, context)
      return { kind, text, stats: stats || null }
    }

    async function checkSlot(slot) {
      if (emAndamentoRef.current.has(slot.id) || lerFeitos().includes(slot.id)) return

      const now = new Date()
      const alvo = new Date(now)
      alvo.setHours(slot.hour, slot.minute, 0, 0)
      if (now < alvo) return

      if (now - alvo > JANELA_MS) {
        gravarFeito(slot.id)
        return
      }

      const kind = kindForSlot(slot.id, now)
      if (!kind) {
        gravarFeito(slot.id)
        return
      }

      emAndamentoRef.current.add(slot.id)
      try {
        const resultado = await gerar(kind)
        // Só marca como feito depois de gerar com sucesso: uma falha de rede
        // pode tentar de novo na próxima checagem, enquanto ainda há janela.
        gravarFeito(slot.id)
        setError(null)
        setBriefing(resultado)
        setShowCard(true)
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = setTimeout(() => setShowCard(false), CARTAO_VISIVEL_MS)
      } catch (err) {
        console.error('Não foi possível gerar o briefing:', err)
        if (deveAvisarDaFalha({ transiente: err.transiente, msDesdeOAlvo: Date.now() - alvo })) {
          setError(`Não deu para gerar o briefing agora: ${err.message}`)
        }
      } finally {
        emAndamentoRef.current.delete(slot.id)
      }
    }

    function checkAll() {
      if (document.visibilityState !== 'visible') return
      SLOTS.forEach(checkSlot)
    }

    checkAll()
    document.addEventListener('visibilitychange', checkAll)
    window.addEventListener('focus', checkAll)
    const id = setInterval(checkAll, CHECAGEM_MS)
    return () => {
      document.removeEventListener('visibilitychange', checkAll)
      window.removeEventListener('focus', checkAll)
      clearInterval(id)
      clearTimeout(hideTimerRef.current)
    }
  }, [signedIn])

  return {
    briefing,
    showCard,
    overlayOpen,
    error,
    dismissError: () => setError(null),
    openOverlay: () => setOverlayOpen(true),
    closeOverlay: () => setOverlayOpen(false),
    dismissCard: () => setShowCard(false),
  }
}
