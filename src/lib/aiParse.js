import { ensureToken } from './googleAuth.js'
import { fromInputs } from './dates.js'
import { normalizePriority } from './priority.js'

// Manda o texto para o Worker interpretar com o Gemini. O token do Google vai
// junto porque a rota exige dono autenticado: sem isso ela seria cota grátis
// para qualquer um que descobrisse a URL.
export async function parseWithAI(text, calendars = [], { signal } = {}) {
  const token = await ensureToken()
  if (!token) throw new Error('Faça login primeiro.')

  const now = new Date()
  const res = await fetch('/api/parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      text,
      today: now.toLocaleDateString('pt-BR'),
      weekday: now.toLocaleDateString('pt-BR', { weekday: 'long' }),
      calendars: calendars.map((c) => ({ id: c.id, name: c.summaryOverride || c.summary })),
    }),
    signal,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Falha ao interpretar (${res.status}).`)

  return toPreview(data)
}

// Converte a resposta do Worker no mesmo formato que o parser local produz,
// para o resto da tela não precisar saber de onde veio.
function toPreview(data) {
  const base = {
    title: data.title || '',
    priority: normalizePriority(data.priority),
    calendarId: data.calendarId || '',
    durationMinutes: data.durationMinutes || 60,
  }

  if (data.type === 'event' && data.date && data.time) {
    const start = fromInputs(data.date, data.time)
    return {
      ...base,
      type: 'event',
      start,
      end: new Date(start.getTime() + base.durationMinutes * 60000),
    }
  }

  return {
    ...base,
    type: 'task',
    due: data.date ? fromInputs(data.date) : null,
  }
}
