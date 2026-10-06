import { formatDuration } from './dates.js'

// Quando foi a última revisão concluída. A revisão semanal do GTD só funciona
// se for semanal de verdade: "há 9 dias" à vista é o lembrete que nenhum
// aviso de sexta-feira consegue ser. Fica neste aparelho; o registro que
// atravessa aparelhos é a anotação "Revisão de dd/mm" criada ao concluir.
const CHAVE = 'gestao-agenda:ultima-revisao'

export function lerUltimaRevisao() {
  try {
    const valor = localStorage.getItem(CHAVE)
    return valor && !Number.isNaN(new Date(valor).getTime()) ? valor : null
  } catch {
    return null
  }
}

export function gravarUltimaRevisao(quando = new Date()) {
  try {
    localStorage.setItem(CHAVE, quando.toISOString())
  } catch {
    // Sem armazenamento: a anotação da revisão continua sendo o registro.
  }
}

export function descreverUltimaRevisao(iso, now = new Date()) {
  if (!iso) return 'Nenhuma revisão concluída ainda neste aparelho.'
  const dias = Math.floor((startOfDayMs(now) - startOfDayMs(new Date(iso))) / 86400000)
  if (dias <= 0) return 'Última revisão: hoje.'
  if (dias === 1) return 'Última revisão: ontem.'
  return `Última revisão: há ${dias} dias.`
}

function startOfDayMs(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// A revisão precisa de uma hora "sugerida" para começar: passou de uma semana
// sem revisar (ou nunca revisou), ela é cobrada com mais ênfase.
export function revisaoAtrasada(iso, now = new Date()) {
  if (!iso) return true
  return (startOfDayMs(now) - startOfDayMs(new Date(iso))) / 86400000 >= 7
}

// O texto da anotação que fica de registro ao concluir: o que a semana teve,
// o que foi decidido na revisão e o comentário da IA, se houve. É o que
// permite, semanas depois, ver o que foi decidido e quando.
export function textoDaRevisao({ numeros, comentario, decisoes = [] }, quando = new Date()) {
  const linhas = []
  if (numeros) {
    linhas.push('Números da semana')
    linhas.push(`- Concluídas: ${numeros.concluidasNaSemana}`)
    linhas.push(`- Atrasadas: ${numeros.atrasadas}`)
    linhas.push(`- Paradas há mais de 3 dias: ${numeros.paradas}`)
    linhas.push(`- Blocos de foco: ${numeros.blocosDeFoco} (${formatDuration(numeros.minutosDeFoco || 0)})`)
    if (numeros.projetosParados?.length) linhas.push(`- Projetos sem próxima ação: ${numeros.projetosParados.join(', ')}`)
    linhas.push('')
  }
  if (decisoes.length) {
    linhas.push('Decidido nesta revisão')
    for (const d of decisoes) linhas.push(`- ${d}`)
    linhas.push('')
  }
  if (comentario) {
    linhas.push('Comentário')
    linhas.push(comentario)
  }
  const data = `${String(quando.getDate()).padStart(2, '0')}/${String(quando.getMonth() + 1).padStart(2, '0')}`
  return { title: `Revisão de ${data}`, body: linhas.join('\n').trim() }
}
