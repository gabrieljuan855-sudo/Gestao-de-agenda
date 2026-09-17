import { ensureToken } from './googleAuth.js'
import { pausarIA } from './aiCooldown.js'

// Manda o texto de uma anotação para o Worker analisar com o Claude e sugerir
// um título curto e ações (agendar, criar tarefa, falar com alguém, evoluir
// um caso, ou só o aviso de que aquilo merece virar um documento).
export async function analyzeNoteWithAI(text) {
  const token = await ensureToken()
  if (!token) throw new Error('Faça login primeiro.')

  const now = new Date()
  const res = await fetch('/api/analyze-note', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      text,
      today: now.toLocaleDateString('pt-BR'),
      weekday: now.toLocaleDateString('pt-BR', { weekday: 'long' }),
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // A varredura das anotações analisa uma nota por chamada: sem este freio,
    // uma cota estourada vira uma rajada de N falhas seguidas, 4x por dia.
    pausarIA(data.motivo)
    const err = new Error(data.error || `Falha ao analisar (${res.status}).`)
    // Para quem chama (useNotes.js) escolher a mensagem certa: sobrecarga ou
    // cota se resolve sozinha, e não é a mesma coisa que "isto está quebrado".
    err.transiente = data.transiente === true
    throw err
  }

  return {
    title: data.title || '',
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
  }
}
