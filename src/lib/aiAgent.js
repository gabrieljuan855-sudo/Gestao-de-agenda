import { ensureToken } from './googleAuth.js'
import { normalizePriority } from './priority.js'
import { pausarIA } from './aiCooldown.js'

// Manda uma mensagem da conversa para o agente no Worker, junto com o que ele
// precisa enxergar (agenda, tarefas, anotações) e o histórico da conversa.
//
// Devolve a resposta em texto e as ações PROPOSTAS. Nada é executado aqui nem
// no Worker: quem executa é useAgent.js, e só depois de a pessoa aprovar.
export async function askAgent({ text, history = [], context = {} }, { signal } = {}) {
  const token = await ensureToken()
  if (!token) throw new Error('Faça login primeiro.')

  const now = new Date()
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      text,
      today: now.toLocaleDateString('pt-BR'),
      weekday: now.toLocaleDateString('pt-BR', { weekday: 'long' }),
      history,
      context,
    }),
    signal,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Falha ao falar com o agente (${res.status}).`)
    // Aqui a pessoa está esperando uma resposta na tela, então o erro aparece
    // de qualquer jeito — mas saber que é passageiro muda o texto, de "deu
    // errado" para "tenta de novo daqui a pouco".
    err.transiente = data.transiente === true
    // O agente é pedido na hora e continua passando mesmo em pausa, mas a
    // recusa que ele recebe vale para segurar o que roda sozinho.
    pausarIA(data.motivo)
    throw err
  }

  return {
    reply: data.reply || '',
    // O Worker já validou tudo isto; repetir aqui é barato e protege a tela
    // caso um dia a resposta chegue por outro caminho.
    actions: Array.isArray(data.actions)
      ? data.actions.map((a) => ({
          id: a.id,
          action: a.action,
          ref: a.ref || null,
          title: a.title || '',
          date: a.date || null,
          time: a.time || null,
          durationMinutes: a.durationMinutes || null,
          calendarId: a.calendarId || '',
          priority: normalizePriority(a.priority),
          presence: a.presence || null,
          resumo: a.resumo || '',
        }))
      : [],
    descartadas: Number(data.descartadas) || 0,
  }
}
