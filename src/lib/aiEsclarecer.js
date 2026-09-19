import { ensureToken } from './googleAuth.js'
import { pausarIA } from './aiCooldown.js'

// Manda UM item da Entrada para o Worker propor o que ele é.
//
// É a única chamada de IA que sobrou no caminho de organizar, e de propósito:
// transformar texto humano bagunçado ("escola joão vaga ligar") em ação clara
// ("Ligar para a escola sobre a vaga do João") é a única coisa aqui que
// código determinístico não faz. O resto do sistema é regra.
//
// O prompt leva só o item e a lista de contextos que a pessoa já usa —
// algumas centenas de caracteres, contra os 7 a 25 mil que o agente de
// conversa reenviava a cada mensagem.
export async function esclarecerItem(texto, contextos = []) {
  const token = await ensureToken()
  if (!token) throw new Error('Faça login primeiro.')

  const now = new Date()
  const res = await fetch('/api/esclarecer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      texto,
      contextos,
      today: now.toLocaleDateString('pt-BR'),
      weekday: now.toLocaleDateString('pt-BR', { weekday: 'long' }),
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    pausarIA(data.motivo)
    const err = new Error(data.error || `Falha ao esclarecer (${res.status}).`)
    err.transiente = data.transiente === true
    throw err
  }

  return {
    tipo: data.tipo || null,
    titulo: data.titulo || '',
    contexto: data.contexto || null,
    quem: data.quem || null,
    date: data.date || null,
    time: data.time || null,
  }
}
