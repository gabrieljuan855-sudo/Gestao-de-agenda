// O que cada ferramenta do conector faz, sem nada de MCP nem de OAuth: cada
// função recebe as APIs já montadas (as mesmas de src/lib/, com o `request`
// do conector) e devolve o texto que o Claude vai ler.
//
// A regra daqui é não ter regra própria. Lista por nome é acharLista, o bloco
// [alta @contexto #projeto ~quem desde: min:] é encodeMeta/parseMeta,
// atrasada é isOverdueTask, projeto parado é listarProjetos, vão livre é
// findFreeGaps com o horário de schedule.js, nota é o formato de
// notasFormato.js gravado com mesclarParaGravar. Se o app mudar uma dessas
// regras, o conector muda junto, porque é o mesmo código.

import {
  LISTA_ENTRADA,
  LISTA_PROXIMAS,
  LISTA_AGUARDANDO,
  LISTA_ALGUM_DIA,
  acharLista,
  etiqueta,
} from '../../src/lib/gtd.js'
import { isOverdueTask, compararPorPrioridadeEPrazo } from '../../src/lib/tasks.js'
import { acoesParaAgora } from '../../src/lib/agora.js'
import { PRIORITY_LABEL } from '../../src/lib/priority.js'
import {
  listarProjetos,
  tarefasDoProjeto,
  eventoDoProjeto,
  normalizarProjeto,
  normalizarProjetos,
  novoProjeto,
  juntarConcluidas,
  trechoDaAnotacao,
  PROJETO_PROP,
  SITUACOES,
  fichaParaEtiqueta,
  juntarArquivos,
  arquivoDoDrive,
  tipoDoArquivo,
  tamanhoLegivel,
} from '../../src/lib/projetos.js'
import { aplicarModelo, MODELOS } from '../../src/lib/modelosDeProjeto.js'
import { separarAnexos, juntarAnexos, anexoDoLink } from '../../src/lib/anexosNoTexto.js'
import { findFreeGaps, occursOnDay, isAllDay, eventStart, eventEnd } from '../../src/lib/events.js'
import { workBlocksFor, horarioPadrao } from '../../src/lib/schedule.js'
import { loadCalendarPrefs, occupiesTime, isDeclined } from '../../src/lib/calendarPrefs.js'
import { montarEventoDeConclusao, ehRegistroDeConclusao } from '../../src/lib/taskDoneEvent.js'
import { newNote, sanitizeNotes, juntarFontes } from '../../src/lib/notasFormato.js'
import { ligacoesDaNota, saudeDasNotas, indiceDeTitulos, chaveDeTitulo, renomearLinks } from '../../src/lib/notasLinks.js'
import { buscarNasNotas, trechoDaBusca } from '../../src/lib/notasBusca.js'
import { tituloDaNota, notaVazia } from '../../src/lib/notasLista.js'
import { mesclarParaGravar, mesclarAnotacoes } from '../../src/lib/notesMerge.js'
import { semAcento } from '../../src/lib/texto.js'
import {
  dataNoFuso,
  horaNoFuso,
  instanteNoFuso,
  somarDias,
  relogioLocal,
  instanteDoRelogio,
  eventoNoRelogioLocal,
  dataComDia,
  nomeDoDia,
  diasEntre,
} from './tempo.js'

export const LISTAS = {
  entrada: LISTA_ENTRADA,
  proximas: LISTA_PROXIMAS,
  aguardando: LISTA_AGUARDANDO,
  algum_dia: LISTA_ALGUM_DIA,
}

// Erro de uso (id que não existe, combinação que não faz sentido): a mensagem
// vai para o Claude como está, para ele corrigir o pedido.
export class ErroDeUso extends Error {}

const DIAS_DE_ESPERA = 7

// ---------- leitura comum ----------

function chaveDaLista(tarefa, listas) {
  for (const [chave, nome] of Object.entries(LISTAS)) {
    if (acharLista(listas, nome)?.id === tarefa.tasklistId) return chave
  }
  return null
}

function rotuloDaLista(tarefa, listas) {
  const chave = chaveDaLista(tarefa, listas)
  return chave ? LISTAS[chave] : tarefa.tasklistTitle || 'outra lista'
}

async function carregarTarefas(api, { concluidasDesde = null } = {}) {
  const [listas, pendentes, concluidas] = await Promise.all([
    api.tarefas.listTaskLists(),
    api.tarefas.listAllTasks(),
    concluidasDesde ? api.tarefas.listCompletedTasks({ completedMin: concluidasDesde }) : [],
  ])
  return { listas, tarefas: pendentes.filter((t) => t.status !== 'completed'), concluidas }
}

function linhaDaTarefa(t, { listas, hoje, hojeLocal, mostrarLista = false }) {
  const partes = []
  if (mostrarLista) partes.push(rotuloDaLista(t, listas))
  partes.push(PRIORITY_LABEL[t.priority] || t.priority)
  if (t.contexto) partes.push(`@${t.contexto}`)
  if (t.projeto) partes.push(`#${t.projeto}`)
  if (t.aguardando?.quem) {
    const desde = t.aguardando.desde ? `, desde ${dataComDia(t.aguardando.desde, { ano: false })}` : ''
    partes.push(`aguardando ${t.aguardando.quem}${desde}`)
  }
  if (t.due) {
    const prazo = t.due.slice(0, 10)
    const dias = diasEntre(hoje, prazo)
    let quando = ''
    if (isOverdueTask(t, hojeLocal)) quando = ` (atrasada há ${-dias} dia${dias === -1 ? '' : 's'})`
    else if (dias === 0) quando = ' (hoje)'
    else if (dias === 1) quando = ' (amanhã)'
    partes.push(`prazo ${dataComDia(prazo)}${quando}`)
  }
  if (t.duracao) partes.push(`${t.duracao} min`)
  const nota = t.notesClean?.trim() ? ` — nota: ${trechoDaAnotacao(t.notesClean, 120)}` : ''
  return `- ${t.title || '(sem título)'} · ${partes.join(' · ')} [id: ${t.id}]${nota}`
}

function listaComLimite(itens, limite, formatar) {
  const linhas = itens.slice(0, limite).map(formatar)
  if (itens.length > limite) linhas.push(`(há mais ${itens.length - limite} — peça com um limite maior ou um filtro)`)
  return linhas.join('\n')
}

function dataDoEvento(e) {
  return e.start?.date || dataNoFuso(new Date(e.start?.dateTime))
}

function linhaDoEvento(e, dia) {
  let quando
  if (isAllDay(e)) quando = 'dia inteiro'
  else {
    const inicio = new Date(e.start.dateTime)
    const fim = new Date(e.end?.dateTime || e.start.dateTime)
    // Compromisso que começou num dia e entra no outro mostra a data junto.
    const prefixo = dataNoFuso(inicio) !== dia ? `${dataComDia(dataNoFuso(inicio), { ano: false })} ` : ''
    quando = `${prefixo}${horaNoFuso(inicio)}–${horaNoFuso(fim)}`
  }
  const partes = [`${quando} ${e.summary || '(sem título)'}`]
  if (e.calendarSummary && !e.calendarIsPrimary) partes.push(`agenda ${e.calendarSummary}`)
  if (e.location) partes.push(e.location)
  const projeto = e.extendedProperties?.private?.[PROJETO_PROP]
  if (projeto) partes.push(`#${projeto}`)
  if (isDeclined(e, {})) partes.push('recusado')
  return `- ${partes.join(' · ')}`
}

