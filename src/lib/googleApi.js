import { normalizePriority, priorityFromListTitle, DEFAULT_PRIORITY } from './priority.js'
import { ensureToken, refreshAfterUnauthorized } from './googleAuth.js'
import { toDateInput, addDays } from './dates.js'
import { PRESENCE_PROP, TO_RSVP } from './calendarPrefs.js'
import { semAcento } from './texto.js'
import { FOCUS_TASK_PROP } from './focusStats.js'
import { acharLista, parseMeta, encodeMeta } from './gtd.js'

const CAL_BASE = 'https://www.googleapis.com/calendar/v3'
const TASKS_BASE = 'https://www.googleapis.com/tasks/v1'

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

export async function listCalendars() {
  const data = await request(`${CAL_BASE}/users/me/calendarList?minAccessRole=reader`)
  return (data.items || []).filter((cal) => cal.selected !== false)
}

// O Google devolve no máximo 250 por vez e indica a próxima página. Sem seguir
// essa indicação, um período longo perdia eventos em silêncio — o que é pior
// do que falhar, porque a lista parece completa.
const MAX_PAGINAS = 12

export async function listEvents({ timeMin, timeMax, calendarId = 'primary', q }) {
  const eventos = []
  let pageToken = null

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    })
    // O "q" do Google só entra quando tem texto, pra esta função continuar
    // servindo o carregamento normal por período.
    if (q) params.set('q', q)
    if (pageToken) params.set('pageToken', pageToken)

    const data = await request(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`)
    for (const event of data.items || []) eventos.push({ ...event, calendarId })

    pageToken = data.nextPageToken
    if (!pageToken) break
  }

  return eventos
}

// Junta o resultado de várias agendas, decorando cada evento com a cor e o
// nome da agenda de origem — o mesmo acabamento que listAllEvents e
// searchEvents precisam, cada um com seu próprio período/filtro.
async function listAcrossCalendars(calendars, params) {
  const perCalendar = await Promise.all(
    calendars.map((cal) =>
      listEvents({ ...params, calendarId: cal.id })
        .then((events) =>
          events.map((event) => ({
            ...event,
            calendarSummary: cal.summaryOverride || cal.summary,
            calendarColor: cal.backgroundColor,
            calendarIsPrimary: Boolean(cal.primary),
          }))
        )
        .catch((err) => {
          console.error(`Falha ao buscar eventos da agenda ${cal.summary}:`, err)
          return []
        })
    )
  )
  return perCalendar.flat()
}

// Busca eventos de todas as agendas marcadas como visíveis na conta do usuário
// (não só a agenda principal), já que uma pessoa costuma ter várias agendas.
// Cada evento sai marcado com a cor e o nome da agenda de origem, do jeito que
// o próprio Google Calendar mostra.
export async function listAllEvents({ timeMin, timeMax }) {
  const calendars = await listCalendars()
  const events = await listAcrossCalendars(calendars, { timeMin, timeMax })
  return events.sort(
    (a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date)
  )
}

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

export async function createEvent({ title, start, end, description, calendarId = 'primary', extendedProperties }) {
  return request(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify({
      summary: title,
      description,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      ...(extendedProperties ? { extendedProperties } : {}),
    }),
  })
}

// Recebe o evento inteiro, não só o id: ele carrega o calendarId de origem, e
// eventos de agendas secundárias não estão em 'primary'.
export async function updateEvent(event, { title, start, end, description, allDay = false }) {
  const body = {}
  if (title !== undefined) body.summary = title
  if (description !== undefined) body.description = description
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

  return request(
    `${CAL_BASE}/calendars/${encodeURIComponent(event.calendarId || 'primary')}/events/${event.id}`,
    { method: 'PATCH', body: JSON.stringify(body) }
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

// ---------- Tasks ----------

// A convenção de guardar metadado no começo da nota da tarefa mora em
// gtd.js (parseMeta/encodeMeta), que é lógica pura e tem teste. Aqui só se
// usa.

export async function listTaskLists() {
  const data = await request(`${TASKS_BASE}/users/@me/lists`)
  return data.items || []
}

export async function criarListaDeTarefas(titulo) {
  return request(`${TASKS_BASE}/users/@me/lists`, {
    method: 'POST',
    body: JSON.stringify({ title: titulo }),
  })
}

// Devolve a lista com esse nome, criando-a só se ainda não existir. É o que
// permite a Entrada nascer sozinha no primeiro login, sem o usuário precisar
// criar nada à mão no app do Google (diferente das listas "Prioridade ...",
// que até hoje precisavam existir de antemão para o app funcionar direito).
export async function garantirLista(taskLists, titulo) {
  const existente = acharLista(taskLists, titulo)
  if (existente) return existente
  return criarListaDeTarefas(titulo)
}

export async function listTasks({ tasklistId = '@default', tasklistTitle = '', showCompleted = false } = {}) {
  const params = new URLSearchParams({
    showCompleted: String(showCompleted),
    showHidden: String(showCompleted),
    maxResults: '200',
  })
  const data = await request(`${TASKS_BASE}/lists/${encodeURIComponent(tasklistId)}/tasks?${params}`)
  // Ordem de decisão: a tag explícita manda; sem tag, vale o nome da lista
  // ("Prioridade Máxima (menos de uma semana)"); sem os dois, o padrão.
  const fromList = priorityFromListTitle(tasklistTitle)
  return (data.items || []).map((t) => {
    const meta = parseMeta(t.notes)
    return {
      ...t,
      priority: meta.priority || fromList || DEFAULT_PRIORITY,
      contexto: meta.contexto,
      projeto: meta.projeto,
      aguardando: meta.aguardando,
      duracao: meta.duracao,
      notesClean: meta.notes,
      tasklistId,
    }
  })
}

// Busca tarefas de todas as listas do usuário (equivalente às várias agendas
// do Calendar), marcando cada tarefa com a lista de onde ela veio.
export async function listAllTasks({ showCompleted = false } = {}) {
  const lists = await listTaskLists()
  const perList = await Promise.all(
    lists.map((list) =>
      listTasks({ tasklistId: list.id, tasklistTitle: list.title, showCompleted })
        .then((tasks) => tasks.map((t) => ({ ...t, tasklistTitle: list.title })))
        .catch((err) => {
          console.error(`Falha ao buscar tarefas da lista ${list.title}:`, err)
          return []
        })
    )
  )
  return perList.flat()
}

export async function createTask({
  title,
  priority = DEFAULT_PRIORITY,
  due,
  notes = '',
  contexto = null,
  projeto = null,
  aguardando = null,
  duracao = null,
  tasklistId = '@default',
}) {
  return request(`${TASKS_BASE}/lists/${encodeURIComponent(tasklistId)}/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      notes: encodeMeta({ priority, contexto, projeto, aguardando, duracao }, notes),
      due: due ? due.toISOString() : undefined,
    }),
  })
}

