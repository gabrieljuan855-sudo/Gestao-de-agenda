import { PROJETO_PROP } from './projetos.js'
import { ensureToken, refreshAfterUnauthorized } from './googleAuth.js'
import { toDateInput, addDays } from './dates.js'
import { PRESENCE_PROP, TO_RSVP } from './calendarPrefs.js'
import { semAcento } from './texto.js'
import { FOCUS_TASK_PROP } from './focusStats.js'
import { criarApiDeTarefas } from './googleTarefas.js'
import { criarApiDaAgenda, MAX_PAGINAS } from './googleAgenda.js'
import { isAllDay } from './events.js'
import { encerrarAntes } from './recorrencia.js'
import { criarDriveDosProjetos, CAMPOS_DO_ARQUIVO } from './drivePastas.js'
import { inicioOriginal, ehPrimeiraDaSerie, horarioDaSerie, restanteDaContagem, corpoDaContinuacao } from './serieRecorrente.js'

const CAL_BASE = 'https://www.googleapis.com/calendar/v3'

// Exportado para outras libs que também falam com APIs do Google
// autenticadas (hoje, driveNotes.js) reaproveitarem a renovação de token em
// 401 e o tratamento de erro, em vez de duplicar tudo isso.
export async function request(url, options = {}, { retryOnAuth = true } = {}) {
  const token = await ensureToken()
  if (!token) throw new Error('Sem token de acesso. Faça login primeiro.')

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  // O Google recusou um token que o nosso relógio dava como bom. Renova e
  // repete uma vez: sem isso a tela ficava vazia, sem erro nenhum à vista.
  if (res.status === 401 && retryOnAuth) {
    const fresh = await refreshAfterUnauthorized(token)
    if (fresh) return request(url, options, { retryOnAuth: false })
  }

  if (!res.ok) {
    const body = await res.text()
    const err = new Error(`Erro na API do Google (${res.status}): ${body}`)
    // Quem chama precisa distinguir "deu ruim agora" (tenta de novo) de
    // "falta permissão" (só um login novo resolve) — e isso não dá para ler
    // de um texto de mensagem sem virar adivinhação.
    err.status = res.status
    err.body = body
    throw err
  }
  if (res.status === 204) return null
  return res.json()
}

// ---------- Calendar ----------

export const { listCalendars, listEvents, listAcrossCalendars, listAllEvents, createEvent } = criarApiDaAgenda(request)

// A busca não fica presa ao período que a tela está mostrando: cobre de 6
// meses atrás a 1 ano à frente, o bastante pra achar tanto um compromisso já
// realizado quanto um marcado com bastante antecedência.
const SEARCH_PAST_DAYS = 180
const SEARCH_FUTURE_DAYS = 365

// Uma reunião semanal vira dezenas de instâncias dentro do período buscado,
// todas com o mesmo título. Numa busca isso é só ruído: guarda uma por série
// e conta as outras. Como a lista já chega ordenada (futuro crescente, depois
// passado decrescente), a primeira de cada série é exatamente a que interessa
// — a próxima que ainda vai acontecer, ou a última que houve.
function collapseRecurring(events) {
  const bySeries = new Map()
  const out = []
  for (const event of events) {
    const series = event.recurringEventId
    if (!series) {
      out.push(event)
      continue
    }
    const kept = bySeries.get(series)
    if (kept) {
      kept.repeatCount += 1
      continue
    }
    const entry = { ...event, repeatCount: 1 }
    bySeries.set(series, entry)
    out.push(entry)
  }
  return out
}

// Os compromissos do período de busca ficam guardados aqui entre uma digitação
// e outra: buscar passa a filtrar essa lista em vez de perguntar ao Google a
// cada tecla.
let cacheDaBusca = null
const VALIDADE_DO_CACHE_MS = 10 * 60 * 1000

function periodoDaBusca() {
  const agora = new Date()
  return { timeMin: addDays(agora, -SEARCH_PAST_DAYS), timeMax: addDays(agora, SEARCH_FUTURE_DAYS) }
}

