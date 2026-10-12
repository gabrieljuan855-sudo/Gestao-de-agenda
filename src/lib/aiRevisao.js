import { ensureToken } from './googleAuth.js'
import { pausarIA, barrarSeCotaDoDiaAcabou } from './aiCooldown.js'
import { criarMemoriaDeRespostas } from './memoriaDeRespostas.js'

// Recalcular sem ter mudado nada manda exatamente o mesmo pedido; a resposta
// de alguns minutos atrás vale (ver memoriaDeRespostas.js).
const lembrar = criarMemoriaDeRespostas({ ttlMs: 10 * 60 * 1000 })

// Manda os números, os itens que pedem decisão e o material para montar um
// plano da semana (candidatas a próxima ação + vãos livres da agenda) para o
// Worker propor ações — a única chamada de IA da revisão, e só quando a
// pessoa pede. A tarefa inteira (`task`) fica aqui no navegador: para o
// Gemini vai só o que ele precisa ler para sugerir (título, prazo, duração).
export function fetchSugestoesDaRevisao(numeros, itens, candidatas, vagas) {
  const now = new Date()
  const corpo = JSON.stringify({
    numeros,
    itens: itens.map(({ task, ...resto }) => resto),
    candidatas: candidatas.map(({ task, ...resto }) => resto),
    vagas,
    today: now.toLocaleDateString('pt-BR'),
    weekday: now.toLocaleDateString('pt-BR', { weekday: 'long' }),
  })

  return lembrar(corpo, async () => {
    // Dentro da memória, de propósito: resposta que já temos não precisa da
    // cota, e só um pedido que iria ao Gemini de verdade é barrado.
    barrarSeCotaDoDiaAcabou()
    const token = await ensureToken()
    if (!token) throw new Error('Faça login primeiro.')

    const res = await fetch('/api/briefing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: corpo,
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
  })
}
