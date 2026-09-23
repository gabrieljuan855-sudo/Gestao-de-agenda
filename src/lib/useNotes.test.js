import { describe, expect, it } from 'vitest'
import { descreverSincronizacao, resolverNotaRelacionada, sanitizeNote, sanitizeNotes } from './useNotes.js'

describe('descreverSincronizacao', () => {
  it('diz o que está acontecendo em cada estado', () => {
    expect(descreverSincronizacao('salvando')).toBe('Salvando...')
    expect(descreverSincronizacao('salvo')).toBe('Salvo no Drive')
    expect(descreverSincronizacao('erro')).toBe('Salvo só neste aparelho')
  })

  it('cala a boca antes do primeiro contato com o Drive', () => {
    // O texto fixo "Sincronizado com o Drive" afirmava sucesso mesmo sem nada
    // ter subido. Vazio aqui é a correção: sem informação, não se inventa.
    expect(descreverSincronizacao('ocioso')).toBe('')
    expect(descreverSincronizacao(undefined)).toBe('')
  })
})

describe('resolverNotaRelacionada', () => {
  const outras = [
    { id: 'nota-a', title: 'Caso Fulano' },
    { id: 'nota-b', title: 'Caso Beltrano' },
  ]

  it('resolve a referência para a nota real na mesma posição', () => {
    expect(resolverNotaRelacionada('n1', outras)).toEqual({ id: 'nota-a', title: 'Caso Fulano' })
    expect(resolverNotaRelacionada('n2', outras)).toEqual({ id: 'nota-b', title: 'Caso Beltrano' })
  })

  it('devolve null para referência fora da lista, vazia ou de outro tipo', () => {
    // O caso que importa: a lista mudou entre o pedido e a resposta (a pessoa
    // editou outra aba no meio do caminho) — a referência antiga não pode
    // apontar para a nota errada.
    expect(resolverNotaRelacionada('n5', outras)).toBe(null)
    expect(resolverNotaRelacionada(null, outras)).toBe(null)
    expect(resolverNotaRelacionada('e1', outras)).toBe(null)
    expect(resolverNotaRelacionada('n1', [])).toBe(null)
  })
})

describe('sanitizeNote', () => {
  it('mantém uma nota normal como está, só com os campos esperados', () => {
    const nota = {
      id: 'n1',
      title: 'Atendimento',
      body: 'texto',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
      suggestions: [{ type: 'tarefa', text: 'Ligar' }],
      lastAnalyzedAt: '2026-09-02T00:00:00.000Z',
      relatedNote: { id: 'n2', title: 'Outra' },
    }
    expect(sanitizeNote(nota)).toEqual(nota)
  })

  it('descarta um objeto do DOM/evento gravado por engano no lugar do valor certo', () => {
    // O bug de verdade: onCreate={createNote} passava o SyntheticEvent do
    // clique como `inicial`, e {...inicial} incluía o alvo do clique — aqui
    // simulado por um objeto com referência circular, do jeito que um nó do
    // DOM com fiber do React se comporta.
    const botao = {}
    botao.self = botao
    const notaCorrompida = { id: 'n1', title: 'Atendimento', body: 'texto', target: botao, view: {} }
    const limpa = sanitizeNote(notaCorrompida)
    expect(limpa.title).toBe('Atendimento')
    expect(limpa.body).toBe('texto')
    expect(limpa).not.toHaveProperty('target')
    expect(limpa).not.toHaveProperty('view')
    expect(() => JSON.stringify(limpa)).not.toThrow()
  })

  it('sem id não é nota — é descartada', () => {
    expect(sanitizeNote({ title: 'x' })).toBe(null)
    expect(sanitizeNote(null)).toBe(null)
    expect(sanitizeNote('não é objeto')).toBe(null)
  })

  it('título/corpo que não são string viram vazio, em vez de quebrar', () => {
    const limpa = sanitizeNote({ id: 'n1', title: 42, body: null })
    expect(limpa.title).toBe('')
    expect(limpa.body).toBe('')
  })

  it('preenche datas que faltam, sem inventar suggestions/relatedNote que não existiam', () => {
    const limpa = sanitizeNote({ id: 'n1', title: 'x', body: 'y' })
    expect(typeof limpa.createdAt).toBe('string')
    expect(typeof limpa.updatedAt).toBe('string')
    expect(limpa).not.toHaveProperty('suggestions')
    expect(limpa).not.toHaveProperty('relatedNote')
  })
})

describe('sanitizeNotes', () => {
  it('limpa a lista inteira e descarta o que não é nota válida', () => {
    const notas = [{ id: 'n1', title: 'a', body: '' }, { title: 'sem id' }, null]
    expect(sanitizeNotes(notas).map((n) => n.id)).toEqual(['n1'])
  })

  it('nunca quebra com algo que não é lista', () => {
    expect(sanitizeNotes(undefined)).toEqual([])
    expect(sanitizeNotes(null)).toEqual([])
    expect(sanitizeNotes('x')).toEqual([])
  })
})
