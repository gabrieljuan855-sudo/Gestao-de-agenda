import { ensureToken } from './googleAuth.js'
import { normalizePriority } from './priority.js'

// Manda um comando de texto livre ("desmarcar a reunião de terça", "mudar a
// consulta para sexta 15h", "não vou conseguir ir à reunião de amanhã") para
// o Worker interpretar com o Gemini. Devolve a ação pedida — quem acha o
// compromisso/tarefa de verdade e confirma antes de agir é o chamador
// (useCommandBar.js), nunca esta função.
export async function parseCommandWithAI(text, calendars = [], { signal } = {}) {
  const token = await ensureToken()
  if (!token) throw new Error('Faça login primeiro.')

  const now = new Date()
  const res = await fetch('/api/command', {
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

  return {
    action: data.action || 'desconhecido',
    searchText: data.searchText || '',
    title: data.title || '',
    date: data.date || null,
    time: data.time || null,
    durationMinutes: data.durationMinutes || null,
    calendarId: data.calendarId || '',
    priority: normalizePriority(data.priority),
    presence: data.presence || null,
    summary: data.summary || '',
  }
}
