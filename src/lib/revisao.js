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

// Teto de itens mandados para a IA: a revisão é para destravar o que mais
// pesa, não para despejar a lista inteira — e cada item a mais é prompt a
// mais para pagar.
const MAX_ITENS = 12

// O que pede decisão na revisão, item por item — é o que a IA recebe para
// propor uma ação concreta para cada um, em vez de só comentar contagens.
// Três tipos, na ordem de quanto pesam: prazo que já passou, espera que
// envelheceu e projeto sem nenhuma próxima ação. "Parada há 3 dias" fica de
// fora de propósito: numa lista de Próximas ações quase tudo está parado há
// três dias, e isso viraria ruído.
//
// Cada item carrega a própria tarefa (`task`) para o app conseguir executar a
// ação escolhida — só que ela nunca vai para o Worker (ver aiRevisao.js).
export function itensDaRevisao({ tasks, idProximas, idAguardando, idAlgumDia }, now = new Date()) {
  const pendentes = (tasks || []).filter((t) => t.status !== 'completed')

  const atrasadas = pendentes
    .filter((t) => isOverdueTask(t, now) && !(idAlgumDia && t.tasklistId === idAlgumDia))
    .filter((t) => !(idAguardando && t.tasklistId === idAguardando))
    .map((t) => ({ id: t.id, tipo: 'atrasada', titulo: t.title, dias: daysSince(t.due, now), task: t }))
    .sort((a, b) => b.dias - a.dias)

  const esperas = pendentes
    .filter((t) => idAguardando && t.tasklistId === idAguardando && t.aguardando)
    .map((t) => ({
      id: t.id,
      tipo: 'aguardando',
      titulo: t.title,
      quem: t.aguardando.quem,
      dias: daysSince(t.aguardando.desde, now),
      task: t,
    }))
    .filter((a) => a.dias !== null && a.dias >= DIAS_AGUARDANDO_ENVELHECIDA)
    .sort((a, b) => b.dias - a.dias)

  // Um projeto parado não tem uma tarefa própria para mexer: o que a IA
  // precisa para sugerir o próximo passo são as outras tarefas dele.
  const projetos = projetosSemProximaAcao(tasks, idProximas).map((projeto) => ({
    id: `projeto:${projeto}`,
    tipo: 'projeto',
    titulo: `#${projeto}`,
    projeto,
    relacionadas: pendentes.filter((t) => t.projeto === projeto).slice(0, 3).map((t) => t.title),
  }))

  return [...atrasadas, ...esperas, ...projetos].slice(0, MAX_ITENS)
}
