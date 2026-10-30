import { describe, expect, it } from 'vitest'
import { montarTeia, vizinhosNaTeia, criarSimulacao, passoDaTeia, caixaDaTeia } from './teia.js'

const nota = (id, title, body = '', extra = {}) => ({ id, title, body, updatedAt: '2026-10-30T10:00:00Z', ...extra })

const notas = [
  nota('a', 'Audiência', 'Ver [[Caso Silva]] e [[Ofício]]. De novo [[caso silva]].', { projeto: 'caso-silva' }),
  nota('b', 'Caso Silva', 'Família acompanhada. Volta para [[Audiência]].', { projeto: 'caso-silva' }),
  nota('c', 'Solta', 'ninguém me liga'),
  nota('d', '', '   '),
]

describe('montarTeia', () => {
  it('uma linha por par ligado, sem repetir ida e volta, ignorando link para nota que não existe e nota vazia', () => {
    const teia = montarTeia(notas, [], { comProjetos: false })
    expect(teia.nos.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(teia.arestas).toEqual([{ de: 'a', para: 'b', tipo: 'link' }])
    expect(teia.nos.find((n) => n.id === 'a').grau).toBe(1)
  })

  it('com projetos, cada projeto vira um ponto ligado às suas anotações, com o nome da ficha', () => {
    const teia = montarTeia(notas, [{ id: 'caso-silva', nome: 'Caso Silva (família)' }])
    const projeto = teia.nos.find((n) => n.tipo === 'projeto')
    expect(projeto).toMatchObject({ id: 'projeto:caso-silva', titulo: 'Caso Silva (família)', grau: 2 })
    expect(teia.arestas.filter((a) => a.tipo === 'projeto')).toHaveLength(2)
  })

  it('sem as soltas, some quem não tem ligação nenhuma', () => {
    const teia = montarTeia(notas, [], { comProjetos: false, comSoltas: false })
    expect(teia.nos.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('vizinhosNaTeia acha os dois lados da linha', () => {
    const teia = montarTeia(notas, [])
    expect([...vizinhosNaTeia(teia, 'b')].sort()).toEqual(['a', 'projeto:caso-silva'])
  })
})

describe('simulação', () => {
  function assentar(teia) {
    const estado = criarSimulacao(teia)
    for (let i = 0; i < 400 && passoDaTeia(estado); i++);
    return estado
  }
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y)

  it('assenta com quem está ligado mais perto do que quem não está, e sem coordenada inválida', () => {
    const muitas = [
      ...notas,
      nota('e', 'Ofício', 'liga a [[Audiência]]'),
      nota('f', 'Outra solta', 'x'),
      nota('g', 'Mais uma', 'y'),
    ]
    const { nos } = assentar(montarTeia(muitas, [], { comProjetos: false }))
    const p = Object.fromEntries(nos.map((n) => [n.id, n]))
    expect(nos.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true)
    expect(dist(p.a, p.b)).toBeLessThan(dist(p.a, p.f))
    expect(dist(p.a, p.e)).toBeLessThan(dist(p.a, p.g))
  })

  it('é determinística: a mesma teia sempre se desenha igual', () => {
    const teia = montarTeia(notas, [])
    const um = assentar(teia).nos.map((n) => [Math.round(n.x), Math.round(n.y)])
    const dois = assentar(teia).nos.map((n) => [Math.round(n.x), Math.round(n.y)])
    expect(um).toEqual(dois)
  })

  it('quem já estava na tela começa onde estava, e ponto fixo não se mexe', () => {
    const teia = montarTeia(notas, [], { comProjetos: false })
    const estado = criarSimulacao(teia, { anteriores: new Map([['a', { x: 500, y: 500 }]]) })
    expect(estado.nos[0]).toMatchObject({ x: 500, y: 500 })
    estado.nos[0].fixo = true
    passoDaTeia(estado)
    expect(estado.nos[0]).toMatchObject({ x: 500, y: 500 })
  })

  it('caixaDaTeia enquadra todos os pontos com margem', () => {
    expect(caixaDaTeia([{ x: 0, y: 0 }, { x: 100, y: 50 }], 10)).toEqual({ x: -10, y: -10, largura: 120, altura: 70 })
  })
})
