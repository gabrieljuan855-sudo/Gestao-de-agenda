import { extrairLinks, indiceDeTitulos, resolverLink } from './notasLinks.js'
import { tituloDaNota, notaVazia } from './notasLista.js'

// A teia de ligações, como o grafo do Obsidian: cada anotação é um ponto,
// cada [[link]] é uma linha, e o desenho mostra de olhar o que se junta com
// o quê — os assuntos que viraram centro, as notas que ficaram soltas. Os
// projetos podem entrar como pontos maiores, ligados às anotações deles: é
// isso que amarra a teia ao trabalho de verdade.

const ID_DO_PROJETO = (id) => `projeto:${id}`

// Os pontos e as linhas, prontos para desenhar. A ligação não tem sentido
// aqui (A cita B e B cita A viram uma linha só): a teia mostra o que está
// junto, e "quem cita quem" já aparece embaixo de cada nota.
export function montarTeia(notas, projetos = [], { comProjetos = true, comSoltas = true } = {}) {
  const lista = (notas || []).filter((n) => !notaVazia(n))
  const indice = indiceDeTitulos(lista)
  const nos = lista.map((n) => ({ id: n.id, tipo: 'nota', titulo: tituloDaNota(n), projeto: n.projeto || null }))
  const arestas = []
  const vistas = new Set()
  const ligar = (de, para, tipo) => {
    const chave = de < para ? `${de}|${para}` : `${para}|${de}`
    if (de === para || vistas.has(chave)) return
    vistas.add(chave)
    arestas.push({ de, para, tipo })
  }

  for (const nota of lista) {
    for (const alvo of extrairLinks(nota.body)) {
      const destino = resolverLink(alvo, indice)
      if (destino) ligar(nota.id, destino.id, 'link')
    }
  }

  if (comProjetos) {
    const nomes = new Map((projetos || []).map((p) => [p.id, p.nome]))
    const usados = [...new Set(lista.map((n) => n.projeto).filter(Boolean))]
    for (const id of usados) nos.push({ id: ID_DO_PROJETO(id), tipo: 'projeto', titulo: nomes.get(id) || id, projetoId: id })
    for (const nota of lista) if (nota.projeto) ligar(nota.id, ID_DO_PROJETO(nota.projeto), 'projeto')
  }

  const grau = new Map(nos.map((n) => [n.id, 0]))
  for (const a of arestas) {
    grau.set(a.de, grau.get(a.de) + 1)
    grau.set(a.para, grau.get(a.para) + 1)
  }
  const comGrau = nos.map((n) => ({ ...n, grau: grau.get(n.id) }))
  return {
    nos: comSoltas ? comGrau : comGrau.filter((n) => n.grau > 0),
    arestas,
  }
}

// Os pontos ligados diretamente a um ponto (para acender a vizinhança de
// quem foi tocado).
export function vizinhosNaTeia(teia, id) {
  const vizinhos = new Set()
  for (const a of teia.arestas) {
    if (a.de === id) vizinhos.add(a.para)
    if (a.para === id) vizinhos.add(a.de)
  }
  return vizinhos
}

// ---------- o desenho: uma simulação de forças ----------
//
// Cada ponto empurra os outros (repulsão), cada linha puxa as pontas como
// uma mola, e uma gravidade leve segura tudo perto do centro — as notas
// soltas não fogem da tela. A "temperatura" (alpha) cai a cada passo, e o
// desenho assenta. É o mesmo princípio do d3-force e do grafo do Obsidian,
// em poucas linhas, sem trazer uma biblioteca inteira para isso.

const REPULSAO = 2600
const MOLA = 0.06
const GRAVIDADE = 0.01
const ATRITO = 0.6
const RESFRIAMENTO = 0.985
const COMPRIMENTO = { link: 75, projeto: 105 }

// Posição inicial que não muda de uma abertura para outra (vem do id, não do
// acaso): a teia não se embaralha toda vez que o painel abre.
function sementeDe(texto) {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

// `anteriores` (id → {x, y}) mantém no lugar quem já estava na tela quando a
// teia muda (uma nota nova, um filtro ligado): só o que é novo se acomoda.
export function criarSimulacao(teia, { anteriores = new Map() } = {}) {
  const nos = teia.nos.map((n, i) => {
    const antes = anteriores.get(n.id)
    if (antes) return { ...n, x: antes.x, y: antes.y, vx: 0, vy: 0 }
    const angulo = sementeDe(n.id) * Math.PI * 2
    const raio = 40 + Math.sqrt(i + 1) * 30
    return { ...n, x: Math.cos(angulo) * raio, y: Math.sin(angulo) * raio, vx: 0, vy: 0 }
  })
  const posicao = new Map(nos.map((n, i) => [n.id, i]))
  const arestas = teia.arestas
    .filter((a) => posicao.has(a.de) && posicao.has(a.para))
    .map((a) => ({ ...a, i: posicao.get(a.de), j: posicao.get(a.para) }))
  return { nos, arestas, alpha: anteriores.size ? 0.5 : 1 }
}

// Um passo da simulação. Muda o estado no lugar (é chamada dezenas de vezes
// por quadro) e devolve se ainda vale continuar.
export function passoDaTeia(estado) {
  const { nos, arestas } = estado
  const alpha = estado.alpha

  for (let a = 0; a < nos.length; a++) {
    for (let b = a + 1; b < nos.length; b++) {
      let dx = nos[b].x - nos[a].x
      let dy = nos[b].y - nos[a].y
      let d2 = dx * dx + dy * dy
      // Dois pontos no mesmo lugar: um empurrãozinho determinístico para
      // não dividir por zero.
      if (d2 < 0.01) {
        dx = 0.1 * (a % 2 ? 1 : -1)
        dy = 0.1
        d2 = 0.02
      }
      const f = (REPULSAO * alpha) / Math.max(d2, 25)
      const d = Math.sqrt(d2)
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      nos[a].vx -= fx
      nos[a].vy -= fy
      nos[b].vx += fx
      nos[b].vy += fy
    }
  }

  for (const { i, j, tipo } of arestas) {
    const dx = nos[j].x - nos[i].x
    const dy = nos[j].y - nos[i].y
    const d = Math.sqrt(dx * dx + dy * dy) || 0.1
    const f = (d - COMPRIMENTO[tipo]) * MOLA * alpha
    const fx = (dx / d) * f
    const fy = (dy / d) * f
    nos[i].vx += fx
    nos[i].vy += fy
    nos[j].vx -= fx
    nos[j].vy -= fy
  }

  for (const n of nos) {
    n.vx -= n.x * GRAVIDADE * alpha
    n.vy -= n.y * GRAVIDADE * alpha
    if (n.fixo) {
      n.vx = 0
      n.vy = 0
      continue
    }
    n.vx *= ATRITO
    n.vy *= ATRITO
    n.x += n.vx
    n.y += n.vy
  }

  estado.alpha = alpha * RESFRIAMENTO
  return estado.alpha > 0.02
}

// A caixa que contém todos os pontos, para enquadrar a teia na tela.
export function caixaDaTeia(nos, margem = 40) {
  if (!nos.length) return { x: -100, y: -100, largura: 200, altura: 200 }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const n of nos) {
    x0 = Math.min(x0, n.x)
    y0 = Math.min(y0, n.y)
    x1 = Math.max(x1, n.x)
    y1 = Math.max(y1, n.y)
  }
  return { x: x0 - margem, y: y0 - margem, largura: Math.max(x1 - x0, 1) + margem * 2, altura: Math.max(y1 - y0, 1) + margem * 2 }
}
