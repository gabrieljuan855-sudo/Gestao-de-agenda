import { normalizePriority, priorityFromListTitle, DEFAULT_PRIORITY } from './priority.js'
import { ensureToken } from './googleAuth.js'
import { toDateInput, addDays } from './dates.js'

const CAL_BASE = 'https://www.googleapis.com/calendar/v3'
const TASKS_BASE = 'https://www.googleapis.com/tasks/v1'

async function request(url, options = {}) {
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

export async function listEvents({ timeMin, timeMax, calendarId = 'primary' }) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })
  const data = await request(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`)
  return (data.items || []).map((event) => ({ ...event, calendarId }))
}

// Busca eventos de todas as agendas marcadas como visíveis na conta do usuário
// (não só a agenda principal), já que uma pessoa costuma ter várias agendas.
// Cada evento sai marcado com a cor e o nome da agenda de origem, do jeito que
// o próprio Google Calendar mostra.
export async function listAllEvents({ timeMin, timeMax }) {
  const calendars = await listCalendars()
  const perCalendar = await Promise.all(
    calendars.map((cal) =>
      listEvents({ timeMin, timeMax, calendarId: cal.id })
        .then((events) =>
          events.map((event) => ({
            ...event,
            calendarSummary: cal.summaryOverride || cal.summary,
            calendarColor: cal.backgroundColor,
          }))
        )
        .catch((err) => {
          console.error(`Falha ao buscar eventos da agenda ${cal.summary}:`, err)
          return []
        })
    )
  )
  return perCalendar
    .flat()
    .sort((a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date))
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
