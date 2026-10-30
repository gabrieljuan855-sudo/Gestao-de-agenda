import { semAcento } from './texto.js'
import { tituloDaNota } from './notasLista.js'

// Links entre anotações, no jeito do Obsidian: `[[Nome da nota]]` dentro do
// texto liga uma nota à outra, e cada nota sabe quem a cita. É o que
// transforma uma pilha de anotações numa base de conhecimento — uma ideia nova
// entra ligada às que já existem, em vez de ficar solta.
//
// O link aponta para o título (o mesmo que a lista mostra, tituloDaNota), e
// não para o id: é o que a pessoa consegue escrever de cabeça, no celular, e o
// que o Claude consegue escrever sem precisar consultar nada antes. A
// comparação ignora acento, caixa e espaço repetido, pelo mesmo motivo da
// busca: ninguém lembra do acento certo de um título.
//
// Também como no Obsidian: `[[Nota|outro texto]]` mostra outro texto, e
// `[[Nota#Seção]]` aponta para uma parte; nos dois casos o destino é "Nota".

const LINK = /\[\[([^[\]\n]+?)\]\]/g

export function chaveDeTitulo(titulo) {
  return semAcento(titulo || '').replace(/\s+/g, ' ').trim()
}

// Os destinos citados num texto, sem repetir, na ordem em que aparecem.
export function extrairLinks(texto) {
  const vistos = new Set()
  const alvos = []
  for (const [, bruto] of (texto || '').matchAll(LINK)) {
    const alvo = bruto.split('|')[0].split('#')[0].trim()
    const chave = chaveDeTitulo(alvo)
    if (!chave || vistos.has(chave)) continue
    vistos.add(chave)
    alvos.push(alvo)
  }
  return alvos
}

// Título → nota. Dois títulos iguais são ambíguos: vale a nota editada por
// último (e a revisão de saúde aponta a duplicata para ser resolvida).
export function indiceDeTitulos(notas) {
  const indice = new Map()
  for (const nota of notas || []) {
    const chave = chaveDeTitulo(tituloDaNota(nota))
    const atual = indice.get(chave)
    if (!atual || new Date(nota.updatedAt) > new Date(atual.updatedAt)) indice.set(chave, nota)
  }
  return indice
}

export function resolverLink(alvo, indice) {
  return indice.get(chaveDeTitulo(alvo)) || null
}

// Para a tela e para o Claude: para onde a nota aponta (com a nota de
// destino, ou null se ela ainda não existe) e quem aponta para ela.
export function ligacoesDaNota(nota, notas) {
  const indice = indiceDeTitulos(notas)
  const ligaA = extrairLinks(nota.body)
    .map((titulo) => ({ titulo, nota: resolverLink(titulo, indice) }))
    .filter((l) => l.nota?.id !== nota.id)
  const chave = chaveDeTitulo(tituloDaNota(nota))
  const citadaPor = (notas || []).filter(
    (outra) => outra.id !== nota.id && extrairLinks(outra.body).some((alvo) => chaveDeTitulo(alvo) === chave)
  )
  return { ligaA, citadaPor }
}

// A revisão de saúde da base, como o wiki-lint do claude-obsidian: o que
// quebra a navegação (link para nota que não existe), o que ninguém acha
// (nota solta: sem link para fora, sem ninguém citando e fora de projeto), o
// que confunde (dois títulos iguais) e o que sobrou vazio.
export function saudeDasNotas(notas) {
  const lista = notas || []
  const indice = indiceDeTitulos(lista)
  const citadas = new Set()
  const linksQuebrados = []
  const saida = new Map()
  for (const nota of lista) {
    const alvos = extrairLinks(nota.body)
    let algumValido = false
    for (const alvo of alvos) {
      const destino = resolverLink(alvo, indice)
      if (!destino) linksQuebrados.push({ nota, alvo })
      else if (destino.id !== nota.id) {
        citadas.add(destino.id)
        algumValido = true
      }
    }
    saida.set(nota.id, algumValido)
  }

  const porChave = new Map()
  for (const nota of lista) {
    const chave = chaveDeTitulo(tituloDaNota(nota))
    if (!porChave.has(chave)) porChave.set(chave, [])
    porChave.get(chave).push(nota)
  }

  const vazia = (n) => !n.title?.trim() && !n.body?.trim()
  return {
    linksQuebrados,
    soltas: lista.filter((n) => !vazia(n) && !saida.get(n.id) && !citadas.has(n.id) && !n.projeto),
    duplicadas: [...porChave.values()].filter((grupo) => grupo.length > 1),
    vazias: lista.filter(vazia),
  }
}

// ---------- escrever ligado: sugestões ao digitar [[ ----------

