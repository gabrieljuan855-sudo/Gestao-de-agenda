import { ensureToken } from './googleAuth.js'

// Manda um resumo já enxuto dos dados (nunca a lista completa e crua de
// eventos/tarefas) para o Worker escrever o texto do briefing com o Gemini.
export async function fetchBriefingFromAI(kind, context) {
  const token = await ensureToken()
  if (!token) throw new Error('Faça login primeiro.')

  const now = new Date()
  const res = await fetch('/api/briefing', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      kind,
      context,
      today: now.toLocaleDateString('pt-BR'),
      weekday: now.toLocaleDateString('pt-BR', { weekday: 'long' }),
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Falha ao gerar o briefing (${res.status}).`)

  return data.text || ''
}