// Os compromissos de cada dia do intervalo, com os vãos livres do expediente.
// O expediente é o padrão de fábrica de schedule.js: o horário que a pessoa
// ajusta no app mora só no aparelho dela (localStorage), fora do alcance do
// servidor — por isso a resposta diz de onde o horário veio.
function diasDaAgenda(eventos, calendarios, de, ate, { vaos = true } = {}) {
  const prefs = loadCalendarPrefs(calendarios)
  const ocupa = (e) => occupiesTime(e, prefs, {}) && !isDeclined(e, {})
  const locais = eventos.filter((e) => e.status !== 'cancelled').map((e) => ({ original: e, local: eventoNoRelogioLocal(e) }))
  const horario = horarioPadrao()
  const blocos = []
  for (let dia = de; dia <= ate; dia = somarDias(dia, 1)) {
    const [a, m, d] = dia.split('-').map(Number)
    const diaLocal = new Date(a, m - 1, d)
    const doDia = locais.filter((x) => occursOnDay(x.local, diaLocal) && !ehRegistroDeConclusao(x.original))
    const linhas = doDia
      .sort((x, y) => eventStart(x.local) - eventStart(y.local))
      .map((x) => linhaDoEvento(x.original, dia))
    let texto = `${nomeDoDia(dia)}, ${dataComDia(dia).slice(5)}:\n${linhas.length ? linhas.join('\n') : '- nenhum compromisso'}`
    if (vaos) {
      const expediente = workBlocksFor(diaLocal, horario)
      if (expediente.length === 0) texto += '\n  vãos livres: fora do expediente (dia sem horário de trabalho)'
      else {
        const livres = findFreeGaps(
          doDia.map((x) => x.local),
          diaLocal,
          expediente,
          { occupies: ocupa }
        ).map((g) => `${horaNoFuso(instanteDoRelogio(g.start))}–${horaNoFuso(instanteDoRelogio(g.end))}`)
        texto += `\n  vãos livres no expediente: ${livres.length ? livres.join(', ') : 'nenhum de 30 min ou mais'}`
      }
    }
    blocos.push(texto)
  }
  return blocos.join('\n\n')
}

async function lerDrive(api) {
  const [notas, projetos] = await Promise.allSettled([api.drive.loadNotes(), api.drive.loadProjetos()])
  return {
    notas: notas.status === 'fulfilled' ? sanitizeNotes(notas.value?.notes) : [],
    registros: projetos.status === 'fulfilled' ? normalizarProjetos(projetos.value || []) : [],
    falha: notas.status === 'rejected' ? notas.reason : projetos.status === 'rejected' ? projetos.reason : null,
  }
}

function cabecalho(agora) {
  const hoje = dataNoFuso(agora)
  return `Agora: ${nomeDoDia(hoje)}, ${dataComDia(hoje).slice(5)}, ${horaNoFuso(agora)} (horário de Brasília).`
}

// ---------- visao_geral ----------

export async function visaoGeral(api, agora, { traduzirErro = (e) => e.message } = {}) {
  const hoje = dataNoFuso(agora)
  const hojeLocal = relogioLocal(agora)
  const [{ listas, tarefas }, calendarios, eventos, drive] = await Promise.all([
    carregarTarefas(api),
    api.agenda.listCalendars(),
    api.agenda.listAllEvents({ timeMin: instanteNoFuso(hoje), timeMax: instanteNoFuso(somarDias(hoje, 2)) }),
    lerDrive(api),
  ])
  const ctx = { listas, hoje, hojeLocal }
  const naLista = (nome) => {
    const id = acharLista(listas, nome)?.id
    return id ? tarefas.filter((t) => t.tasklistId === id) : []
  }

  const entrada = naLista(LISTA_ENTRADA)
  const proximas = naLista(LISTA_PROXIMAS).sort(compararPorPrioridadeEPrazo)
  const porPrioridade = (p) => proximas.filter((t) => t.priority === p).length
  const atrasadas = tarefas.filter((t) => isOverdueTask(t, hojeLocal)).sort(compararPorPrioridadeEPrazo)
  const esperando = naLista(LISTA_AGUARDANDO)
    .map((t) => ({ t, dias: diasEntre(t.aguardando?.desde || dataNoFuso(new Date(t.updated)), hoje) }))
    .filter((x) => x.dias > DIAS_DE_ESPERA)
    .sort((a, b) => b.dias - a.dias)
  const projetos = listarProjetos(
    { registros: drive.registros, tasks: tarefas, notes: drive.notas, idProximas: acharLista(listas, LISTA_PROXIMAS)?.id },
    hojeLocal
  )
  const parados = projetos.filter((p) => p.semProximaAcao)

  const secoes = [cabecalho(agora)]
  secoes.push(
    `## Entrada: ${entrada.length} ${entrada.length === 1 ? 'item' : 'itens'} para esclarecer` +
      (entrada.length ? `\n${listaComLimite(entrada, 5, (t) => `- ${t.title} [id: ${t.id}]`)}` : '')
  )
  secoes.push(
    `## Próximas ações: ${proximas.length} (alta ${porPrioridade('alta')}, média ${porPrioridade('media')}, baixa ${porPrioridade('baixa')})` +
      (proximas.length ? `\n${listaComLimite(proximas, 8, (t) => linhaDaTarefa(t, ctx))}` : '')
  )
  secoes.push(
    `## Atrasadas: ${atrasadas.length}` +
      (atrasadas.length ? `\n${listaComLimite(atrasadas, 10, (t) => linhaDaTarefa(t, { ...ctx, mostrarLista: true }))}` : '')
  )
  secoes.push(
    `## Aguardando há mais de ${DIAS_DE_ESPERA} dias: ${esperando.length}` +
      (esperando.length
        ? `\n${listaComLimite(esperando, 10, ({ t, dias }) => `- ${t.title} · ${t.aguardando?.quem ? `com ${t.aguardando.quem} · ` : ''}há ${dias} dias [id: ${t.id}]`)}`
        : '')
  )
  secoes.push(
    `## Projetos ativos sem próxima ação: ${parados.length}` +
      (parados.length ? `\n${listaComLimite(parados, 10, (p) => `- ${p.nome} [projeto: ${p.id}]`)}` : '')
  )
  secoes.push(`## Compromissos de hoje e amanhã\n${diasDaAgenda(eventos, calendarios, hoje, somarDias(hoje, 1), { vaos: false })}`)
  if (drive.falha) {
    secoes.push(`Aviso: anotações e fichas de projeto não puderam ser lidas agora — ${traduzirErro(drive.falha)}`)
  }
  return secoes.join('\n\n')
}

// ---------- listar_tarefas ----------

export async function listarTarefas(api, agora, { lista = 'todas', contexto, projeto, atrasadas, cabe_em_minutos, limite = 30 } = {}) {
  const hoje = dataNoFuso(agora)
  const hojeLocal = relogioLocal(agora)
  const { listas, tarefas } = await carregarTarefas(api)

  let alvo = tarefas
  if (lista !== 'todas') {
    const id = acharLista(listas, LISTAS[lista])?.id
    alvo = id ? tarefas.filter((t) => t.tasklistId === id) : []
  }
  if (projeto) alvo = alvo.filter((t) => t.projeto === etiqueta(projeto))
  if (atrasadas) alvo = alvo.filter((t) => isOverdueTask(t, hojeLocal))
  // O mesmo filtro da lista de Próximas na tela: contexto, e o que cabe no
  // tempo (tarefa sem estimativa continua aparecendo — não dá para saber
  // que não cabe).
  alvo = acoesParaAgora(alvo, { contexto: contexto ? etiqueta(contexto) : null, minutosDisponiveis: cabe_em_minutos ?? null })

  const filtros = [
    lista === 'todas' ? 'todas as listas' : `lista ${LISTAS[lista]}`,
    contexto && `@${etiqueta(contexto)}`,
    projeto && `#${etiqueta(projeto)}`,
    atrasadas && 'só atrasadas',
    cabe_em_minutos && `cabe em ${cabe_em_minutos} min (sem estimativa também entra)`,
  ].filter(Boolean)
  if (alvo.length === 0) return `${cabecalho(agora)}\nNenhuma tarefa pendente com: ${filtros.join(', ')}.`
  return `${cabecalho(agora)}\n${alvo.length} tarefa${alvo.length === 1 ? '' : 's'} (${filtros.join(', ')}), por prioridade e prazo:\n${listaComLimite(
    alvo,
    limite,
    (t) => linhaDaTarefa(t, { listas, hoje, hojeLocal, mostrarLista: lista === 'todas' })
  )}`
}

