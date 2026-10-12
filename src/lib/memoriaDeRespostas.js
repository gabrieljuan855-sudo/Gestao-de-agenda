// Memória curta das respostas da IA.
//
// O Gemini roda com temperatura 0: o mesmo pedido devolve a mesma resposta.
// Repetir a chamada só gasta cota — e é o que acontece quando a pessoa clica
// duas vezes, volta a perguntar a mesma coisa ou aperta "Recalcular" sem ter
// mudado nada. Aqui o pedido idêntico reaproveita a resposta por alguns
// minutos, e dois pedidos idênticos ao mesmo tempo viram uma chamada só.
//
// Erro nunca é lembrado: "tentar de novo" depois de uma falha precisa ir ao
// servidor de verdade.
export function criarMemoriaDeRespostas({ ttlMs, agora = Date.now, maximo = 30 }) {
  const guardadas = new Map()

  return async function lembrar(chave, buscar) {
    const hora = agora()
    for (const [k, v] of guardadas) if (v.expiraEm <= hora) guardadas.delete(k)

    const existente = guardadas.get(chave)
    if (existente) return structuredClone(await existente.promessa)

    const promessa = buscar()
    guardadas.set(chave, { promessa, expiraEm: hora + ttlMs })
    // Cresce só com pedidos diferentes dentro da janela; o teto evita que uma
    // sessão muito longa acumule contexto de projeto inteiro na memória.
    if (guardadas.size > maximo) guardadas.delete(guardadas.keys().next().value)
    try {
      return structuredClone(await promessa)
    } catch (err) {
      guardadas.delete(chave)
      throw err
    }
  }
}
