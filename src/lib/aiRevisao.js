import { ensureToken } from './googleAuth.js'
import { pausarIA } from './aiCooldown.js'

// Manda os números e os itens que pedem decisão para o Worker propor uma
// ação para cada um — a única chamada de IA da revisão, e só quando a pessoa
// pede. A tarefa inteira (`task`) fica aqui no navegador: para o Gemini vai só
// o que ele precisa ler para sugerir (título, há quantos dias, com quem).
export async function fetchSugestoesDaRevisao(numeros, itens) {
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
      numeros,
      itens: itens.map(({ task, ...resto }) => resto),
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

  return { comentario: data.text || '', sugestoes: Array.isArray(data.sugestoes) ? data.sugestoes : [] }
}
