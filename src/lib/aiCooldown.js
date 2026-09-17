// O freio de cota da IA.
//
// O app chama o Gemini sozinho, sem a pessoa pedir, num único lugar: os
// briefings por horário (useBriefing.js). Eles tentam de novo quando falham —
// e essa era a armadilha: quando a falha É o limite de uso estourado,
// insistir de 5 em 5 minutos só queima mais cota e mantém o limite estourado.
// O app comia a própria cota sem ninguém estar usando ele.
//
// Então, quando o Google diz que o limite acabou, o briefing automático para
// de tentar por um tempo. O que a pessoa pede na hora (o agente, analisar uma
// anotação que ela acabou de escrever, buscar nas anotações) continua
// passando: se falhar, ela vê a mensagem e decide se tenta de novo — quem
// está esperando na frente da tela sabe o que quer.
const CHAVE = 'gestao-agenda:ia-pausada-ate'

// Cota estourada não volta em minutos: espera a próxima janela de cobrança.
// Uma hora é o meio-termo entre não queimar cota à toa e não deixar o app sem
// IA o dia inteiro por causa de um pico.
const PAUSA_LIMITE_MS = 60 * 60 * 1000
// Sobrecarga passa em segundos; aqui a pausa é só para não emendar uma
// tentativa na outra dentro da mesma rajada.
const PAUSA_SOBRECARGA_MS = 5 * 60 * 1000

export function duracaoDaPausa(motivo) {
  if (motivo === 'limite') return PAUSA_LIMITE_MS
  if (motivo === 'sobrecarga') return PAUSA_SOBRECARGA_MS
  return 0
}

// Separada do localStorage de propósito: é a regra, e dá para testar sozinha.
export function pausaAtiva(ate, agora = Date.now()) {
  if (!ate) return false
  const limite = new Date(ate).getTime()
  return Number.isFinite(limite) && limite > agora
}

export function pausarIA(motivo) {
  const duracao = duracaoDaPausa(motivo)
  if (!duracao) return
  try {
    const ate = new Date(Date.now() + duracao).toISOString()
    // Não encurta uma pausa que já vale mais tempo: uma sobrecarga logo depois
    // de um limite não pode liberar as chamadas automáticas de novo.
    const atual = localStorage.getItem(CHAVE)
    if (pausaAtiva(atual) && new Date(atual) > new Date(ate)) return
    localStorage.setItem(CHAVE, ate)
  } catch {
    // Sem localStorage o freio não existe — pior caso é o comportamento
    // antigo, nunca uma tela travada.
  }
}

// Quem chama é só o que roda sozinho (briefing e varredura). O que a pessoa
// pediu na hora não passa por aqui.
export function iaEmPausa() {
  try {
    return pausaAtiva(localStorage.getItem(CHAVE))
  } catch {
    return false
  }
}
