// Quantos itens cabem num espaço, para a Semana e o Mês mostrarem tanto
// quanto a tela permite em vez de um número fixo. O limite fixo (6 por dia,
// 3 por célula) foi pensado para a grade baixa de antes; esticada até o fim
// da tela, ela ficava com espaço vazio e ainda cortava em "+4 mais".
//
// `reservado` é o que não é item (cabeçalho do dia, a linha do "+N").
// Altura desconhecida (0, antes da primeira medição) devolve o mínimo, que é
// o comportamento de sempre.
export function quantosCabem(altura, { alturaItem, reservado = 0, minimo = 1, maximo = Infinity }) {
  if (!Number.isFinite(altura) || altura <= 0 || !(alturaItem > 0)) return minimo
  const cabem = Math.floor((altura - reservado) / alturaItem)
  return Math.min(maximo, Math.max(minimo, cabem))
}
