import { compararPorPrioridadeEPrazo } from './tasks.js'

// A pergunta da tela Agora é a de sempre no GTD ao escolher o que fazer:
// dado o contexto onde estou e o tempo que tenho, qual é a melhor próxima
// ação disponível? Mostrar a lista inteira de novo (o que o Backlog já faz)
// não responde isso — é só o material bruto da decisão.
//
// Tarefa sem estimativa de duração (`duracao`) nunca é descartada pelo filtro
// de tempo: não ter essa informação não pode virar "não cabe agora" — só uma
// tarefa que *declaradamente* não cabe é excluída.
export function acoesParaAgora(tasks, { contexto = null, minutosDisponiveis = null } = {}) {
  const candidatas = (tasks || []).filter((t) => {
    if (t.status === 'completed') return false
    if (contexto && t.contexto !== contexto) return false
    if (minutosDisponiveis != null && t.duracao != null && t.duracao > minutosDisponiveis) return false
    return true
  })
  return candidatas.slice().sort(compararPorPrioridadeEPrazo)
}
