import { ensureToken } from './googleAuth.js'
import { pausarIA } from './aiCooldown.js'

// Manda um resumo já enxuto dos dados (nunca a lista completa e crua de
// eventos/tarefas) para o Worker escrever o texto do briefing com o Claude.
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
  if (!res.ok) {
    const err = new Error(data.error || `Falha ao gerar o briefing (${res.status}).`)
    // Sobrecarga da Anthropic é passageira, e a varredura tenta de novo sozinha
    // enquanto a janela do horário não fecha. Quem trata o erro usa isto para
    // não alarmar à toa (ver useBriefing.js).
    err.transiente = data.transiente === true
    pausarIA(data.motivo)
    throw err
  }

  return data.text || ''
}
