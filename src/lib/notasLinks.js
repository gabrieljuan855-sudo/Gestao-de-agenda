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