// ---------- agenda ----------

const MAX_DIAS_DE_AGENDA = 31

export async function agenda(api, agora, { de, ate, vaos = true } = {}) {
  const inicio = de || dataNoFuso(agora)
  const fim = ate || inicio
  if (fim < inicio) throw new ErroDeUso('A data final não pode ser antes da inicial.')
  if (diasEntre(inicio, fim) >= MAX_DIAS_DE_AGENDA) throw new ErroDeUso(`Peça no máximo ${MAX_DIAS_DE_AGENDA} dias de cada vez.`)
  const [calendarios, eventos] = await Promise.all([
    api.agenda.listCalendars(),
    api.agenda.listAllEvents({ timeMin: instanteNoFuso(inicio), timeMax: instanteNoFuso(somarDias(fim, 1)) }),
  ])
  const nota = vaos
    ? '\n(Vãos calculados no expediente padrão do app — seg. a qui. 8h–12h e 13h–17h30, sex. 7h30–13h30 —, pois o horário ajustado no app fica só no aparelho. Agendas de "informações" não ocupam tempo, como no app.)'
    : ''
  return `${cabecalho(agora)}\n\n${diasDaAgenda(eventos, calendarios, inicio, fim, { vaos })}${nota}`
}

// ---------- projetos ----------

function acharFicha(registros, chave) {
  const id = etiqueta(chave)
  return registros.find((p) => p.id === id || etiqueta(p.nome) === id) || null
}

function linhaDoProjeto(p) {
  const partes = [SITUACOES.find((s) => s.id === p.situacao)?.label || p.situacao, p.tipo === 'rotina' ? 'rotina' : 'projeto']
  partes.push(`${p.pendentes} pendente${p.pendentes === 1 ? '' : 's'}${p.atrasadas ? ` (${p.atrasadas} atrasada${p.atrasadas === 1 ? '' : 's'})` : ''}`)
  if (p.anotacoes) partes.push(`${p.anotacoes} anotaç${p.anotacoes === 1 ? 'ão' : 'ões'}`)
  if (p.prazo) partes.push(`prazo ${dataComDia(p.prazo)}`)
  if (p.proximaAcao) partes.push(`próxima ação: ${p.proximaAcao.title}`)
  if (p.semProximaAcao) partes.push('SEM PRÓXIMA AÇÃO')
  if (p.implicito) partes.push('sem ficha (só a etiqueta em tarefas/notas)')
  if (p.concluidoComPendencias) partes.push(`ATENÇÃO: concluído, mas com ${p.pendentes} pendente${p.pendentes === 1 ? '' : 's'}`)
  return `- ${p.nome} [projeto: ${p.id}] · ${partes.join(' · ')}`
}

export async function listarProjetosTexto(api, agora, { situacao = 'ativo' } = {}) {
  const [{ listas, tarefas }, drive] = await Promise.all([carregarTarefas(api), lerDrive(api)])
  if (drive.falha) throw drive.falha
  const todos = listarProjetos(
    { registros: drive.registros, tasks: tarefas, notes: drive.notas, idProximas: acharLista(listas, LISTA_PROXIMAS)?.id },
    relogioLocal(agora)
  )
  const alvo = situacao === 'todos' ? todos : todos.filter((p) => p.situacao === situacao)
  if (alvo.length === 0) return situacao === 'todos' ? 'Nenhum projeto ainda.' : `Nenhum projeto com situação "${situacao}".`
  return `${alvo.length} projeto${alvo.length === 1 ? '' : 's'}:\n${alvo.map(linhaDoProjeto).join('\n')}`
}

export async function verProjeto(api, agora, { projeto }) {
  const hoje = dataNoFuso(agora)
  const hojeLocal = relogioLocal(agora)
  const [{ listas, tarefas, concluidas }, drive] = await Promise.all([
    carregarTarefas(api, { concluidasDesde: instanteNoFuso(somarDias(hoje, -60)) }),
    lerDrive(api),
  ])
  if (drive.falha) throw drive.falha
  const ids = {
    idProximas: acharLista(listas, LISTA_PROXIMAS)?.id,
    idAguardando: acharLista(listas, LISTA_AGUARDANDO)?.id,
    idAlgumDia: acharLista(listas, LISTA_ALGUM_DIA)?.id,
    idEntrada: acharLista(listas, LISTA_ENTRADA)?.id,
  }
  const todos = listarProjetos({ registros: drive.registros, tasks: tarefas, notes: drive.notas, idProximas: ids.idProximas }, hojeLocal)
  const p = todos.find((x) => x.id === etiqueta(projeto) || etiqueta(x.nome) === etiqueta(projeto))
  if (!p) throw new ErroDeUso(`Não existe projeto "${projeto}". Use listar_projetos para ver os ids.`)

  const eventos = await api.agenda.listAllEvents({
    timeMin: instanteNoFuso(somarDias(hoje, -30)),
    timeMax: instanteNoFuso(somarDias(hoje, 90)),
  })
  const grupos = tarefasDoProjeto([...tarefas, ...juntarConcluidas(concluidas)], p.id, ids, 10)
  const ctx = { listas, hoje, hojeLocal }
  const secao = (titulo, itens, fmt = (t) => linhaDaTarefa(t, ctx)) =>
    itens.length ? `### ${titulo} (${itens.length})\n${listaComLimite(itens, 15, fmt)}` : null

  const ficha = [
    `# ${p.nome} [projeto: ${p.id}]`,
    `${p.tipo === 'rotina' ? 'Rotina (não termina)' : 'Projeto (tem um resultado e termina)'} · situação: ${SITUACOES.find((s) => s.id === p.situacao)?.label || p.situacao}${p.prazo ? ` · prazo ${dataComDia(p.prazo)}` : ''}`,
    `Resultado esperado: ${p.resultado?.trim() || '(ainda não definido)'}`,
    p.implicito ? 'Ainda sem ficha: existe só como etiqueta em tarefas/anotações (atualizar_projeto cria a ficha).' : null,
    p.semProximaAcao ? 'ATENÇÃO: projeto ativo sem nenhuma próxima ação.' : null,
    p.concluidoComPendencias
      ? `ATENÇÃO: marcado como concluído, mas com ${p.pendentes} tarefa(s) pendente(s). Pergunte se é para reabrir (atualizar_projeto com situacao "ativo") ou concluir as tarefas.`
      : null,
    p.marcos?.length ? `Marcos:\n${p.marcos.map((m) => `- ${m.feito ? '[feito] ' : ''}${m.titulo}${m.data ? ` (${dataComDia(m.data)})` : ''}`).join('\n')}` : null,
    p.arquivos?.length ? `Arquivos vinculados:\n${p.arquivos.map((a) => `- ${a.nome}: ${a.url}`).join('\n')}` : null,
  ]
  const notas = drive.notas.filter((n) => n.projeto === p.id)
  const doProjeto = eventos.filter((e) => e.status !== 'cancelled' && eventoDoProjeto(e, p.id))
  const futuros = doProjeto.filter((e) => eventEnd(e) >= agora)
  const passados = doProjeto.filter((e) => eventEnd(e) < agora).reverse()
  const fmtEvento = (e) => linhaDoEvento(e, dataDoEvento(e)).replace(/^- /, `- ${dataComDia(dataDoEvento(e), { ano: false })} `)

  return [
    ...ficha,
    secao('Próximas ações', grupos.proximas),
    secao('Aguardando', grupos.aguardando),
    secao('Na Entrada', grupos.entrada),
    secao('Algum dia', grupos.algumDia),
    secao('Em outras listas', grupos.outras, (t) => linhaDaTarefa(t, { ...ctx, mostrarLista: true })),
    secao('Concluídas nos últimos 60 dias', grupos.concluidas, (t) => `- ${t.title} (concluída ${t.completed ? dataComDia(dataNoFuso(new Date(t.completed)), { ano: false }) : ''})`),
    secao('Anotações', notas, (n) => `- ${n.title?.trim() || '(sem título)'} [nota: ${n.id}] — ${trechoDaAnotacao(n.body, 160)}`),
    secao('Compromissos à frente (90 dias)', futuros, fmtEvento),
    secao('Compromissos recentes (30 dias)', passados, fmtEvento),
  ]
    .filter(Boolean)
    .join('\n')
}