// Carrega (e guarda) os compromissos do período. Exportada para o painel pedir
// assim que abre: quando o usuário termina de digitar as duas primeiras
// letras, a lista normalmente já chegou.
export async function prefetchEventosDaBusca() {
  if (cacheDaBusca && Date.now() - cacheDaBusca.carregadoEm < VALIDADE_DO_CACHE_MS) {
    return cacheDaBusca.eventos
  }
  if (cacheDaBusca?.carregando) return cacheDaBusca.carregando

  const carregando = (async () => {
    const calendars = await listCalendars()
    const eventos = await listAcrossCalendars(calendars, periodoDaBusca())
    cacheDaBusca = { carregadoEm: Date.now(), eventos }
    return eventos
  })()

  cacheDaBusca = { ...(cacheDaBusca || {}), carregando }
  try {
    return await carregando
  } catch (err) {
    cacheDaBusca = null
    throw err
  }
}

// O contador de pomodoro por tarefa (ver combinedFocusStats) não pode
// depender só dos eventos da view aberta na tela: quem está no mês de
// setembro vendo uma tarefa antiga não pode ver o contador zerado só porque
// os blocos de foco dela ficaram em agosto. Reaproveita o mesmo cache amplo
// da busca (180 dias passados a 1 ano à frente) em vez de fazer outra ida ao
// Google só para isto — os blocos "Foco: ..." são identificados pela
// propriedade privada que createEvent grava neles (ver FOCUS_TASK_PROP).
export async function prefetchFocusEvents() {
  const eventos = await prefetchEventosDaBusca()
  return eventos.filter((e) => e.extendedProperties?.private?.[FOCUS_TASK_PROP])
}

function combina(event, alvo) {
  return (
    semAcento(event.summary).includes(alvo) ||
    semAcento(event.description).includes(alvo) ||
    semAcento(event.location).includes(alvo)
  )
}

// A busca de compromissos é feita aqui, e não pelo parâmetro "q" do Google.
//
// O "q" casa palavra inteira e diferencia acento: "Audiência" achava oito
// compromissos, "Audiencia" não achava nenhum, e "Audi" também não. Quem
// procura no celular não quer digitar o acento certo nem a palavra inteira.
// Filtrando aqui, "audi" acha "Audiência" — e o resultado sai instantâneo,
// sem uma ida ao Google por tecla digitada.
export async function searchEvents(query) {
  const trimmed = query.trim()
  if (!trimmed) return []

  const eventos = await prefetchEventosDaBusca()
  const alvo = semAcento(trimmed)
  const achados = eventos.filter((event) => combina(event, alvo))

  // Futuro primeiro (o mais próximo no topo, é o que costuma importar agora),
  // e só depois o passado (o mais recente no topo).
  const nowMs = Date.now()
  const ordenados = achados.sort((a, b) => {
    const at = new Date(a.start?.dateTime || a.start?.date).getTime()
    const bt = new Date(b.start?.dateTime || b.start?.date).getTime()
    const aFuture = at >= nowMs
    const bFuture = bt >= nowMs
    if (aFuture !== bFuture) return aFuture ? -1 : 1
    return aFuture ? at - bt : bt - at
  })
  return collapseRecurring(ordenados)
}

