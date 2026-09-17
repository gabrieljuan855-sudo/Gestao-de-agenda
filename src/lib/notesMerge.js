// Mesclagem das anotações entre o que está no aparelho e o que está no Drive.
//
// Substituir o local pelo remoto é simples e está errado: cada aparelho pode
// ter escrito algo que ainda não subiu (por falta de rede, de permissão, ou
// porque no iOS o app instalado na tela de início e o Safari têm
// armazenamentos separados — são, na prática, dois aparelhos). Quem chega
// depois apagava o que o outro tinha escrito.
//
// Aqui nada é descartado por omissão: some só o que foi apagado de propósito,
// e para isso a exclusão precisa deixar rastro. Sem esse rastro não há como
// distinguir "esta anotação ainda não subiu" de "esta anotação foi apagada
// no outro aparelho" — as duas se parecem com "existe aqui e não existe lá".

// Quanto tempo o rastro de uma exclusão fica guardado. Precisa durar mais do
// que o intervalo plausível entre dois aparelhos se falarem; depois disso,
// segurar o rastro só faz o arquivo crescer à toa.
const VALIDADE_DO_RASTRO_MS = 90 * 24 * 60 * 60 * 1000

function emMs(iso) {
  const t = new Date(iso || 0).getTime()
    return Number.isFinite(t) ? t : 0
}

// Junta as duas listas. Para a mesma anotação nos dois lados, vence a editada
// por último. A que existe só de um lado fica — a menos que haja um rastro de
// exclusão mais recente que a própria edição, caso em que ela foi mesmo
// apagada de propósito e não deve ressuscitar.
export function mesclarAnotacoes(locais = [], remotas = [], apagadas = []) {
  const rastro = new Map(apagadas.map((d) => [d.id, emMs(d.at)]))
  const porId = new Map()

  for (const nota of remotas) {
    if (!nota?.id) continue
    porId.set(nota.id, nota)
  }

  for (const nota of locais) {
    if (!nota?.id) continue
    const remota = porId.get(nota.id)
    if (remota) {
      if (emMs(nota.updatedAt) > emMs(remota.updatedAt)) porId.set(nota.id, nota)
      continue
    }
    // Editar depois de apagar é a pessoa querendo a anotação de volta: a
    // edição mais nova ganha do rastro mais velho.
    if (rastro.has(nota.id) && rastro.get(nota.id) >= emMs(nota.updatedAt)) continue
    porId.set(nota.id, nota)
  }

  return [...porId.values()].sort((a, b) => emMs(b.updatedAt) - emMs(a.updatedAt))
}

// Une os rastros dos dois lados e joga fora os velhos demais para importar.
export function mesclarApagadas(locais = [], remotas = [], agora = Date.now()) {
  const porId = new Map()
  for (const d of [...remotas, ...locais]) {
    if (!d?.id) continue
    const quando = emMs(d.at)
    if (agora - quando > VALIDADE_DO_RASTRO_MS) continue
    if (!porId.has(d.id) || quando > emMs(porId.get(d.id).at)) porId.set(d.id, { id: d.id, at: d.at })
  }
  return [...porId.values()]
}

// Se a mesclagem não mudou nada em relação ao que o Drive já tem, não há o que
// gravar de volta — e uma gravação à toa é uma chance a mais de dar errado.
export function precisaSubir(mescladas, remotas) {
  if (mescladas.length !== remotas.length) return true
  const remotaPorId = new Map(remotas.map((n) => [n.id, n]))
  return mescladas.some((n) => {
    const remota = remotaPorId.get(n.id)
    return !remota || emMs(n.updatedAt) !== emMs(remota.updatedAt)
  })
}
