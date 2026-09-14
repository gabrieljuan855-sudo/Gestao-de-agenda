import { getToken } from './googleAuth.js'

const CAL_BASE = 'https://www.googleapis.com/calendar/v3'
const TASKS_BASE = 'https://www.googleapis.com/tasks/v1'

async function request(url, options = {}) {
  const token = getToken()
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

export async function listEvents({ timeMin, timeMax }) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })
  const data = await request(`${CAL_BASE}/calendars/primary/events?${params}`)
  return data.items || []
}

export async function createEvent({ title, start, end, description }) {
  return request(`${CAL_BASE}/calendars/primary/events`, {
    method: 'POST',
    body: JSON.stringify({
      summary: title,
      description,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    }),
  })
}

export async function deleteEvent(eventId) {
  return request(`${CAL_BASE}/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
  })
}

// ---------- Tasks ----------

// Convenção usada por este app para guardar a prioridade dentro do Google Tasks:
// a nota da tarefa começa com uma tag entre colchetes, ex: "[urgente] texto livre".
const PRIORITY_TAG = /^\[(urgente|importante|pode_esperar)\]\s*/i

export function parsePriorityFromNotes(notes) {
  if (!notes) return { priority: 'pode_esperar', notes: '' }
  const match = notes.match(PRIORITY_TAG)
  if (!match) return { priority: 'pode_esperar', notes }
  return {
    priority: match[1].toLowerCase(),
    notes: notes.replace(PRIORITY_TAG, ''),
  }
}

function encodeNotes(priority, notes) {
  return `[${priority}] ${notes || ''}`.trim()
}

export async function listTasks() {
  const data = await request(`${TASKS_BASE}/lists/@default/tasks?showCompleted=false&maxResults=200`)
  return (data.items || []).map((t) => {
    const { priority, notes } = parsePriorityFromNotes(t.notes)
    return { ...t, priority, notesClean: notes }
  })
}

export async function createTask({ title, priority = 'pode_esperar', due, notes = '' }) {
  return request(`${TASKS_BASE}/lists/@default/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      notes: encodeNotes(priority, notes),
      due: due ? due.toISOString() : undefined,
    }),
  })
}

export async function completeTask(taskId) {
  return request(`${TASKS_BASE}/lists/@default/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' }),
  })
}

export async function updateTaskPriority(task, priority) {
  return request(`${TASKS_BASE}/lists/@default/tasks/${task.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ notes: encodeNotes(priority, task.notesClean) }),
  })
}