// O link que está sendo digitado agora: um "[[" antes do cursor, na mesma
// linha, ainda sem fechar. Devolve onde começa o nome e o que já foi digitado.
export function linkEmDigitacao(texto, cursor) {
  const antes = (texto || '').slice(0, cursor)
  const m = antes.match(/\[\[([^[\]\n|#]*)$/)
  if (!m) return null
  return { inicio: cursor - m[1].length, parcial: m[1] }
}

// Completa o link em digitação com o título escolhido e devolve o texto novo
// e onde o cursor fica (logo depois do "]]"). Se o "]]" já estiver ali (a
// pessoa voltou para corrigir o nome), não fecha de novo.
export function completarLink(texto, cursor, titulo) {
  const emDigitacao = linkEmDigitacao(texto, cursor)
  if (!emDigitacao) return null
  const depois = texto.slice(cursor)
  const resto = depois.startsWith(']]') ? depois.slice(2) : depois
  const novo = `${texto.slice(0, emDigitacao.inicio)}${titulo}]]`
  return { texto: novo + resto, cursor: novo.length }
}

// Títulos para sugerir enquanto se digita o link: primeiro os que começam com
// o que foi digitado, depois os que têm uma palavra começando assim, depois
// os que só contêm; dentro de cada grupo, o mais recente primeiro. Sem nada
// digitado, as notas mais recentes.
export function sugerirTitulos(notas, parcial, { excetoId, limite = 5 } = {}) {
  const busca = chaveDeTitulo(parcial)
  const vistos = new Set()
  const candidatos = []
  for (const nota of [...(notas || [])].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))) {
    if (nota.id === excetoId) continue
    const titulo = tituloDaNota(nota)
    const chave = chaveDeTitulo(titulo)
    if (!chave || vistos.has(chave) || (!nota.title?.trim() && !nota.body?.trim())) continue
    let grupo
    if (!busca || chave.startsWith(busca)) grupo = 0
    else if (chave.split(' ').some((p) => p.startsWith(busca))) grupo = 1
    else if (chave.includes(busca)) grupo = 2
    else continue
    vistos.add(chave)
    candidatos.push({ titulo, grupo })
  }
  return candidatos
    .sort((a, b) => a.grupo - b.grupo)
    .slice(0, limite)
    .map((c) => c.titulo)
}

// ---------- renomear sem quebrar ----------

// Trocar o título de uma nota quebraria todos os [[links]] que apontam para
// ela, porque o link é pelo título. Isto reescreve esses links com o título
// novo, mantendo o apelido e a seção ([[Velho|texto]] vira [[Novo|texto]]).
//
// Só mexe quando o título antigo era desta nota e de mais nenhuma: com duas
// notas de mesmo título, não dá para saber para qual delas cada link
// apontava, e reescrever levaria links da outra junto. Devolve a lista nova e
// as notas alteradas (com updatedAt novo, para a mesclagem com o Drive
// preferir esta versão).
export function renomearLinks(notas, id, tituloAntigo, agoraIso = new Date().toISOString()) {
  const lista = notas || []
  const nota = lista.find((n) => n.id === id)
  const chaveAntiga = chaveDeTitulo(tituloAntigo)
  if (!nota || !chaveAntiga) return { notas: lista, alteradas: [] }
  const tituloNovo = tituloDaNota(nota)
  if (!chaveDeTitulo(tituloNovo) || chaveDeTitulo(tituloNovo) === chaveAntiga) return { notas: lista, alteradas: [] }
  if (lista.some((n) => n.id !== id && chaveDeTitulo(tituloDaNota(n)) === chaveAntiga)) return { notas: lista, alteradas: [] }

  const alteradas = []
  const novas = lista.map((n) => {
    if (!n.body) return n
    const body = n.body.replace(LINK, (inteiro, bruto) => {
      const corte = bruto.search(/[|#]/)
      const alvo = corte < 0 ? bruto : bruto.slice(0, corte)
      if (chaveDeTitulo(alvo) !== chaveAntiga) return inteiro
      return `[[${tituloNovo}${corte < 0 ? '' : bruto.slice(corte)}]]`
    })
    if (body === n.body) return n
    // Estritamente depois da versão que foi lida: com o relógio de outro
    // aparelho adiantado, "agora" poderia ser mais velho que ela, e a
    // mesclagem ficaria com o link quebrado.
    const depois = new Date(Math.max(Date.parse(agoraIso), (Date.parse(n.updatedAt) || 0) + 1)).toISOString()
    const alterada = { ...n, body, updatedAt: n.id === id ? n.updatedAt : depois }
    alteradas.push(alterada)
    return alterada
  })
  return { notas: novas, alteradas }
}