// Recebe o evento inteiro, não só o id: ele carrega o calendarId de origem, e
// eventos de agendas secundárias não estão em 'primary'.
export async function updateEvent(
  event,
  { title, start, end, description, location, recurrence, allDay = false, criarVideochamada, removerVideochamada, projeto }
) {
  const body = {}
  // PATCH mescla as chaves de extendedProperties.private uma a uma, então só
  // a do projeto muda — as marcas de presença e de foco no mesmo evento
  // ficam intactas. `null` é o que apaga a chave (evento saiu do projeto).
  if (projeto !== undefined) body.extendedProperties = { private: { [PROJETO_PROP]: projeto || null } }
  if (title !== undefined) body.summary = title
  if (description !== undefined) body.description = description
  if (location !== undefined) body.location = location
  // `[]` (não repete mais) e uma regra nova são os dois casos válidos de
  // mexer na recorrência; `undefined` (campo nem tocado no editor) precisa
  // continuar de fora do body, senão toda edição apagaria uma recorrência
  // que a pessoa não pediu para mudar.
  if (recurrence !== undefined) body.recurrence = recurrence
  if (start && end) {
    if (allDay) {
      // O end.date do Google é exclusivo: quem escolhe "até dia 20" grava 21.
      body.start = { date: toDateInput(start) }
      body.end = { date: toDateInput(addDays(end, 1)) }
    } else {
      body.start = { dateTime: start.toISOString() }
      body.end = { dateTime: end.toISOString() }
    }
  }
  if (criarVideochamada) {
    body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  }
  // Remover não é uma operação documentada à parte — na prática, mandar o
  // campo vazio no patch (com o mesmo conferenceDataVersion) é o que some
  // com o link. Verificado só na leitura da documentação, não numa conta
  // real: se o Google devolver erro aqui, é o primeiro lugar a olhar.
  if (removerVideochamada) body.conferenceData = null

  const conferenceDataVersion = criarVideochamada || removerVideochamada ? '?conferenceDataVersion=1' : ''
  return request(
    `${CAL_BASE}/calendars/${encodeURIComponent(event.calendarId || 'primary')}/events/${event.id}${conferenceDataVersion}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  )
}

// Move o evento inteiro para outra agenda. É uma chamada própria do Calendar
// (diferente de um PATCH comum): o id do evento não muda, só o dono dele —
// ao contrário de moverTarefa (tarefas não têm essa operação e precisam do
// caminho criar+apagar), aqui a API do Google já resolve isso de uma vez.
export async function moveEvent(event, destinationCalendarId) {
  return request(
    `${CAL_BASE}/calendars/${encodeURIComponent(event.calendarId || 'primary')}/events/${event.id}/move?destination=${encodeURIComponent(destinationCalendarId)}`,
    { method: 'POST' }
  )
}

// Grava no Google a escolha de ir ou não a um compromisso, para ela valer em
// todos os aparelhos em vez de ficar presa no navegador onde foi feita.
//
// São dois caminhos porque o Google tem dois lugares para isso:
// - Você é convidado do evento: responde o RSVP de verdade, que é o que o
//   organizador espera ver.
// - Não há convite (o caso da agenda da gestão): grava numa propriedade
//   privada da cópia do evento. Ela não muda nada do que os outros veem do
//   compromisso — é o lugar que o Google reserva para marcação de uso próprio.
export async function setEventPresence(event, value) {
  const eu = (event.attendees || []).find((a) => a.self)
  const body = eu
    ? {
        attendees: event.attendees.map((a) =>
          a.self ? { ...a, responseStatus: TO_RSVP[value] || 'needsAction' } : a
        ),
      }
    // null apaga a propriedade, que é como se desmarca a escolha.
    : { extendedProperties: { private: { [PRESENCE_PROP]: value || null } } }

  return request(
    `${CAL_BASE}/calendars/${encodeURIComponent(event.calendarId || 'primary')}/events/${event.id}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  )
}

export async function deleteEvent(event) {
  return request(
    `${CAL_BASE}/calendars/${encodeURIComponent(event.calendarId || 'primary')}/events/${event.id}`,
    { method: 'DELETE' }
  )
}

// ---------- Séries (eventos que se repetem) ----------
//
// As três escolhas do Google ao editar ou excluir uma ocorrência: só esta,
// esta e as seguintes, ou todas. A agenda vem desdobrada em ocorrências, então
// "todas" e "as seguintes" precisam primeiro buscar a série que as gerou.

function urlDoEvento(calendarId, id) {
  return `${CAL_BASE}/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${encodeURIComponent(id)}`
}

