// O freio de cota da IA.
//
// Nasceu para um tempo em que o app chamava o Gemini sozinho, sem a pessoa
// pedir: os briefings por horário, 3x por dia. Eles tentavam de novo quando
// falhavam — e essa era a armadilha: quando a falha É o limite de uso
// estourado, insistir de 5 em 5 minutos só queima mais cota e mantém o
// limite estourado. O app comia a própria cota sem ninguém estar usando ele.
//
// O briefing automático não existe mais (virou a revisão semanal sob
// demanda, ver useRevisao.js) — mas o freio continua valendo para qualquer
// chamada futura que rode sozinha, sem a pessoa pedir. O que a pessoa pede na
// hora (esclarecer um item, analisar uma anotação, buscar, a revisão) não
// passa por aqui: se falhar, ela vê a mensagem e decide se tenta de novo —
// quem está esperando na frente da tela sabe o que quer.
const CHAVE = 'gestao-agenda:ia-pausada-ate'

// A chave geral da IA: com `true`, nada neste app chama o Gemini.
//
// Ela nasceu como "só o agente ativo", para medir o consumo de cota isolando
// uma superfície só. O agente de conversa não existe mais (virou a Entrada,
// onde a IA é um botão opcional em cima de um item que a pessoa já escolheu),
// então o nome antigo tinha deixado de descrever qualquer coisa.
//
// Continua ligada porque o app inteiro funciona sem IA nenhuma: capturar,
// esclarecer, arquivar e concluir são todos botões. A IA só entra como
// atalho para quem travar num item — trocar para `false` acende de novo o
// "Não sei o que fazer com isso", as sugestões da anotação, a busca por
// pergunta e o briefing automático.
export const IA_DESLIGADA = true

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
