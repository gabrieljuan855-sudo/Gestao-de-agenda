import { describe, expect, it } from 'vitest'
import { descreverSincronizacao, resolverNotaRelacionada } from './useNotes.js'

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
