import { describe, expect, it } from 'vitest'
import { mesclarAnotacoes, mesclarApagadas, precisaSubir, mesclarParaGravar } from './notesMerge.js'

const nota = (id, updatedAt, extra = {}) => ({ id, updatedAt, body: id, ...extra })
const ids = (lista) => lista.map((n) => n.id).sort()

describe('mesclarAnotacoes', () => {
  it('mantém as anotações que só existem no aparelho — é o caso que apagava tudo', () => {
    const locais = [nota('a', '2026-09-17T10:00:00Z'), nota('b', '2026-09-17T09:00:00Z')]
    const remotas = [nota('c', '2026-09-17T08:00:00Z')]
    expect(ids(mesclarAnotacoes(locais, remotas, []))).toEqual(['a', 'b', 'c'])
  })

  it('para a mesma anotação dos dois lados, vence a editada por último', () => {
    const locais = [nota('a', '2026-09-17T12:00:00Z', { body: 'nova' })]
    const remotas = [nota('a', '2026-09-17T10:00:00Z', { body: 'velha' })]
    expect(mesclarAnotacoes(locais, remotas, [])[0].body).toBe('nova')

    const locaisVelhas = [nota('a', '2026-09-17T08:00:00Z', { body: 'velha' })]
    const remotasNovas = [nota('a', '2026-09-17T11:00:00Z', { body: 'nova' })]
    expect(mesclarAnotacoes(locaisVelhas, remotasNovas, [])[0].body).toBe('nova')
  })

  it('não ressuscita o que foi apagado de propósito em outro aparelho', () => {
    const locais = [nota('a', '2026-09-17T09:00:00Z')]
    const apagadas = [{ id: 'a', at: '2026-09-17T10:00:00Z' }]
    expect(mesclarAnotacoes(locais, [], apagadas)).toEqual([])
  })

  it('mas devolve a anotação quando ela foi editada depois de apagada', () => {
    const locais = [nota('a', '2026-09-17T11:00:00Z')]
    const apagadas = [{ id: 'a', at: '2026-09-17T10:00:00Z' }]
    expect(ids(mesclarAnotacoes(locais, [], apagadas))).toEqual(['a'])
  })

  it('aguenta lista vazia, ausente e item sem id', () => {
    expect(mesclarAnotacoes()).toEqual([])
    expect(mesclarAnotacoes([{ updatedAt: '2026-09-17T10:00:00Z' }], [], [])).toEqual([])
  })
})

describe('mesclarApagadas', () => {
  it('junta os rastros dos dois lados sem duplicar', () => {
    const agora = new Date('2026-09-17T12:00:00Z').getTime()
    const merged = mesclarApagadas(
      [{ id: 'a', at: '2026-09-17T10:00:00Z' }],
      [{ id: 'a', at: '2026-09-17T09:00:00Z' }, { id: 'b', at: '2026-09-17T11:00:00Z' }],
      agora
    )
    expect(merged).toHaveLength(2)
    expect(merged.find((d) => d.id === 'a').at).toBe('2026-09-17T10:00:00Z')
  })

  it('descarta rastro velho demais para ainda importar', () => {
    const agora = new Date('2026-09-17T12:00:00Z').getTime()
    const antigo = [{ id: 'a', at: '2025-01-01T00:00:00Z' }]
    expect(mesclarApagadas(antigo, [], agora)).toEqual([])
  })
})

describe('precisaSubir', () => {
  it('não grava de volta quando a mesclagem não mudou nada', () => {
    const iguais = [nota('a', '2026-09-17T10:00:00Z')]
    expect(precisaSubir(iguais, [nota('a', '2026-09-17T10:00:00Z')])).toBe(false)
  })

  it('grava quando apareceu anotação nova ou edição mais recente', () => {
    expect(precisaSubir([nota('a', '2026-09-17T10:00:00Z'), nota('b', '2026-09-17T10:00:00Z')], [nota('a', '2026-09-17T10:00:00Z')])).toBe(true)
    expect(precisaSubir([nota('a', '2026-09-17T12:00:00Z')], [nota('a', '2026-09-17T10:00:00Z')])).toBe(true)
  })
})

describe('mesclarParaGravar', () => {
  const nota = (id, updatedAt, extra = {}) => ({ id, title: id, body: '', updatedAt, ...extra })
  const agora = Date.parse('2026-10-30T12:00:00Z')

  it('mantém a nota que o outro lado gravou desde a última leitura', () => {
    const remoto = { notes: [nota('do-claude', '2026-10-30T11:00:00Z')], deleted: [] }
    const { notes } = mesclarParaGravar([nota('do-app', '2026-10-30T11:30:00Z')], remoto, [], agora)
    expect(notes.map((n) => n.id).sort()).toEqual(['do-app', 'do-claude'])
  })

  it('uma nota apagada deste lado não volta só porque o Drive ainda a tem', () => {
    const remoto = { notes: [nota('x', '2026-10-30T10:00:00Z'), nota('y', '2026-10-30T10:00:00Z')], deleted: [] }
    const { notes, deleted } = mesclarParaGravar([nota('y', '2026-10-30T10:00:00Z')], remoto, [{ id: 'x', at: '2026-10-30T11:00:00Z' }], agora)
    expect(notes.map((n) => n.id)).toEqual(['y'])
    expect(deleted).toEqual([{ id: 'x', at: '2026-10-30T11:00:00Z' }])
  })

  it('editar depois de apagar traz a nota de volta (a edição é mais nova que o rastro)', () => {
    const remoto = { notes: [nota('x', '2026-10-30T11:30:00Z')], deleted: [] }
    const { notes } = mesclarParaGravar([], remoto, [{ id: 'x', at: '2026-10-30T11:00:00Z' }], agora)
    expect(notes.map((n) => n.id)).toEqual(['x'])
  })

  it('soma os rastros dos dois lados e fica com a versão mais nova de cada nota', () => {
    const remoto = { notes: [nota('a', '2026-10-30T09:00:00Z', { body: 'velho' })], deleted: [{ id: 'z', at: '2026-10-29T00:00:00Z' }] }
    const { notes, deleted } = mesclarParaGravar([nota('a', '2026-10-30T10:00:00Z', { body: 'novo' })], remoto, [{ id: 'w', at: '2026-10-30T08:00:00Z' }], agora)
    expect(notes[0].body).toBe('novo')
    expect(deleted.map((d) => d.id).sort()).toEqual(['w', 'z'])
  })
})
