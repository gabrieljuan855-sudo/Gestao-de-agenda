import { daysSince, isOverdueTask, isStalledTask } from './tasks.js'
import { projetosSemProximaAcao } from './gtd.js'
import { eventStart, eventEnd } from './events.js'
import { startOfWeek, endOfWeek } from './dates.js'

// Só conta espera como "envelhecendo" depois de uma semana — o mesmo limiar
// que a tela Aguardando já usa para destacar em âmbar.
const DIAS_AGUARDANDO_ENVELHECIDA = 7

// Os números da revisão semanal do GTD, sem IA nenhuma: o que está parado, o
// que venceu, o que ainda espera alguém, o que foi feito. A IA só entra depois,
// para comentar por cima destes números — nunca para contá-los, porque contar
// certo é o tipo de coisa que código determinístico já faz sem chutar.
export function numerosDaRevisao(
  { tasks, focusEvents = [], idProximas, idAguardando, entradaVazia },
  now = new Date()
) {
  const pendentes = (tasks || []).filter((t) => t.status !== 'completed')
  const inicio = startOfWeek(now)
  const fim = endOfWeek(now)

  const concluidasNaSemana = (tasks || []).filter(
    (t) => t.status === 'completed' && t.completed && new Date(t.completed) >= inicio && new Date(t.completed) <= fim
  )

  const focoNaSemana = focusEvents.filter((e) => {
    const inicioEvento = eventStart(e)
    return inicioEvento && inicioEvento >= inicio && inicioEvento <= fim
  })
  const minutosDeFoco = Math.round(
    focoNaSemana.reduce((soma, e) => soma + Math.max(0, (eventEnd(e) - eventStart(e)) / 60000), 0)
  )

  const aguardandoAtivos = pendentes.filter((t) => idAguardando && t.tasklistId === idAguardando && t.aguardando)
  const aguardandoEnvelhecendo = aguardandoAtivos
    .map((t) => ({ title: t.title, dias: daysSince(t.aguardando.desde, now) }))
    .filter((a) => a.dias !== null && a.dias >= DIAS_AGUARDANDO_ENVELHECIDA)
    .sort((a, b) => b.dias - a.dias)

  return {
    entradaVazia: Boolean(entradaVazia),
    atrasadas: pendentes.filter((t) => isOverdueTask(t, now)).length,
    paradas: pendentes.filter(isStalledTask).length,
    projetosParados: projetosSemProximaAcao(tasks, idProximas),
    aguardandoEnvelhecendo,
    concluidasNaSemana: concluidasNaSemana.length,
    blocosDeFoco: focoNaSemana.length,
    minutosDeFoco,
  }
}