export async function completeTask(taskId, tasklistId = '@default') {
  return request(`${TASKS_BASE}/lists/${encodeURIComponent(tasklistId)}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' }),
  })
}

export async function updateTask(task, { title, due, priority, notes, contexto, projeto, aguardando, duracao }) {
  const body = {}
  if (title !== undefined) body.title = title
  // O Google Tasks guarda só a data do prazo; a hora é ignorada pela API.
  if (due !== undefined) body.due = due ? due.toISOString() : null
  if (
    priority !== undefined ||
    notes !== undefined ||
    contexto !== undefined ||
    projeto !== undefined ||
    aguardando !== undefined ||
    duracao !== undefined
  ) {
    // O bloco é reescrito inteiro, então o que não veio no patch precisa vir
    // da tarefa — senão mudar só a prioridade apagaria o contexto. `??`
    // não serve aqui: ele trata `null` (a forma de *apagar* um campo, como
    // "não está mais esperando ninguém") igual a `undefined` (a forma de
    // "não mexi nisso"), e um reativar que manda `aguardando: null` para
    // encerrar a espera veria o valor antigo voltar sozinho.
    body.notes = encodeMeta(
      {
        priority: priority !== undefined ? priority : task.priority,
        contexto: contexto !== undefined ? contexto : task.contexto,
        projeto: projeto !== undefined ? projeto : task.projeto,
        aguardando: aguardando !== undefined ? aguardando : task.aguardando,
        duracao: duracao !== undefined ? duracao : task.duracao,
      },
      notes !== undefined ? notes : task.notesClean
    )
  }

  return request(`${TASKS_BASE}/lists/${encodeURIComponent(task.tasklistId || '@default')}/tasks/${task.id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function reopenTask(task) {
  return request(`${TASKS_BASE}/lists/${encodeURIComponent(task.tasklistId || '@default')}/tasks/${task.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'needsAction', completed: null }),
  })
}

export async function deleteTask(task) {
  return request(`${TASKS_BASE}/lists/${encodeURIComponent(task.tasklistId || '@default')}/tasks/${task.id}`, {
    method: 'DELETE',
  })
}

// Mover de lista é o gesto central do esclarecer: sair da Entrada e virar
// próxima ação, espera ou algum dia.
//
// A API tem um endpoint próprio para isso, que preserva o id da tarefa — mas
// `destinationTasklist` é recente e nem toda conta responde a ele. Quando não
// responde, o caminho é recriar no destino e apagar na origem. Isso troca o
// id, e por isso a ordem importa: **cria primeiro**. Se apagasse antes e a
// criação falhasse, o item sumiria — e perder o que a pessoa capturou é o
// único erro que este app não pode cometer.
export async function moverTarefa(task, tasklistDestinoId, patch = {}) {
  const origem = task.tasklistId || '@default'
  const temPatch = Object.keys(patch).length > 0

  if (origem === tasklistDestinoId) {
    return temPatch ? updateTask(task, patch) : task
  }

  let movida = null
  try {
    movida = await request(
      `${TASKS_BASE}/lists/${encodeURIComponent(origem)}/tasks/${task.id}/move` +
        `?destinationTasklist=${encodeURIComponent(tasklistDestinoId)}`,
      { method: 'POST' }
    )
  } catch (err) {
    // Só a falha do *mover* leva ao plano B. Se o catch envolvesse também o
    // patch abaixo, um erro depois de a tarefa já ter mudado de lista faria
    // o plano B criar uma cópia — e a pessoa ficaria com a coisa duplicada.
    console.warn('Endpoint de mover não atendeu, recriando no destino:', err.message)
    // `!== undefined`, não `??`: um patch que manda `aguardando: null` está
    // encerrando a espera de propósito, e `??` devolveria o valor antigo.
    const nova = await createTask({
      title: patch.title !== undefined ? patch.title : task.title,
      priority: patch.priority !== undefined ? patch.priority : task.priority,
      due: patch.due !== undefined ? patch.due : task.due ? new Date(task.due) : null,
      notes: patch.notes !== undefined ? patch.notes : task.notesClean,
      contexto: patch.contexto !== undefined ? patch.contexto : task.contexto,
      projeto: patch.projeto !== undefined ? patch.projeto : task.projeto,
      aguardando: patch.aguardando !== undefined ? patch.aguardando : task.aguardando,
      duracao: patch.duracao !== undefined ? patch.duracao : task.duracao,
      tasklistId: tasklistDestinoId,
    })
    await deleteTask(task)
    return nova
  }

  if (!temPatch) return movida
  return updateTask({ ...task, ...movida, tasklistId: tasklistDestinoId }, patch)
}
