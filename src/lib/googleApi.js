import { normalizePriority, priorityFromListTitle, DEFAULT_PRIORITY } from './priority.js'
import { ensureToken, refreshAfterUnauthorized } from './googleAuth.js'
import { toDateInput, addDays } from './dates.js'
import { PRESENCE_PROP, TO_RSVP } from './calendarPrefs.js'
import { semAcento } from './texto.js'

const CAL_BASE = 'https://www.googleapis.com/calendar/v3'
const TASKS_BASE = 'https://www.googleapis.com/tasks/v1'

async function request(url, options = {}, { retryOnAuth = true } = {}) {
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
    throw new Error(`Erro na API do Google (${res.status}): ${body}`)
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

export async function createEvent({ title, start, end, description, calendarId = 'primary' }) {
  return request(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify({
      summary: title,
      description,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
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

// Convenção usada por este app para guardar a prioridade dentro do Google Tasks:
// a nota da tarefa começa com uma tag entre colchetes, ex: "[alta] texto livre".
// Os ids antigos ficam na expressão porque já existem tarefas gravadas assim.
const PRIORITY_TAG = /^\[(alta|media|baixa|urgente|importante|pode_esperar)\]\s*/i

// Devolve a prioridade escrita na nota, ou null quando não há tag — aí quem
// decide é o nome da lista (ver priorityFromListTitle).
export function parsePriorityFromNotes(notes) {
  if (!notes) return { priority: null, notes: '' }
  const match = notes.match(PRIORITY_TAG)
  if (!match) return { priority: null, notes }
  return {
    priority: normalizePriority(match[1]),
    notes: notes.replace(PRIORITY_TAG, ''),
  }
}

function encodeNotes(priority, notes) {
  return `[${normalizePriority(priority) || DEFAULT_PRIORITY}] ${notes || ''}`.trim()
}

export async function listTaskLists() {
  const data = await request(`${TASKS_BASE}/users/@me/lists`)
  return data.items || []
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
    const { priority, notes } = parsePriorityFromNotes(t.notes)
    return {
      ...t,
      priority: priority || fromList || DEFAULT_PRIORITY,
      notesClean: notes,
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

export async function createTask({ title, priority = DEFAULT_PRIORITY, due, notes = '', tasklistId = '@default' }) {
  return request(`${TASKS_BASE}/lists/${encodeURIComponent(tasklistId)}/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      notes: encodeNotes(priority, notes),
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

export async function updateTask(task, { title, due, priority, notes }) {
  const body = {}
  if (title !== undefined) body.title = title
  // O Google Tasks guarda só a data do prazo; a hora é ignorada pela API.
  if (due !== undefined) body.due = due ? due.toISOString() : null
  if (priority !== undefined || notes !== undefined) {
    body.notes = encodeNotes(priority ?? task.priority, notes ?? task.notesClean)
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