export async function getEvent(calendarId, id) {
  const evento = await request(urlDoEvento(calendarId, id))
  return { ...evento, calendarId: calendarId || 'primary' }
}

// A série de uma ocorrência (para o editor mostrar a regra de repetição,
// que a ocorrência em si não carrega).
export function carregarSerie(instancia) {
  return getEvent(instancia.calendarId, instancia.recurringEventId)
}

// Quantas ocorrências a série já teve antes deste ponto — para a
// continuação de uma série de "N vezes" seguir só com as que faltam.
async function ocorrenciasAntes(serie, ate) {
  let total = 0
  let pageToken = null
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const params = new URLSearchParams({ timeMax: ate.toISOString(), maxResults: '2500' })
    if (pageToken) params.set('pageToken', pageToken)
    const data = await request(`${urlDoEvento(serie.calendarId, serie.id)}/instances?${params}`)
    total += (data.items || []).filter((i) => i.status !== 'cancelled').length
    pageToken = data.nextPageToken
    if (!pageToken) break
  }
  return total
}

async function criarEventoBruto(calendarId, body, conferencia) {
  const query = conferencia ? '?conferenceDataVersion=1' : ''
  const criado = await request(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events${query}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return { ...criado, calendarId }
}

// `patch` é o mesmo do editor (title, start, end, recurrence...), mais
// `recorrenciaEscolhida`: se a pessoa mexeu na repetição. `escopo` é 'este',
// 'seguintes' ou 'todos'.
export async function salvarEvento(evento, patch, escopo = 'este') {
  const origem = evento.calendarId || 'primary'
  const destino = patch.calendarId && patch.calendarId !== origem ? patch.calendarId : null

  if (!evento.recurringEventId || escopo === 'este') {
    // Uma ocorrência sozinha não muda de agenda no Google (o editor já não
    // oferece essa combinação); um evento simples, sim.
    if (destino && !evento.recurringEventId) await moveEvent(evento, destino)
    const alvo = { ...evento, calendarId: destino && !evento.recurringEventId ? destino : origem }
    const { recurrence, ...semRegra } = patch
    return updateEvent(alvo, evento.recurringEventId ? semRegra : patch)
  }

  const serie = await getEvent(origem, evento.recurringEventId)
  const allDay = isAllDay(serie)
  if (escopo === 'seguintes' && ehPrimeiraDaSerie(serie, evento)) escopo = 'todos'

  if (escopo === 'todos') {
    if (destino) await moveEvent(serie, destino)
    const { start, end, ...resto } = patch
    const horario = horarioDaSerie(serie, evento, start, end)
    return updateEvent({ ...serie, calendarId: destino || origem }, { ...resto, allDay, ...(horario || {}) })
  }

  // Este e os seguintes: uma série nova a partir daqui, e a antiga termina
  // logo antes. A nova é criada primeiro: se cortar a antiga falhar, a nova
  // é desfeita — o pior caso vira "nada mudou", nunca "sumiram as próximas".
  const corte = inicioOriginal(evento)
  let recurrence = patch.recurrence !== undefined ? patch.recurrence : serie.recurrence
  if (!patch.recorrenciaEscolhida && (recurrence || []).some((l) => /COUNT=/i.test(l))) {
    recurrence = restanteDaContagem(recurrence, await ocorrenciasAntes(serie, corte))
  }
  const { body, conferencia } = corpoDaContinuacao(serie, patch, recurrence)
  const nova = await criarEventoBruto(destino || origem, body, conferencia)
  try {
    await updateEvent(serie, { recurrence: encerrarAntes(serie.recurrence, corte, allDay) })
  } catch (err) {
    await deleteEvent(nova).catch(() => {})
    throw err
  }
  return nova
}

export async function excluirEvento(evento, escopo = 'este') {
  if (!evento.recurringEventId || escopo === 'este') return deleteEvent(evento)
  const serie = await getEvent(evento.calendarId, evento.recurringEventId)
  if (escopo === 'todos' || ehPrimeiraDaSerie(serie, evento)) return deleteEvent(serie)
  return updateEvent(serie, { recurrence: encerrarAntes(serie.recurrence, inicioOriginal(evento), isAllDay(serie)) })
}

// ---------- Tasks e criação de compromisso ----------
//
// O código mora em googleTarefas.js e googleAgenda.js, que o conector do
// Claude também usa; aqui eles só ganham o `request` do navegador.

export const {
  listTaskLists,
  criarListaDeTarefas,
  garantirLista,
  listTasks,
  listAllTasks,
  listCompletedTasks,
  createTask,
  completeTask,
  updateTask,
  reopenTask,
  deleteTask,
  moverTarefa,
} = criarApiDeTarefas(request)

// ---------- arquivos dos projetos no Drive ----------

export const { pastaDoProjeto, criarArquivoGoogle, renomearArquivo, mandarParaLixeira } = criarDriveDosProjetos(request)

// O conteúdo de um arquivo do Drive, para pré-visualizar ou baixar dentro
// do app. Pelo token, e não pelo link do Drive: o app instalado no iPhone não
// tem o login do Google do Safari, e o visualizador do Drive pediria entrar
// de novo dentro da moldura.
export async function baixarDoDrive(driveId, { tentarDeNovo = true } = {}) {
  const token = await ensureToken()
  if (!token) throw new Error('Sem token de acesso. Faça login primeiro.')
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401 && tentarDeNovo && (await refreshAfterUnauthorized(token))) {
    return baixarDoDrive(driveId, { tentarDeNovo: false })
  }
  if (!res.ok) throw erroDoGoogle(res.status, await res.text())
  return res.blob()
}

