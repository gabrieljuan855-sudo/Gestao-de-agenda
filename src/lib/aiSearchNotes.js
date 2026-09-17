import { ensureToken } from './googleAuth.js'
import { pausarIA } from './aiCooldown.js'

// Pergunta em linguagem natural sobre as anotações existentes ("o que eu
// escrevi sobre o caso da Maria?") — o Worker responde usando só o que está
// nelas e aponta quais notas usou, pela mesma referência curta (n1, n2...)
// do restante do app.
export async function searchNotes(query, notes) {
  const token = await ensureToken()
  if (!token) throw new Error('Faça login primeiro.')

  const now = new Date()
  const res = await fetch('/api/search-notes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query,
      today: now.toLocaleDateString('pt-BR'),
      weekday: now.toLocaleDateString('pt-BR', { weekday: 'long' }),
      notas: notes.map((n) => ({ titulo: n.title || '', trecho: (n.body || '').trim().slice(0, 200) })),
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    pausarIA(data.motivo)
    const err = new Error(data.error || `Falha ao buscar (${res.status}).`)
    err.transiente = data.transiente === true
    throw err
  }

  return {
    answer: data.answer || '',
    refs: Array.isArray(data.refs) ? data.refs : [],
  }
}