// Grava fichas do jeito que o app grava: normalizadas, e mescladas com o que
// está no Drive agora (por id e última edição), para nunca apagar uma ficha
// que o app criou entre a leitura e a gravação.
async function alterarProjetos(api, alterar) {
  const remotos = normalizarProjetos((await api.drive.loadProjetos()) || [])
  const { lista, resultado } = alterar(remotos)
  await api.drive.saveProjetos(normalizarProjetos(mesclarAnotacoes(lista, remotos, [])))
  return resultado
}

function fichaEmTexto(f) {
  return `${f.nome} [projeto: ${f.id}] · ${f.tipo} · ${f.situacao}${f.prazo ? ` · prazo ${dataComDia(f.prazo)}` : ''}${f.resultado ? ` · resultado: ${f.resultado}` : ''}`
}

export async function criarProjeto(api, agora, { nome, resultado, tipo, prazo, situacao }) {
  return alterarProjetos(api, (atuais) => {
    const novo = novoProjeto(nome, agora)
    if (!novo) throw new ErroDeUso('O nome precisa ter letras ou números (é dele que sai a etiqueta #projeto).')
    if (atuais.some((p) => p.id === novo.id)) {
      throw new ErroDeUso(`Já existe a ficha "${novo.id}". Use atualizar_projeto para mudá-la.`)
    }
    const ficha = normalizarProjeto({ ...novo, resultado: resultado || '', tipo, prazo, situacao }, agora)
    return {
      lista: [ficha, ...atuais],
      resultado: `Projeto criado: ${fichaEmTexto(ficha)}. Tarefas, notas e eventos entram nele pela etiqueta "${ficha.id}".`,
    }
  })
}

export async function atualizarProjeto(api, agora, { projeto, nome, resultado, tipo, prazo, situacao }) {
  return alterarProjetos(api, (atuais) => {
    const atual = acharFicha(atuais, projeto)
    const id = atual?.id || etiqueta(projeto)
    if (!id) throw new ErroDeUso('Informe o id do projeto (veja listar_projetos).')
    // Sem ficha ainda, a etiqueta solta ganha uma agora — o mesmo que salvar
    // a ficha de um projeto implícito na tela.
    const base = atual || { id, nome: projeto, createdAt: agora.toISOString() }
    const ficha = normalizarProjeto(
      {
        ...base,
        ...(nome !== undefined ? { nome } : {}),
        ...(resultado !== undefined ? { resultado } : {}),
        ...(tipo !== undefined ? { tipo } : {}),
        ...(prazo !== undefined ? { prazo } : {}),
        ...(situacao !== undefined ? { situacao } : {}),
        updatedAt: carimboDepois(agora, atual?.updatedAt),
      },
      agora
    )
    return {
      lista: atual ? atuais.map((p) => (p.id === ficha.id ? ficha : p)) : [ficha, ...atuais],
      resultado: `${atual ? 'Ficha atualizada' : 'Ficha criada'}: ${fichaEmTexto(ficha)}.`,
    }
  })
}

// Toda etiqueta usada precisa de ficha, também quando é o Claude quem
// etiqueta: uma tarefa com projeto novo cria a ficha mínima na hora, como o
// app faz ao abrir (ver garantirFichas). Ficha que já existe não é tocada.
async function garantirFicha(api, agora, id) {
  if (!id) return ''
  return alterarProjetos(api, (atuais) => {
    if (atuais.some((p) => p.id === id)) return { lista: atuais, resultado: '' }
    const ficha = fichaParaEtiqueta(id, agora)
    return { lista: [ficha, ...atuais], resultado: ` Projeto novo "${ficha.nome}" [projeto: ${ficha.id}] criado com ficha mínima (atualizar_projeto completa).` }
  })
}

// ---------- anotações ----------

// O carimbo de uma edição feita sobre a versão que acabou de ser lida. A
// mesclagem fica com a versão mais nova, e um empate fica com a do Drive —
// então a edição precisa sair *depois* da que foi lida, mesmo que as duas
// caiam no mesmo milissegundo (ou o relógio do Worker esteja um pouco atrás
// do aparelho que gravou por último).
export function carimboDepois(agora, anterior) {
  const lido = Date.parse(anterior || '')
  return new Date(Math.max(agora.getTime(), Number.isFinite(lido) ? lido + 1 : 0)).toISOString()
}

// Toda gravação é ler → mudar → mesclar com o que está no Drive → gravar,
// com o rastro de exclusões respeitado (mesclarParaGravar, o mesmo que o app
// usa ao gravar). Uma nota que o app escreveu e ainda não estava na leitura
// anterior nunca é apagada por uma gravação daqui.
async function alterarNotas(api, agora, alterar) {
  const remoto = (await api.drive.loadNotes()) || { notes: [], deleted: [] }
  const { notas, resultado } = alterar(sanitizeNotes(remoto.notes))
  const { notes, deleted } = mesclarParaGravar(notas, remoto, [], agora.getTime())
  await api.drive.saveNotes(sanitizeNotes(notes), deleted)
  return resultado
}

