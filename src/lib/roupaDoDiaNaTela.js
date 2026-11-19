// Quando o cartão "Roupa do dia" aparece na tela inicial. Ele serve para a
// hora de se vestir: depois das 8h a decisão já foi tomada e o cartão só
// tomaria o lugar da agenda. E quem já viu pode tirá-lo da tela antes disso.
//
// "Tirar da tela" vale só para o dia e só neste aparelho: é preferência de
// tela, não um dado — a sugestão continua guardada, o Claude continua lendo
// o histórico e amanhã o cartão volta.

export const HORA_LIMITE = 8
const CHAVE = 'gestao-agenda:roupa-do-dia-dispensada'

// `agora` é um Date; a hora é a do relógio do aparelho, que é onde a pessoa
// está se vestindo. `dispensadaEm` é a data (AAAA-MM-DD) em que ela tirou o
// cartão da tela, ou null.
export function roupaDoDiaVisivel(agora, hoje, dispensadaEm) {
  return agora.getHours() < HORA_LIMITE && dispensadaEm !== hoje
}

// Quantos ms faltam para as 8h de hoje (0 se já passou): é quando o cartão
// precisa sumir sozinho, sem esperar outra coisa redesenhar a tela.
export function msAteOLimite(agora) {
  const limite = new Date(agora)
  limite.setHours(HORA_LIMITE, 0, 0, 0)
  return Math.max(0, limite.getTime() - agora.getTime())
}

export function lerDispensada() {
  try {
    return localStorage.getItem(CHAVE)
  } catch {
    return null
  }
}

export function gravarDispensada(hoje) {
  try {
    localStorage.setItem(CHAVE, hoje)
  } catch {
    // Sem armazenamento: o cartão some agora e volta se a página recarregar.
  }
}
