// A fila de captura.
//
// Capturar é o único gesto do app que não pode falhar nunca: a ideia inteira
// é poder tirar uma coisa da cabeça e confiar que ela está guardada. Se o
// "Capturar" depender da rede — e a captura acontece justamente na rua, no
// corredor, no elevador —, então a pessoa aprende que não dá para confiar, e
// volta a guardar tudo na cabeça (ou no papel).
//
// Então a gravação no Google deixa de ser a hora da verdade: o item entra
// nesta fila primeiro, na hora, e sai dela quando a rede deixar. A tela pode
// dizer "capturado" no primeiro instante sem mentir.
const CHAVE = 'gestao-agenda:captura-pendente'

function ler() {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE))
    return Array.isArray(bruto) ? bruto : []
  } catch {
    // Sem localStorage (ou com lixo gravado) a fila não existe — o envio
    // direto ainda acontece, só não sobra rede de proteção.
    return []
  }
}

function gravar(fila) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(fila))
  } catch {
    // Ver comentário acima.
  }
}

function novoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `captura-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function enfileirar(texto, due = null) {
  // `due` chega como Date (mesmo formato que createTask espera) e precisa
  // virar string para sobreviver ao JSON.stringify do localStorage.
  const item = { id: novoId(), texto, due: due ? due.toISOString() : null, em: new Date().toISOString() }
  gravar([...ler(), item])
  return item
}

export function pendentes() {
  return ler()
}

export function quantasPendentes() {
  return ler().length
}

function remover(id) {
  gravar(ler().filter((item) => item.id !== id))
}

// Tenta gravar de verdade o que está na fila. `enviar(texto, due)` é injetado
// por quem chama (e nos testes) — este módulo não conhece o Google.
//
// Em sequência, e parando no primeiro erro: se a rede caiu, insistir com os
// outros só repete a mesma falha; e manter a ordem é o que faz a Entrada
// aparecer na ordem em que a pessoa pensou as coisas.
export async function descarregar(enviar) {
  let enviados = 0
  for (const item of ler()) {
    try {
      await enviar(item.texto, item.due ? new Date(item.due) : null)
      // Só sai da fila depois de gravado: um erro entre o envio e a remoção
      // deixa o item para a próxima rodada. Repetir é melhor que sumir.
      remover(item.id)
      enviados++
    } catch {
      break
    }
  }
  return { enviados, restantes: quantasPendentes() }
}