// Por palavras e com ranking (ver notasBusca.js, a mesma regra da busca do
// app): a nota mais relevante primeiro, com o trecho que a fez aparecer e as
// notas a que ela liga — muitas vezes a resposta está na vizinha. As notas
// ligadas aos primeiros resultados que a busca não trouxe vêm no fim, como
// pista de onde mais ler.
export async function buscarNotas(api, agora, { texto, projeto, limite = 10 }) {
  const remoto = await api.drive.loadNotes()
  const todas = sanitizeNotes(remoto?.notes)
  const notas = projeto ? todas.filter((n) => n.projeto === etiqueta(projeto)) : todas
  const achadas = buscarNasNotas(notas, texto)
  if (achadas.length === 0) {
    return `Nenhuma anotação com as palavras "${texto}"${projeto ? ` no projeto ${etiqueta(projeto)}` : ''}. Tente sinônimos, a sigla por extenso (ou o contrário) ou menos palavras.`
  }
  const mostradas = achadas.slice(0, limite)
  const linhas = mostradas.map(({ nota: n }) => {
    const { ligaA } = ligacoesDaNota(n, todas)
    const ligadas = ligaA.filter((l) => l.nota).map((l) => `[[${tituloDaNota(l.nota)}]]`)
    const trecho = trechoDaBusca(n.body, texto, 200) || trechoDaAnotacao(n.body, 200)
    return [
      `- ${tituloDaNota(n)} [nota: ${n.id}] · editada ${dataComDia(dataNoFuso(new Date(n.updatedAt)), { ano: false })}${n.projeto ? ` · #${n.projeto}` : ''}`,
      trecho ? `  ${trecho}` : null,
      ligadas.length ? `  liga a: ${ligadas.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n')
  })

  const jaMostradas = new Set(mostradas.map((r) => r.nota.id))
  const vizinhas = []
  for (const { nota } of mostradas.slice(0, 3)) {
    const { ligaA, citadaPor } = ligacoesDaNota(nota, todas)
    for (const vizinha of [...ligaA.map((l) => l.nota).filter(Boolean), ...citadaPor]) {
      if (jaMostradas.has(vizinha.id) || vizinhas.some((v) => v.id === vizinha.id)) continue
      vizinhas.push(vizinha)
    }
  }

  const cabecalho = `${achadas.length} anotaç${achadas.length === 1 ? 'ão' : 'ões'} com as palavras "${texto}", da mais relevante para a menos${
    achadas.length > mostradas.length ? ` (mostrando ${mostradas.length})` : ''
  }. Use ler_nota com o id para o texto inteiro.`
  return [
    cabecalho,
    linhas.join('\n'),
    vizinhas.length
      ? `Ligadas a esses resultados (podem ter o resto da resposta):\n${vizinhas
          .slice(0, 5)
          .map((v) => `- ${tituloDaNota(v)} [nota: ${v.id}]`)
          .join('\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function fonteEmTexto(f) {
  const extra = [f.autor, f.data && dataComDia(f.data)].filter(Boolean).join(', ')
  return `${f.titulo}${extra ? ` (${extra})` : ''}${f.url ? ` — ${f.url}` : ''}`
}

export async function lerNota(api, agora, { id }) {
  const remoto = await api.drive.loadNotes()
  const notas = sanitizeNotes(remoto?.notes)
  const nota = notas.find((n) => n.id === id)
  if (!nota) throw new ErroDeUso(`Não existe anotação com id "${id}". Use buscar_notas para achar o id.`)
  const { ligaA, citadaPor } = ligacoesDaNota(nota, notas)
  return [
    `# ${tituloDaNota(nota)} [nota: ${nota.id}]`,
    `Criada ${dataComDia(dataNoFuso(new Date(nota.createdAt)))} · editada ${dataComDia(dataNoFuso(new Date(nota.updatedAt)))} ${horaNoFuso(new Date(nota.updatedAt))}${nota.projeto ? ` · projeto #${nota.projeto}` : ''}`,
    '',
    nota.body || '(sem texto)',
    '',
    nota.fontes?.length ? `Fontes:\n${nota.fontes.map((f) => `- ${fonteEmTexto(f)}`).join('\n')}` : null,
    nota.anexos?.length ? `Arquivos anexados:\n${nota.anexos.map((a) => linhaDoArquivo(a)).join('\n')}` : null,
    ligaA.length
      ? `Liga a:\n${ligaA.map((l) => (l.nota ? `- ${tituloDaNota(l.nota)} [nota: ${l.nota.id}]` : `- ${l.titulo} (ainda não existe)`)).join('\n')}`
      : null,
    citadaPor.length ? `Citada por:\n${citadaPor.map((n) => `- ${tituloDaNota(n)} [nota: ${n.id}]`).join('\n')}` : null,
  ]
    .filter((x) => x !== null)
    .join('\n')
    .trimEnd()
}

export async function criarNota(api, agora, { titulo, texto, projeto, fontes }) {
  return alterarNotas(api, agora, (atuais) => {
    const iso = agora.toISOString()
    const nota = { ...newNote(), title: titulo || '', body: texto, createdAt: iso, updatedAt: iso }
    if (projeto) nota.projeto = etiqueta(projeto)
    if (fontes?.length) nota.fontes = juntarFontes(fontes)
    return {
      notas: [nota, ...atuais],
      resultado: `Anotação criada: ${nota.title || '(sem título)'} [nota: ${nota.id}]${nota.projeto ? ` no projeto #${nota.projeto}` : ''}.`,
    }
  })
}

export async function atualizarNota(api, agora, { id, titulo, texto, modo = 'acrescentar', projeto, fontes }) {
  return alterarNotas(api, agora, (atuais) => {
    const atual = atuais.find((n) => n.id === id)
    if (!atual) throw new ErroDeUso(`Não existe anotação com id "${id}". Use buscar_notas para achar o id.`)
    const nova = { ...atual, updatedAt: carimboDepois(agora, atual.updatedAt) }
    if (titulo !== undefined) nova.title = titulo
    if (texto !== undefined) {
      // "Acrescentar" é o jeito de ir somando a uma nota sem reescrevê-la: o
      // que já estava fica intacto, e o novo entra no fim, depois de uma linha
      // em branco.
      nova.body = modo === 'substituir' || !atual.body.trim() ? texto : `${atual.body.replace(/\s+$/, '')}\n\n${texto}`
    }
    if (projeto !== undefined) {
      if (projeto) nova.projeto = etiqueta(projeto)
      else delete nova.projeto
    }
    // Fonte nova soma às que a nota já tinha; nenhuma some por aqui.
    if (fontes?.length) nova.fontes = juntarFontes(atual.fontes || [], fontes)
    // Título novo leva junto os [[links]] das outras notas, na mesma gravação
    // (a mesma regra do app, ver renomearLinks).
    const renomeadas = renomearLinks(
      atuais.map((n) => (n.id === id ? nova : n)),
      id,
      // Nota vazia ainda não tinha título (ver tituloQueLiga em Notes.jsx).
      notaVazia(atual) ? '' : tituloDaNota(atual),
      carimboDepois(agora, nova.updatedAt)
    )
    const outras = renomeadas.alteradas.filter((n) => n.id !== id).length
    return {
      notas: renomeadas.notas,
      resultado: `Anotação atualizada: ${nova.title || '(sem título)'} [nota: ${id}]${texto !== undefined ? (modo === 'substituir' ? ' (texto substituído)' : ' (texto acrescentado ao fim)') : ''}${
        outras ? `. Links atualizados para o título novo em ${outras} nota${outras === 1 ? '' : 's'}` : ''
      }.`,
    }
  })
}

// ---------- base de conhecimento ----------

// O "save" do claude-obsidian: uma resposta que valeu a pena (montada a
// partir das notas) vira nota, ligada às notas de onde saiu. Os links são
// montados aqui, a partir dos ids, para não depender de o modelo acertar o
// título exato de cada uma. Se já existe nota com o mesmo título, a resposta
// é somada a ela, com a data — a base engrossa em vez de se repetir.
export async function guardarResposta(api, agora, { titulo, resposta, baseada_em: baseadaEm = [], projeto }) {
  return alterarNotas(api, agora, (atuais) => {
    const origens = [...new Set(baseadaEm)].map((idOrigem) => {
      const origem = atuais.find((n) => n.id === idOrigem)
      if (!origem) throw new ErroDeUso(`Não existe anotação com id "${idOrigem}". Use os ids que buscar_notas devolveu.`)
      return origem
    })
    const rodape = origens.length ? `\n\nBaseada em: ${origens.map((o) => `[[${tituloDaNota(o)}]]`).join(', ')}` : ''
    const texto = `${resposta.trim()}${rodape}`
    const existente = indiceDeTitulos(atuais).get(chaveDeTitulo(titulo))
    if (existente) {
      const somada = {
        ...existente,
        body: `${existente.body.replace(/\s+$/, '')}\n\n${dataComDia(dataNoFuso(agora))}:\n${texto}`,
        updatedAt: carimboDepois(agora, existente.updatedAt),
      }
      return {
        notas: atuais.map((n) => (n.id === existente.id ? somada : n)),
        resultado: `Resposta somada à anotação que já existia: ${tituloDaNota(somada)} [nota: ${somada.id}].`,
      }
    }
    const iso = agora.toISOString()
    const nota = { ...newNote(), title: titulo, body: texto, createdAt: iso, updatedAt: iso }
    if (projeto) nota.projeto = etiqueta(projeto)
    return {
      notas: [nota, ...atuais],
      resultado: `Resposta guardada: ${titulo} [nota: ${nota.id}]${origens.length ? `, ligada a ${origens.length} nota${origens.length === 1 ? '' : 's'}` : ''}.`,
    }
  })
}

// O "ingest" do claude-obsidian, pela conversa: o Claude leu um material (um
// PDF anexado, um artigo, uma transcrição) e entrega o resumo e as ideias já
// separadas. Aqui isso vira, numa gravação só, uma nota da fonte e uma nota
// por ideia, ligadas entre si por [[título]] e com a fonte registrada em cada
// uma. Uma ideia que já tem nota com o mesmo título é somada a ela (no fim,
// com a fonte junto), em vez de virar uma segunda nota igual — é assim que a
// base engrossa em vez de se repetir.
export async function importarFonte(api, agora, { fonte, resumo, notas: ideias, projeto }) {
  return alterarNotas(api, agora, (atuais) => {
    const [fonteLimpa] = juntarFontes([fonte])
    if (!fonteLimpa) throw new ErroDeUso('A fonte precisa de um título.')
    const id = projeto ? etiqueta(projeto) : null
    const iso = agora.toISOString()
    const lista = [...atuais]
    const indice = indiceDeTitulos(lista)
    const criadas = []
    const somadas = []
    const titulosUsados = new Set()

    function gravar(titulo, texto) {
      const chave = chaveDeTitulo(titulo)
      const existente = indice.get(chave)
      if (existente) {
        const i = lista.findIndex((n) => n.id === existente.id)
        const atualizada = {
          ...existente,
          body: existente.body.trim() ? `${existente.body.replace(/\s+$/, '')}\n\n${texto}` : texto,
          fontes: juntarFontes(existente.fontes || [], [fonteLimpa]),
          updatedAt: carimboDepois(agora, existente.updatedAt),
        }
        if (id && !existente.projeto) atualizada.projeto = id
        lista[i] = atualizada
        indice.set(chave, atualizada)
        somadas.push(atualizada)
        return
      }
      const nova = { ...newNote(), title: titulo, body: texto, createdAt: iso, updatedAt: iso, fontes: [fonteLimpa] }
      if (id) nova.projeto = id
      lista.unshift(nova)
      indice.set(chave, nova)
      criadas.push(nova)
    }

    const tituloDaFonte = fonteLimpa.titulo
    const ideiasValidas = ideias.filter((n) => {
      const chave = chaveDeTitulo(n.titulo)
      if (!chave || chave === chaveDeTitulo(tituloDaFonte) || titulosUsados.has(chave)) return false
      titulosUsados.add(chave)
      return true
    })
    const indiceDeIdeias = ideiasValidas.map((n) => `- [[${n.titulo.trim()}]]`).join('\n')
    gravar(tituloDaFonte, `${resumo.trim()}${indiceDeIdeias ? `\n\nNotas tiradas desta fonte:\n${indiceDeIdeias}` : ''}`)
    for (const ideia of ideiasValidas) {
      const texto = ideia.texto.trim()
      // Toda ideia aponta de volta para a fonte, para "de onde veio isto?" ter
      // resposta com um toque.
      const comFonte = texto.includes(`[[${tituloDaFonte}]]`) ? texto : `${texto}\n\nFonte: [[${tituloDaFonte}]]`
      gravar(ideia.titulo.trim(), comFonte)
    }

    const linha = (n) => `- ${tituloDaNota(n)} [nota: ${n.id}]`
    return {
      notas: lista,
      resultado: [
        `Fonte "${tituloDaFonte}" guardada${id ? ` no projeto #${id}` : ''}.`,
        criadas.length ? `Notas criadas (${criadas.length}):\n${criadas.map(linha).join('\n')}` : null,
        somadas.length ? `Notas que já existiam e receberam o conteúdo novo no fim (${somadas.length}):\n${somadas.map(linha).join('\n')}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    }
  })
}

const MAX_ITENS_DA_SAUDE = 15

export async function saudeDasNotasTexto(api) {
  const remoto = await api.drive.loadNotes()
  const notas = sanitizeNotes(remoto?.notes)
  if (notas.length === 0) return 'Ainda não há anotações.'
  const s = saudeDasNotas(notas)
  const nome = (n) => `${tituloDaNota(n)} [nota: ${n.id}]`
  const secoes = [`Revisão de ${notas.length} anotaç${notas.length === 1 ? 'ão' : 'ões'}:`]
  const secao = (titulo, itens, fmt) =>
    secoes.push(`## ${titulo}: ${itens.length}${itens.length ? `\n${listaComLimite(itens, MAX_ITENS_DA_SAUDE, fmt)}` : ''}`)
  secao('Links para notas que não existem', s.linksQuebrados, (x) => `- em ${nome(x.nota)}: [[${x.alvo}]]`)
  secao('Notas soltas (sem links, sem quem cite e fora de projeto)', s.soltas, (n) => `- ${nome(n)}`)
  secao('Títulos repetidos (o link vai para a editada por último)', s.duplicadas, (g) => `- "${tituloDaNota(g[0])}": ${g.map((n) => `[nota: ${n.id}]`).join(', ')}`)
  secao('Notas vazias', s.vazias, (n) => `- [nota: ${n.id}]`)
  const tudoCerto = !s.linksQuebrados.length && !s.soltas.length && !s.duplicadas.length && !s.vazias.length
  if (tudoCerto) secoes.push('Tudo ligado e sem pendências.')
  return secoes.join('\n\n')
}

// ---------- escrita de tarefas ----------

function prazoParaGoogle(dataIso) {
  // O Google Tasks guarda só a data do prazo, e a lê da forma UTC: meia-noite
  // UTC daquela data é exatamente o que o app grava e lê (dateOnlyFromISO).
  return dataIso ? new Date(`${dataIso}T00:00:00.000Z`) : null
}

async function acharTarefa(api, id) {
  const [listas, todas] = await Promise.all([api.tarefas.listTaskLists(), api.tarefas.listAllTasks({ showCompleted: true })])
  const tarefa = todas.find((t) => t.id === id)
  if (!tarefa) throw new ErroDeUso(`Não existe tarefa com id "${id}". Use listar_tarefas ou visao_geral para ver os ids.`)
  return { tarefa, listas }
}

async function listaDestino(api, listas, chave) {
  // garantirLista acha pelo nome (sem acento, sem caixa) e só cria se não
  // existir — nunca uma "Proximas ações" ao lado da "Próximas ações".
  return api.tarefas.garantirLista(listas, LISTAS[chave])
}

export async function capturar(api, agora, { texto }) {
  const listas = await api.tarefas.listTaskLists()
  const entrada = await listaDestino(api, listas, 'entrada')
  const criada = await api.tarefas.createTask({ title: texto.trim(), tasklistId: entrada.id })
  return `Guardado na Entrada: "${texto.trim()}" [id: ${criada?.id}]. Fica lá até ser esclarecido (atualizar_tarefa com uma lista de destino).`
}

export async function criarTarefa(api, agora, { titulo, lista = 'proximas', contexto, projeto, prazo, prioridade, duracao_min, aguardando_quem, notas }) {
  if (lista === 'aguardando' && !aguardando_quem) {
    throw new ErroDeUso('Para a lista Aguardando, informe aguardando_quem (de quem se está esperando).')
  }
  const listas = await api.tarefas.listTaskLists()
  const destino = await listaDestino(api, listas, lista)
  const criada = await api.tarefas.createTask({
    title: titulo.trim(),
    priority: prioridade,
    due: prazoParaGoogle(prazo),
    notes: notas || '',
    contexto: contexto || null,
    projeto: projeto ? etiqueta(projeto) : null,
    // A data de hoje é o "desde quando" da espera, como na tela de
    // esclarecer: é ela que permite dizer "parado há 12 dias" depois.
    aguardando: aguardando_quem ? { quem: aguardando_quem, desde: dataNoFuso(agora) } : null,
    duracao: duracao_min || null,
    tasklistId: destino.id,
  })
  const fichaNova = projeto ? await garantirFicha(api, agora, etiqueta(projeto)) : ''
  return `Tarefa criada em ${LISTAS[lista]}: "${titulo.trim()}" [id: ${criada?.id}].${fichaNova}`
}

export async function atualizarTarefa(api, agora, args) {
  const { id, lista } = args
  const { tarefa, listas } = await acharTarefa(api, id)
  const patch = {}
  if (args.titulo !== undefined) patch.title = args.titulo.trim()
  if (args.prazo !== undefined) patch.due = prazoParaGoogle(args.prazo)
  if (args.prioridade !== undefined) patch.priority = args.prioridade
  if (args.contexto !== undefined) patch.contexto = args.contexto || null
  if (args.projeto !== undefined) patch.projeto = args.projeto ? etiqueta(args.projeto) : null
  if (args.duracao_min !== undefined) patch.duracao = args.duracao_min || null
  if (args.notas !== undefined) patch.notes = args.notas
  if (args.aguardando_quem !== undefined) {
    patch.aguardando = args.aguardando_quem
      ? { quem: args.aguardando_quem, desde: tarefa.aguardando?.desde || dataNoFuso(agora) }
      : null
  }

  const chaveAtual = chaveDaLista(tarefa, listas)
  const vaiPara = lista && lista !== chaveAtual ? lista : null
  if (vaiPara === 'aguardando' && !patch.aguardando && !tarefa.aguardando?.quem) {
    throw new ErroDeUso('Para mover para Aguardando, informe aguardando_quem (de quem se está esperando).')
  }
  if (vaiPara === 'aguardando' && args.aguardando_quem === undefined && tarefa.aguardando?.quem) {
    patch.aguardando = { ...tarefa.aguardando, desde: dataNoFuso(agora) }
  }
  // Sair de Aguardando encerra a espera — o mesmo que "reativar" faz na tela;
  // senão a tarefa levaria um "~ana" velho para Próximas ações.
  if (vaiPara && vaiPara !== 'aguardando' && args.aguardando_quem === undefined && tarefa.aguardando) {
    patch.aguardando = null
  }

  if (!vaiPara && Object.keys(patch).length === 0) return 'Nada para mudar: informe pelo menos um campo.'
  const fichaNova = patch.projeto ? await garantirFicha(api, agora, patch.projeto) : ''
  if (vaiPara) {
    const destino = await listaDestino(api, listas, vaiPara)
    // moverTarefa é o mesmo do app: usa o endpoint de mover quando a conta
    // aceita e, se não, cria no destino antes de apagar na origem (o id muda).
    const movida = await api.tarefas.moverTarefa(tarefa, destino.id, patch)
    const novoId = movida?.id && movida.id !== tarefa.id ? ` O id mudou para ${movida.id}.` : ''
    return `Tarefa movida de ${rotuloDaLista(tarefa, listas)} para ${LISTAS[vaiPara]}: "${patch.title || tarefa.title}".${novoId}${fichaNova}`
  }
  await api.tarefas.updateTask(tarefa, patch)
  return `Tarefa atualizada: "${patch.title || tarefa.title}" [id: ${tarefa.id}].${fichaNova}`
}

export async function concluirTarefa(api, agora, { id }) {
  const { tarefa, listas } = await acharTarefa(api, id)
  if (tarefa.status === 'completed') return `"${tarefa.title}" já estava concluída.`
  await api.tarefas.completeTask(tarefa.id, tarefa.tasklistId)
  // O app registra cada conclusão na agenda (histórico, sem ocupar tempo).
  // Se o registro falhar, a tarefa continua concluída — só se avisa.
  try {
    await api.agenda.createEvent(montarEventoDeConclusao({ ...tarefa, tasklistTitle: rotuloDaLista(tarefa, listas) }, agora))
    return `Concluída: "${tarefa.title}" (registrada na agenda).`
  } catch {
    return `Concluída: "${tarefa.title}". O registro da conclusão na agenda não pôde ser gravado.`
  }
}

// ---------- criar_evento ----------

function acharAgenda(calendarios, nome) {
  const alvo = semAcento(nome).trim()
  return (
    calendarios.find((c) => c.id === nome) ||
    calendarios.find((c) => semAcento(c.summaryOverride || c.summary || '').trim() === alvo) ||
    calendarios.find((c) => semAcento(c.summaryOverride || c.summary || '').includes(alvo)) ||
    null
  )
}

export async function criarEvento(api, agora, args) {
  const { titulo, data, inicio, fim, duracao_min, dia_inteiro, data_fim, local, descricao, agenda: nomeDaAgenda, projeto } = args
  const calendarios = await api.agenda.listCalendars()
  const gravaveis = calendarios.filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
  let calendario = gravaveis.find((c) => c.primary) || gravaveis[0] || { id: 'primary', summary: 'principal' }
  if (nomeDaAgenda) {
    calendario = acharAgenda(gravaveis, nomeDaAgenda)
    if (!calendario) {
      throw new ErroDeUso(`Não achei uma agenda gravável chamada "${nomeDaAgenda}". Agendas disponíveis: ${gravaveis.map((c) => c.summaryOverride || c.summary).join(', ')}.`)
    }
  }

  let start
  let end
  const allDay = Boolean(dia_inteiro) || !inicio
  if (allDay) {
    const ultimo = data_fim || data
    if (ultimo < data) throw new ErroDeUso('data_fim não pode ser antes de data.')
    // createEvent lê o dia de start/end pelo relógio local (toDateInput), e
    // soma o dia exclusivo do Google sozinho.
    const [a, m, d] = data.split('-').map(Number)
    const [a2, m2, d2] = ultimo.split('-').map(Number)
    start = new Date(a, m - 1, d)
    end = new Date(a2, m2 - 1, d2)
  } else {
    start = instanteNoFuso(data, inicio)
    if (fim) end = instanteNoFuso(data, fim)
    else end = new Date(start.getTime() + (duracao_min || 60) * 60000)
    if (end <= start) throw new ErroDeUso('O fim precisa ser depois do início.')
  }

  const id = projeto ? etiqueta(projeto) : null
  const criado = await api.agenda.createEvent({
    title: titulo.trim(),
    start,
    end,
    allDay,
    description: descricao,
    location: local,
    calendarId: calendario.id,
    // A mesma marca privada que o editor do app grava para ligar o evento ao
    // projeto (PROJETO_PROP em projetos.js).
    ...(id ? { extendedProperties: { private: { [PROJETO_PROP]: id } } } : {}),
  })
  const quando = allDay
    ? `${dataComDia(data)}${data_fim && data_fim !== data ? ` a ${dataComDia(data_fim)}` : ''}, dia inteiro`
    : `${dataComDia(data)}, ${horaNoFuso(start)}–${horaNoFuso(end)}`
  return `Compromisso criado: "${titulo.trim()}" — ${quando} — na agenda ${calendario.summaryOverride || calendario.summary || 'principal'}${id ? `, ligado ao projeto #${id}` : ''}.${criado?.htmlLink ? ` Link: ${criado.htmlLink}` : ''}`
}

// ---------- arquivos ----------

function linhaDoArquivo(a, onde = '') {
  const { rotulo } = tipoDoArquivo(a)
  const extra = [rotulo, Number.isFinite(a.tamanho) && tamanhoLegivel(a.tamanho), a.adicionadoEm && `adicionado ${dataComDia(dataNoFuso(new Date(a.adicionadoEm)), { ano: false })}`]
    .filter(Boolean)
    .join(' · ')
  return `- ${a.nome}${onde} · ${extra} — ${a.url}`
}

// A pasta do projeto no Drive, a mesma regra do app (pastaDoProjeto): a que a
// ficha já tem, se ainda existir; senão, uma nova, guardada na ficha.
async function pastaPara(api, agora, projetoId, semProjeto) {
  const fichas = normalizarProjetos((await api.drive.loadProjetos()) || [])
  const ficha = projetoId ? fichas.find((p) => p.id === projetoId) : null
  const alvo = ficha || (projetoId ? fichaParaEtiqueta(projetoId, agora) : { id: '_avulsos', nome: semProjeto })
  const { pasta, nova } = await api.pastas.pastaDoProjeto(alvo)
  if (projetoId && (nova || ficha?.pasta?.id !== pasta.id)) {
    await alterarProjetos(api, (atuais) => {
      const atual = atuais.find((p) => p.id === projetoId) || fichaParaEtiqueta(projetoId, agora)
      const nova = normalizarProjeto({ ...atual, pasta, updatedAt: carimboDepois(agora, atual.updatedAt) }, agora)
      return { lista: atuais.some((p) => p.id === projetoId) ? atuais.map((p) => (p.id === projetoId ? nova : p)) : [nova, ...atuais], resultado: null }
    })
  }
  return pasta
}

export async function listarArquivosProjeto(api, agora, { projeto }) {
  const [{ tarefas }, drive] = await Promise.all([carregarTarefas(api), lerDrive(api)])
  if (drive.falha) throw drive.falha
  const id = acharFicha(drive.registros, projeto)?.id || etiqueta(projeto)
  const ficha = drive.registros.find((p) => p.id === id)
  const nasNotas = drive.notas.filter((n) => n.projeto === id && n.anexos?.length)
  const nasTarefas = tarefas.filter((t) => t.projeto === id).map((t) => ({ t, anexos: separarAnexos(t.notesClean).anexos })).filter((x) => x.anexos.length)
  if (!ficha && !nasNotas.length && !nasTarefas.length) {
    throw new ErroDeUso(`Não existe projeto "${projeto}". Use listar_projetos para ver os ids.`)
  }
  const doProjeto = ficha?.arquivos || []
  const partes = [
    `# Arquivos de ${ficha?.nome || id} [projeto: ${id}]`,
    ficha?.pasta ? `Pasta no Drive: ${ficha.pasta.url}` : 'Ainda sem pasta no Drive (é criada no primeiro arquivo).',
    doProjeto.length ? `## Do projeto (${doProjeto.length})\n${doProjeto.map((a) => linhaDoArquivo(a)).join('\n')}` : '## Do projeto\nNenhum arquivo.',
    nasNotas.length
      ? `## Em anotações do projeto\n${nasNotas.flatMap((n) => n.anexos.map((a) => linhaDoArquivo(a, ` (na nota "${tituloDaNota(n)}" [nota: ${n.id}])`))).join('\n')}`
      : null,
    nasTarefas.length
      ? `## Em tarefas do projeto\n${nasTarefas.flatMap(({ t, anexos }) => anexos.map((a) => `- ${a.nome} (na tarefa "${t.title}" [id: ${t.id}]) — ${a.url}`)).join('\n')}`
      : null,
  ]
  return partes.filter(Boolean).join('\n')
}

// Anexar pelo conector: um link (de qualquer lugar) ou um texto que vira
// Documento do Google na pasta do projeto. Arquivo binário (um PDF que a
// pessoa mandou no chat) não tem como chegar aqui — ferramenta recebe texto —,
// e a descrição da ferramenta diz isso ao Claude.
export async function anexarArquivo(api, agora, { projeto, tarefa_id: tarefaId, nota_id: notaId, link, nome, texto }) {
  const alvos = [projeto, tarefaId, notaId].filter(Boolean)
  if (alvos.length !== 1) throw new ErroDeUso('Informe um destino só: projeto, tarefa_id ou nota_id.')
  if (Boolean(link) === Boolean(texto)) throw new ErroDeUso('Informe link (para vincular) ou texto (para criar um Documento do Google), um dos dois.')
  if (texto && !nome) throw new ErroDeUso('Para criar o documento, informe o nome dele.')

  // Onde o arquivo mora no Drive depende do projeto do destino.
  let tarefa = null
  let projetoId = projeto ? acharFicha(normalizarProjetos((await api.drive.loadProjetos()) || []), projeto)?.id || etiqueta(projeto) : null
  if (tarefaId) {
    tarefa = (await acharTarefa(api, tarefaId)).tarefa
    projetoId = tarefa.projeto || null
  }
  if (notaId) {
    const nota = sanitizeNotes((await api.drive.loadNotes())?.notes).find((n) => n.id === notaId)
    if (!nota) throw new ErroDeUso(`Não existe anotação com id "${notaId}". Use buscar_notas para achar o id.`)
    projetoId = nota.projeto || null
  }

  let arquivo
  if (texto) {
    const pasta = await pastaPara(api, agora, projetoId, notaId ? 'Anotações' : 'Sem projeto')
    arquivo = arquivoDoDrive(await api.pastas.criarDocumentoComTexto(pasta.id, nome.trim(), texto), agora)
  } else {
    const doLink = anexoDoLink(nome, link)
    if (!doLink) throw new ErroDeUso('O link precisa ser um endereço http(s).')
    arquivo = { ...doLink, adicionadoEm: agora.toISOString() }
  }
  const comoFicou = texto ? `Documento "${arquivo.nome}" criado no Drive e anexado` : `Link "${arquivo.nome}" anexado`

  if (projeto) {
    await alterarProjetos(api, (atuais) => {
      const atual = atuais.find((p) => p.id === projetoId) || fichaParaEtiqueta(projetoId, agora)
      const ficha = normalizarProjeto({ ...atual, arquivos: juntarArquivos(atual.arquivos, [arquivo]), updatedAt: carimboDepois(agora, atual.updatedAt) }, agora)
      return { lista: atuais.some((p) => p.id === projetoId) ? atuais.map((p) => (p.id === projetoId ? ficha : p)) : [ficha, ...atuais], resultado: null }
    })
    return `${comoFicou} ao projeto #${projetoId}: ${arquivo.url}`
  }
  if (tarefa) {
    const { texto: corpo, anexos } = separarAnexos(tarefa.notesClean)
    await api.tarefas.updateTask(tarefa, { notes: juntarAnexos(corpo, [...anexos, arquivo]) })
    return `${comoFicou} à tarefa "${tarefa.title}": ${arquivo.url}`
  }
  return alterarNotas(api, agora, (atuais) => {
    const nota = atuais.find((n) => n.id === notaId)
    const nova = { ...nota, anexos: juntarArquivos(nota.anexos, [arquivo]), updatedAt: carimboDepois(agora, nota.updatedAt) }
    return { notas: atuais.map((n) => (n.id === notaId ? nova : n)), resultado: `${comoFicou} à nota "${tituloDaNota(nota)}": ${arquivo.url}` }
  })
}

// O mesmo que escolher um modelo ao criar o projeto no app (aplicarModelo):
// ficha com resultado e marcos, as primeiras próximas ações, a anotação-base
// e a pasta no Drive.
export async function criarProjetoDeModelo(api, agora, { modelo, nome }) {
  const pronto = aplicarModelo(modelo, nome, agora)
  if (!pronto) {
    throw new ErroDeUso(`Modelo ou nome inválido. Modelos: ${MODELOS.map((m) => `${m.id} (${m.rotulo})`).join(', ')}. O nome precisa ter letras ou números.`)
  }
  const { ficha, tarefas, nota } = pronto
  await alterarProjetos(api, (atuais) => {
    const existente = atuais.find((p) => p.id === ficha.id)
    if (existente) throw new ErroDeUso(`Já existe o projeto "${existente.nome}" [projeto: ${existente.id}]. Escolha outro nome ou use atualizar_projeto.`)
    return { lista: [ficha, ...atuais], resultado: null }
  })

  const listas = await api.tarefas.listTaskLists()
  const proximas = await listaDestino(api, listas, 'proximas')
  const criadas = []
  for (const t of tarefas) {
    const c = await api.tarefas.createTask({ title: t.title, priority: t.priority, projeto: ficha.id, tasklistId: proximas.id })
    criadas.push(`- ${t.title} [id: ${c?.id}]`)
  }
  let notaCriada = null
  if (nota) {
    notaCriada = await alterarNotas(api, agora, (atuais) => {
      const iso = agora.toISOString()
      const n = { ...newNote(), title: nota.title, body: nota.body, projeto: ficha.id, createdAt: iso, updatedAt: iso }
      return { notas: [n, ...atuais], resultado: `${n.title} [nota: ${n.id}]` }
    })
  }
  let pasta = null
  try {
    pasta = await pastaPara(api, agora, ficha.id)
  } catch {
    // Sem a permissão dos arquivos do Drive, o resto do modelo vale igual:
    // a pasta nasce no primeiro arquivo enviado pelo app.
  }

  return [
    `Projeto criado pelo modelo "${MODELOS.find((m) => m.id === modelo).rotulo}": ${fichaEmTexto(ficha)}.`,
    `Próximas ações:\n${criadas.join('\n')}`,
    `Marcos: ${ficha.marcos.map((m) => m.titulo).join(' → ')}.`,
    notaCriada ? `Anotação-base: ${notaCriada}.` : null,
    pasta ? `Pasta no Drive: ${pasta.url}` : 'A pasta no Drive será criada no primeiro arquivo enviado pelo app.',
  ]
    .filter(Boolean)
    .join('\n')
}
