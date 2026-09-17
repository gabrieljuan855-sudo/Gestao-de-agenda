import { describe, expect, it } from 'vitest'
import { ultimoHorarioDaVarredura, descreverSincronizacao, resolverNotaRelacionada } from './useNotes.js'

function em(dataHora) {
  return new Date(`2026-09-17T${dataHora}`)
}

describe('ultimoHorarioDaVarredura', () => {
  it('acha o horário mais recente que já passou hoje', () => {
    expect(ultimoHorarioDaVarredura(em('09:30:00'))).toEqual(em('08:00:00'))
    expect(ultimoHorarioDaVarredura(em('14:00:00'))).toEqual(em('13:00:00'))
    expect(ultimoHorarioDaVarredura(em('23:59:00'))).toEqual(em('15:00:00'))
  })

  it('cai exatamente num horário quando é ele mesmo', () => {
    expect(ultimoHorarioDaVarredura(em('13:00:00'))).toEqual(em('13:00:00'))
  })

  it('antes do primeiro horário do dia, usa o último horário de ontem', () => {
    const resultado = ultimoHorarioDaVarredura(em('05:00:00'))
    expect(resultado.getDate()).toBe(16)
    expect(resultado.getHours()).toBe(15)
  })
})

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