function erroDoGoogle(status, corpo) {
  const err = new Error(`Erro na API do Google (${status}): ${corpo}`)
  err.status = status
  err.body = corpo
  return err
}

// Envio em duas etapas (o "resumable" do Drive): abre a sessão com o nome e
// a pasta, e manda o conteúdo para o endereço que ela devolve. Assim o
// arquivo vai inteiro, de qualquer tamanho, e o XMLHttpRequest dá o
// andamento para a barra de progresso — o fetch não informa quanto já subiu.
export async function enviarArquivoAoDrive(pastaId, arquivo, aoProgredir = () => {}, { tentarDeNovo = true } = {}) {
  const token = await ensureToken()
  if (!token) throw new Error('Sem token de acesso. Faça login primeiro.')
  const inicio = `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${CAMPOS_DO_ARQUIVO}`
  const sessao = await fetch(inicio, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': arquivo.type || 'application/octet-stream',
    },
    body: JSON.stringify({ name: arquivo.name, parents: [pastaId] }),
  })
  if (sessao.status === 401 && tentarDeNovo && (await refreshAfterUnauthorized(token))) {
    return enviarArquivoAoDrive(pastaId, arquivo, aoProgredir, { tentarDeNovo: false })
  }
  if (!sessao.ok) throw erroDoGoogle(sessao.status, await sessao.text())
  // O endereço do envio vem no Location. Se o navegador não puder lê-lo (o
  // Google decide pela resposta quais cabeçalhos expõe), o id da sessão, que
  // ele sempre expõe, monta o mesmo endereço.
  const idDaSessao = sessao.headers.get('X-GUploader-UploadID')
  const destino = sessao.headers.get('Location') || (idDaSessao && `${inicio}&upload_id=${encodeURIComponent(idDaSessao)}`)
  if (!destino) throw new Error('O Drive não abriu o envio. Tente de novo.')

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', destino)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoProgredir(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('O Drive recebeu o arquivo, mas a resposta veio estranha.'))
        }
      } else {
        reject(erroDoGoogle(xhr.status, xhr.responseText))
      }
    }
    xhr.onerror = () => reject(new Error('A conexão caiu durante o envio.'))
    xhr.send(arquivo)
  })
}
