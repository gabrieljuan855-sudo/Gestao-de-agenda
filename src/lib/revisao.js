import { daysSince, isOverdueTask, isStalledTask, compararPorPrioridadeEPrazo } from './tasks.js'
import { projetosSemProximaAcao } from './gtd.js'
import { eventStart, eventEnd, findFreeGaps } from './events.js'
import { startOfWeek, endOfWeek, startOfDay, addDays, dateOnlyFromISO, toDateInput, toTimeInput } from './dates.js'
import { workBlocksFor } from './schedule.js'

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
const MAX_ITENS = 15

// Algum dia só entra na lista de itens quando a semana está com espaço
// sobrando (ver semanaEstaFolgada) — reativar item parado numa semana já
// cheia seria empurrar trabalho para cima de quem já não tem onde encaixar.
// Um teto pequeno: são os mais antigos, não a lista inteira.
const MAX_ALGUM_DIA = 5

// O que pede decisão na revisão, item por item — é o que a IA recebe para
// propor uma ação concreta para cada um, em vez de só comentar contagens.
// Cinco tipos, na ordem de quanto pesam: prazo que já passou, espera que
// envelheceu, projeto sem nenhuma próxima ação, próxima ação vaga/parada há
// dias sem ninguém mexer, e (só em semana folgada) item de Algum dia que já
// envelheceu o bastante para merecer reativar ou descartar.
//
// Cada item carrega a própria tarefa (`task`) para o app conseguir executar a
// ação escolhida — só que ela nunca vai para o Worker (ver aiRevisao.js).
export function itensDaRevisao(
  { tasks, idProximas, idAguardando, idAlgumDia, incluirAlgumDia = false },
  now = new Date()
) {
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

  // "Atrasada" já cobre quem tem prazo vencido — aqui é quem não tem prazo
  // nenhum (ou tem prazo no futuro) e mesmo assim ninguém mexeu há dias: o
  // sintoma de um título vago demais para virar ação de verdade.
  const paradas = pendentes
    .filter((t) => idProximas && t.tasklistId === idProximas)
    .filter((t) => isStalledTask(t) && !isOverdueTask(t, now))
    .map((t) => ({ id: t.id, tipo: 'parada', titulo: t.title, dias: daysSince(t.updated, now), task: t }))
    .sort((a, b) => b.dias - a.dias)

  const algumDia = incluirAlgumDia
    ? pendentes
        .filter((t) => idAlgumDia && t.tasklistId === idAlgumDia)
        .map((t) => ({ id: t.id, tipo: 'algum_dia', titulo: t.title, dias: daysSince(t.updated, now), task: t }))
        .sort((a, b) => b.dias - a.dias)
        .slice(0, MAX_ALGUM_DIA)
    : []

  return [...atrasadas, ...esperas, ...projetos, ...paradas, ...algumDia].slice(0, MAX_ITENS)
}

// ---------- Planejar a semana seguinte ----------

// As próximas ações mais fortes candidatas a ganhar um horário na agenda —
// mesma ordenação de prioridade e prazo que a tela Próximas já usa
// (compararPorPrioridadeEPrazo, tasks.js). Não é a lista toda: só o topo, que
// é o que caberia numa semana normal de trabalho.
const MAX_CANDIDATAS = 8

export function candidatasParaAgendar(tasks, idProximas, max = MAX_CANDIDATAS) {
  return (tasks || [])
    .filter((t) => t.status !== 'completed' && idProximas && t.tasklistId === idProximas)
    .slice()
    .sort(compararPorPrioridadeEPrazo)
    .slice(0, max)
    .map((t) => ({
      id: t.id,
      titulo: t.title,
      prioridade: t.priority,
      prazo: t.due ? toDateInput(dateOnlyFromISO(t.due)) : null,
      duracao: t.duracao,
      task: t,
    }))
}

// Vão livre mínimo que vale a pena propor: um espaço menor que isso não cabe
// nem a menor próxima ação com estimativa.
const MIN_MINUTOS_VAGA = 30

// Os vãos livres dos próximos `dias` dias (hoje incluso), no mesmo formato
// achatado (dia + hora) que o prompt da IA consegue ler e devolver de volta
// sem ambiguidade. Reaproveita findFreeGaps/workBlocksFor — os mesmos que já
// calculam "livre agora" no Backlog — só que somados dia a dia em vez de um
// só.
export function vaosLivresDaSemana({ events, schedule, occupies }, hoje = new Date(), dias = 7) {
  const vagas = []
  for (let i = 0; i < dias; i++) {
    const dia = addDays(startOfDay(hoje), i)
    const blocos = workBlocksFor(dia, schedule)
    if (blocos.length === 0) continue
    for (const vao of findFreeGaps(events, dia, blocos, { occupies, minMinutes: MIN_MINUTOS_VAGA })) {
      // Um vão que já começou (o dia de hoje, passando da hora) só serve com
      // o que sobrou dele — sugerir a partir do início dele seria propor um
      // horário que já passou.
      const inicio = vao.start < hoje ? hoje : vao.start
      const minutos = Math.round((vao.end - inicio) / 60000)
      if (minutos < MIN_MINUTOS_VAGA) continue
      vagas.push({ dia: toDateInput(dia), inicio: toTimeInput(inicio), fim: toTimeInput(vao.end), minutos })
    }
  }
  return vagas
}

// Estimativa de quanto a semana está pesada: soma da duração das tarefas com
// prazo nos próximos `dias` dias contra o total de vão livre no mesmo
// período. Tarefa sem estimativa entra com um palpite conservador — melhor
// um alerta impreciso do que nenhum.
const DURACAO_PADRAO_MIN = 30

export function cargaDaSemana({ tasks, events, schedule, occupies }, hoje = new Date(), dias = 7) {
  const inicio = startOfDay(hoje)
  const fim = addDays(inicio, dias)
  const minutosTarefas = (tasks || [])
    .filter((t) => t.status !== 'completed' && t.due)
    .filter((t) => {
      const prazo = dateOnlyFromISO(t.due)
      return prazo >= inicio && prazo < fim
    })
    .reduce((soma, t) => soma + (t.duracao || DURACAO_PADRAO_MIN), 0)

  const minutosLivres = vaosLivresDaSemana({ events, schedule, occupies }, hoje, dias).reduce(
    (soma, v) => soma + v.minutos,
    0
  )

  return { minutosTarefas, minutosLivres }
}

// Folgada o bastante para valer a pena sugerir mais uma coisa (reativar um
// Algum dia): as tarefas com prazo não tomam nem 60% do vão livre da semana.
// Sem vão livre nenhum, nunca está folgada — não tem onde encaixar mais nada.
export function semanaEstaFolgada({ minutosTarefas, minutosLivres }) {
  if (!minutosLivres) return false
  return minutosTarefas <= minutosLivres * 0.6
}
