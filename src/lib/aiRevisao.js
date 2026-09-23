import { ensureToken } from './googleAuth.js'
import { pausarIA } from './aiCooldown.js'

// Manda os números, os itens que pedem decisão e o material para montar um
// plano da semana (candidatas a próxima ação + vãos livres da agenda) para o
// Worker propor ações — a única chamada de IA da revisão, e só quando a
// pessoa pede. A tarefa inteira (`task`) fica aqui no navegador: para o
// Gemini vai só o que ele precisa ler para sugerir (título, prazo, duração).
export async function fetchSugestoesDaRevisao(numeros, itens, candidatas, vagas) {
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
      candidatas: candidatas.map(({ task, ...resto }) => resto),
      vagas,
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

  return {
    comentario: data.text || '',
    sugestoes: Array.isArray(data.sugestoes) ? data.sugestoes : [],
    plano: Array.isArray(data.plano) ? data.plano : [],
  }
}
