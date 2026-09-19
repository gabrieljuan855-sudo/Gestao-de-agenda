import { ensureToken } from './googleAuth.js'
import { pausarIA } from './aiCooldown.js'

// Manda os números já calculados da semana (nunca a lista crua de eventos ou
// tarefas) para o Worker escrever um comentário curto com o Gemini — a única
// chamada de IA da revisão inteira, e só quando a pessoa pede.
export async function fetchComentarioDaRevisao(context) {
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
      context,
      today: now.toLocaleDateString('pt-BR'),
      weekday: now.toLocaleDateString('pt-BR', { weekday: 'long' }),
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Falha ao gerar a revisão (${res.status}).`)
    err.transiente = data.transiente === true
    pausarIA(data.motivo)
    throw err
  }

  return data.text || ''
}
